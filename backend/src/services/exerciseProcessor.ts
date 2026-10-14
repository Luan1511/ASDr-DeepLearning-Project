/**
 * Durable queue for exercise practice sessions (Giai đoạn 4).
 *
 * Same pattern as screeningProcessor.ts (not shared, so the screening queue
 * stays untouched): queue columns live on ExerciseSession, claims use
 * FOR UPDATE SKIP LOCKED, a heartbeat refreshes lockedAt, stale locks are
 * re-queued, P2021/P2022 pause the worker. Concurrency is 1; the GPU is
 * shared with screenings through openposeService's heavy-call gate.
 *
 * Privacy: exercise clips only use /subjects/extract + /keypoints (ST-GCN
 * never runs on them). Consent is rechecked before every ML call. After
 * scoring, the raw file and the ML subject are deleted and only the score is
 * kept; the child's skeleton is never stored.
 *
 * Timestamps in raw SQL: the columns are TIMESTAMP without time zone holding
 * UTC and the database session time zone may differ, so pass ISO strings and
 * convert with AT TIME ZONE 'UTC' (see screeningProcessor.ts).
 */
import fs from 'fs'
import os from 'os'
import path from 'path'
import { randomUUID } from 'crypto'
import { ExerciseSessionStatus, JobStatus, Prisma } from '@prisma/client'
import { env } from '../lib/env'
import { prisma } from '../lib/prisma'
import { SCHEMA_OUTDATED_HINT, isSchemaOutdatedError } from '../lib/prismaErrors'
import { chooseMlUpload, EXERCISE_EXTENSIONS } from '../lib/exerciseInput'
import { FINAL_SESSION_STATUSES, exerciseRetryDelayMs } from '../lib/exerciseData'
import { findActiveExerciseConsent } from './consentService'
import { getMlCapabilities } from './mlCapabilities'
import { OpenPoseApiError, openposeService, type OpenPoseExtractResponse } from './openposeService'
import { resolveExerciseFps, scoreImitation, type MirrorPolicyValue, type PracticeMode, type RecordedVia, type TemplateFeatures } from './imitation'

const WORKER_ID = `${os.hostname()}:${process.pid}:${randomUUID().slice(0, 8)}:ex`
const HEARTBEAT_MS = 30_000
const STALE_LOCK_MS = 2 * 60_000
const RECOVERY_EVERY_TICKS = 10
const SCHEMA_RETRY_MS = 60_000
const FAILED_VIDEO_RETENTION_MS = 24 * 60 * 60_000
const RECONCILE_BATCH = 5
const LOG = '[exercise-queue]'

export const EXERCISE_UPLOAD_DIR = path.join('uploads', 'exercises')

export const EXERCISE_MESSAGES = {
  final: 'Chưa chấm được do sự cố kỹ thuật. Bấm “Thử chấm lại” hoặc tập lại sau.',
  unreadable: 'Máy phân tích chưa đọc được video này. Hãy quay lại với cả người con trong khung hình.',
  consentRevoked: 'Quyền ghi hình bài tập đã được thu hồi nên video không được phân tích và đã được xoá.',
  noDuration: 'Không xác định được thời lượng video.',
  videoGone: 'Video của lượt tập này không còn trên máy chủ. Mình tập lại lần mới nhé.',
  formatUnsupported:
    'Máy chủ phân tích hiện chưa nhận định dạng video WebM của trình duyệt này. Hãy dùng Chrome bản mới (126 trở lên) hoặc Safari, hoặc quay bằng điện thoại rồi tải video lên.',
  interrupted: 'Quá trình chấm điểm bị gián đoạn nhiều lần. Bấm “Thử chấm lại” hoặc tập lại sau.',
  retrying: (attempt: number, max: number) =>
    `Máy chủ phân tích đang bận, hệ thống sẽ tự thử lại (lần ${attempt}/${max}).`,
} as const

/** Failure worth retrying later (e.g. the ML server is still extracting). */
class RetryableJobError extends Error {}
/** Final failure whose message is already safe to show to parents. */
class JobError extends Error {}
/** Another worker re-queued this session (our heartbeat went stale); leave it alone. */
class LostLockError extends Error {}

type ClaimedSession = { id: string; attempts: number; maxAttempts: number }
/** What this run touched, so a vanished row can still be cleaned up. */
type RunContext = { filePath: string | null; mlSubjectId: string | null }

let stopped = true
let polling = false
let running = false
let ticks = 0
let consecutivePollErrors = 0
let pausedUntil = 0
let timer: NodeJS.Timeout | null = null

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function startExerciseWorker() {
  if (!stopped) return
  if (env.EXERCISE_MODE === 'off' || !env.EXERCISE_WORKER_ENABLED) {
    // eslint-disable-next-line no-console
    console.log(`${LOG} worker disabled (EXERCISE_MODE=${env.EXERCISE_MODE}, EXERCISE_WORKER_ENABLED=${env.EXERCISE_WORKER_ENABLED})`)
    return
  }
  stopped = false
  timer = setInterval(() => runTick(), env.EXERCISE_POLL_INTERVAL_MS)
  kickExerciseWorker()
  // eslint-disable-next-line no-console
  console.log(`${LOG} worker ${WORKER_ID} started`)
}

export function stopExerciseWorker() {
  stopped = true
  if (timer) clearInterval(timer)
  timer = null
}

export function kickExerciseWorker() {
  if (stopped) return
  setImmediate(() => runTick())
}

/** 1-based position among waiting sessions (the one being scored counts), or null when not waiting. */
export async function getExerciseQueuePosition(sessionId: string): Promise<number | null> {
  const session = await prisma.exerciseSession.findUnique({
    where: { id: sessionId },
    select: { status: true, createdAt: true },
  })
  if (!session || session.status !== ExerciseSessionStatus.QUEUED) return null
  const ahead = await prisma.exerciseSession.count({
    where: {
      status: { in: [ExerciseSessionStatus.QUEUED, ExerciseSessionStatus.PROCESSING] },
      createdAt: { lt: session.createdAt },
    },
  })
  return ahead + 1
}

/** Whether the ML server is busy with another video (a screening or another exercise). */
export async function isMlBusy(excludeSessionId: string): Promise<boolean> {
  const [screenings, exercises] = await Promise.all([
    prisma.screeningJob.count({ where: { status: JobStatus.RUNNING } }),
    prisma.exerciseSession.count({
      where: { status: ExerciseSessionStatus.PROCESSING, id: { not: excludeSessionId } },
    }),
  ])
  return screenings + exercises > 0
}

/** Admin counters (no child identifiers). */
export async function getExerciseQueueStats() {
  const since = new Date(Date.now() - 24 * 60 * 60_000)
  const [queued, processing, failed24h, mlCleanupPending] = await Promise.all([
    prisma.exerciseSession.count({ where: { status: ExerciseSessionStatus.QUEUED } }),
    prisma.exerciseSession.count({ where: { status: ExerciseSessionStatus.PROCESSING } }),
    prisma.exerciseSession.count({ where: { status: ExerciseSessionStatus.FAILED, updatedAt: { gte: since } } }),
    prisma.exerciseSession.count({
      where: { status: { in: [...FINAL_SESSION_STATUSES] }, mlSubjectId: { not: null }, mlSubjectDeletedAt: null },
    }),
  ])
  return { queued, processing, failed24h, mlCleanupPending }
}

// ---------------------------------------------------------------------------
// Worker loop
// ---------------------------------------------------------------------------

function runTick() {
  tick().catch((error) => {
    // tick() handles its own errors; this only keeps an unexpected throw from
    // becoming an unhandled rejection (fatal in Node >= 15).
    // eslint-disable-next-line no-console
    console.error(`${LOG} tick crashed:`, (error as Error)?.message ?? error)
  })
}

/** Raw SQL against a missing table/column arrives as P2010 rather than P2021/P2022. */
function isExerciseSchemaMissing(error: unknown): boolean {
  if (isSchemaOutdatedError(error)) return true
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2010' &&
    /42P01|42703|does not exist/.test(error.message)
  )
}

async function tick() {
  if (stopped || polling || Date.now() < pausedUntil) return
  polling = true
  try {
    if (ticks % RECOVERY_EVERY_TICKS === 0) {
      await recoverStaleSessions()
      await reconcile()
    }
    ticks += 1

    if (!running) {
      const [claimed] = await claimSessions()
      if (claimed) {
        running = true
        void processSession(claimed)
          .catch((error) => {
            // eslint-disable-next-line no-console
            console.error(`${LOG} session ${claimed.id} crashed:`, (error as Error)?.message ?? error)
          })
          .finally(() => {
            running = false
            kickExerciseWorker()
          })
      }
    }
    consecutivePollErrors = 0
  } catch (error) {
    if (isExerciseSchemaMissing(error)) {
      // Exercise tables not migrated yet: check again in a minute, log once.
      pausedUntil = Date.now() + SCHEMA_RETRY_MS
      if (consecutivePollErrors === 0) {
        // eslint-disable-next-line no-console
        console.error(`${LOG} paused: ${SCHEMA_OUTDATED_HINT}`)
      }
      consecutivePollErrors += 1
      return
    }
    consecutivePollErrors += 1
    if (consecutivePollErrors === 1 || consecutivePollErrors % 20 === 0) {
      // eslint-disable-next-line no-console
      console.error(`${LOG} poll failed (${consecutivePollErrors}x):`, (error as Error)?.message ?? error)
    }
  } finally {
    polling = false
  }
}

async function claimSessions(): Promise<ClaimedSession[]> {
  const nowIso = new Date().toISOString()
  return prisma.$queryRaw<ClaimedSession[]>`
    UPDATE "ExerciseSession" AS s
    SET "status" = 'PROCESSING',
        "lockedBy" = ${WORKER_ID},
        "lockedAt" = (${nowIso}::timestamptz AT TIME ZONE 'UTC'),
        "attempts" = s."attempts" + 1,
        "updatedAt" = (${nowIso}::timestamptz AT TIME ZONE 'UTC')
    WHERE s."id" IN (
      SELECT "id" FROM "ExerciseSession"
      WHERE "status" = 'QUEUED' AND "runAfter" <= (${nowIso}::timestamptz AT TIME ZONE 'UTC')
      ORDER BY "createdAt"
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING s."id", s."attempts", s."maxAttempts"`
}

async function recoverStaleSessions() {
  const staleBefore = new Date(Date.now() - STALE_LOCK_MS)
  const stale = await prisma.exerciseSession.findMany({
    where: { status: ExerciseSessionStatus.PROCESSING, lockedAt: { lt: staleBefore } },
    select: { id: true, attempts: true, maxAttempts: true, lastError: true },
  })
  for (const s of stale) {
    const exhausted = s.attempts >= s.maxAttempts
    const updated = await prisma.exerciseSession.updateMany({
      // Guard on lockedAt so a session whose heartbeat just resumed is not stolen.
      where: { id: s.id, status: ExerciseSessionStatus.PROCESSING, lockedAt: { lt: staleBefore } },
      data: {
        status: exhausted ? ExerciseSessionStatus.FAILED : ExerciseSessionStatus.QUEUED,
        lockedBy: null,
        lockedAt: null,
        runAfter: new Date(),
        lastError: s.lastError ?? 'Worker stopped while processing (backend restart?)',
        ...(exhausted ? { errorMessage: EXERCISE_MESSAGES.interrupted } : {}),
      },
    })
    if (updated.count) {
      // eslint-disable-next-line no-console
      console.warn(`${LOG} recovered stale session ${s.id} → ${exhausted ? 'FAILED' : 'QUEUED'}`)
    }
  }
}

/**
 * (a) Delete ML subjects that finished sessions left behind (the ML server was
 * unreachable right after scoring). (b) Delete FAILED videos kept for retry
 * once they are older than 24 h. Never deletes files no row points to.
 */
async function reconcile() {
  const pendingMl = await prisma.exerciseSession.findMany({
    where: {
      status: { in: [...FINAL_SESSION_STATUSES] },
      mlSubjectId: { not: null },
      mlSubjectDeletedAt: null,
      lockedBy: null,
    },
    select: { id: true, mlSubjectId: true },
    orderBy: { updatedAt: 'asc' },
    take: RECONCILE_BATCH,
  })
  for (const s of pendingMl) {
    const ok = await deleteMlSubject(s.mlSubjectId!)
    if (!ok) break // ML unreachable: try again on the next reconcile.
    await prisma.exerciseSession.updateMany({
      // A retry may have re-queued it meanwhile; the worker resets the flag before extracting anyway.
      where: { id: s.id, status: { in: [...FINAL_SESSION_STATUSES] }, mlSubjectDeletedAt: null },
      data: { mlSubjectDeletedAt: new Date() },
    })
  }

  const expired = await prisma.exerciseSession.findMany({
    where: {
      status: ExerciseSessionStatus.FAILED,
      videoDeletedAt: null,
      updatedAt: { lt: new Date(Date.now() - FAILED_VIDEO_RETENTION_MS) },
    },
    select: { id: true, filePath: true },
    take: 50,
  })
  for (const s of expired) {
    if (await unlinkExerciseFile(s.filePath)) {
      await prisma.exerciseSession.updateMany({
        where: { id: s.id, status: ExerciseSessionStatus.FAILED, videoDeletedAt: null },
        data: { videoDeletedAt: new Date() },
      })
    }
  }
}

// ---------------------------------------------------------------------------
// One session
// ---------------------------------------------------------------------------

async function processSession(job: ClaimedSession) {
  const ctx: RunContext = { filePath: null, mlSubjectId: null }
  const heartbeat = setInterval(() => {
    prisma.exerciseSession
      .updateMany({
        where: { id: job.id, lockedBy: WORKER_ID, status: ExerciseSessionStatus.PROCESSING },
        data: { lockedAt: new Date() },
      })
      .catch(() => {})
  }, HEARTBEAT_MS)

  try {
    await runSession(job, ctx)
  } catch (error) {
    try {
      await recordFailure(job, ctx, error)
    } catch (recordError) {
      // e.g. the database is unreachable: the heartbeat stops below and
      // recoverStaleSessions() re-queues the session once its lock is stale.
      // eslint-disable-next-line no-console
      console.error(`${LOG} could not record the failure of ${job.id}:`, (recordError as Error)?.message ?? recordError)
    }
  } finally {
    clearInterval(heartbeat)
  }
}

const sessionSelect = {
  id: true,
  childId: true,
  status: true,
  recordedVia: true,
  practiceMode: true,
  playbackRate: true,
  guideOffsetMs: true,
  filePath: true,
  durationMs: true,
  videoWidth: true,
  videoHeight: true,
  videoDeletedAt: true,
  mlSubjectId: true,
  template: { select: { id: true, templateHash: true, mirrorPolicy: true, features: true } },
} satisfies Prisma.ExerciseSessionSelect

async function runSession(job: ClaimedSession, ctx: RunContext) {
  const session = await prisma.exerciseSession.findUnique({ where: { id: job.id }, select: sessionSelect })
  if (!session) {
    await discardVanished(job.id, ctx)
    return
  }
  ctx.filePath = session.filePath
  ctx.mlSubjectId = session.mlSubjectId

  // Consent can be revoked while the session waits: no ML call, drop the video.
  if (!(await findActiveExerciseConsent(session.childId))) {
    await finishWithoutMl(job, session.filePath)
    return
  }

  const fullPath = path.resolve(process.cwd(), session.filePath)
  const fileAvailable = session.videoDeletedAt === null && fs.existsSync(fullPath)

  // Persist the subject id before calling the ML server so a crash in between
  // still lets reconcile() / data deletion find what was sent.
  const subjectId = session.mlSubjectId ?? `ex_${session.id}`
  await updateLocked(job, { mlSubjectId: subjectId, mlSubjectDeletedAt: null })
  ctx.mlSubjectId = subjectId

  let mlSubjectId = subjectId
  let extract: OpenPoseExtractResponse | null = null
  if (fileAvailable) {
    const result = await extractOnMl(job, session.id, fullPath, subjectId)
    extract = result.extract
    mlSubjectId = result.mlSubjectId
    ctx.mlSubjectId = mlSubjectId
  }

  let keypoints
  try {
    keypoints = await openposeService.getSubjectKeypoints(mlSubjectId)
  } catch (error) {
    if (error instanceof OpenPoseApiError && error.kind === 'http' && error.status === 404) {
      if (!fileAvailable) throw new JobError(EXERCISE_MESSAGES.videoGone)
      // Extraction answered 409 but its keypoints are not there yet.
      throw new RetryableJobError('Máy chủ phân tích vẫn đang xử lý video này.')
    }
    throw error
  }

  const frames = keypoints.frames ?? []
  const fps = resolveExerciseFps({
    recordedVia: session.recordedVia as RecordedVia,
    frameCount: frames.length,
    durationMs: session.durationMs,
    mlFps: keypoints.video?.fps ?? extract?.video?.fps ?? null,
  })
  if (!fps) throw new JobError(EXERCISE_MESSAGES.noDuration)

  const width = session.videoWidth ?? keypoints.video?.width ?? null
  const height = session.videoHeight ?? keypoints.video?.height ?? null
  const result = scoreImitation({
    template: session.template.features as unknown as TemplateFeatures,
    templateHash: session.template.templateHash,
    templateId: session.template.id,
    mirrorPolicy: session.template.mirrorPolicy as MirrorPolicyValue,
    frames,
    fps: fps.fps,
    fpsSource: fps.source,
    fpsWarning: fps.warning,
    videoSize: width && height ? { width, height } : null,
    practiceMode: session.practiceMode as PracticeMode,
    playbackRate: session.playbackRate,
    guideOffsetMs: session.guideOffsetMs,
  })

  const status = result.status === 'SCORED' ? ExerciseSessionStatus.SCORED : ExerciseSessionStatus.INSUFFICIENT
  const scoreData = {
    templateId: session.template.id,
    templateHash: result.templateHash,
    status: result.status,
    overall: result.status === 'SCORED' ? result.overall : null,
    stars: result.status === 'SCORED' ? result.stars : null,
    band: result.status === 'SCORED' ? result.band : null,
    mode: result.mode,
    reasonCodes: result.reasonCodes,
    detail: result as unknown as Prisma.InputJsonValue,
  }
  await prisma.$transaction(async (tx) => {
    const updated = await tx.exerciseSession.updateMany({
      where: { id: session.id, lockedBy: WORKER_ID, status: ExerciseSessionStatus.PROCESSING },
      data: { status, completedAt: new Date(), lockedBy: null, lockedAt: null, errorMessage: null, lastError: null },
    })
    if (!updated.count) throw new LostLockError(`lost the lock on ${session.id} before saving the score`)
    await tx.sessionScore.upsert({
      where: { sessionId_algorithmVersion: { sessionId: session.id, algorithmVersion: result.algorithmVersion } },
      create: { sessionId: session.id, algorithmVersion: result.algorithmVersion, ...scoreData },
      update: scoreData,
    })
  })
  // eslint-disable-next-line no-console
  console.log(`${LOG} session ${session.id} → ${status} (${Math.round(result.quality.scoringMs)} ms scoring)`)

  await cleanupAfterScoring(session.id, session.filePath, mlSubjectId)
}

async function extractOnMl(job: ClaimedSession, sessionId: string, fullPath: string, subjectId: string) {
  let caps = await getMlCapabilities()
  // An "unreachable" probe is cached for 60 s; without a fresh probe every
  // retry inside that window would fail without contacting the ML server.
  if (!caps.reachable) caps = await getMlCapabilities({ force: true })
  if (!caps.reachable) {
    throw new OpenPoseApiError('ML server unreachable (capability probe)', 'network')
  }
  const upload = chooseMlUpload({
    ext: path.extname(fullPath),
    legacy: caps.legacy,
    webmAsMkv: env.EXERCISE_WEBM_AS_MKV,
  })
  if (upload === 'UNSUPPORTED') throw new JobError(EXERCISE_MESSAGES.formatUnsupported)

  let extract: OpenPoseExtractResponse | null = null
  try {
    extract = await openposeService.extractSubject({
      filePath: fullPath,
      originalFilename: upload.filename,
      mimeType: upload.mimeType,
      subjectId,
      timeoutMs: env.EXERCISE_EXTRACT_TIMEOUT_MS,
    })
  } catch (error) {
    // 409 = an earlier attempt already created the subject.
    if (!(error instanceof OpenPoseApiError && error.kind === 'http' && error.status === 409)) throw error
  }

  let mlSubjectId = subjectId
  const returned = extract?.subject_id
  if (returned && returned !== subjectId) {
    // ML 1.0 may ignore ?subject_id: track the id it really used.
    await updateLocked(job, { mlSubjectId: returned })
    mlSubjectId = returned
    // eslint-disable-next-line no-console
    console.warn(`${LOG} ML server ignored subject_id for session ${sessionId}; using the returned id`)
  }
  return { extract, mlSubjectId }
}

/** Update the claimed row only while this worker still holds it. */
async function updateLocked(job: ClaimedSession, data: Prisma.ExerciseSessionUpdateManyMutationInput) {
  const updated = await prisma.exerciseSession.updateMany({
    where: { id: job.id, lockedBy: WORKER_ID, status: ExerciseSessionStatus.PROCESSING },
    data,
  })
  if (!updated.count) throw new LostLockError(`lost the lock on ${job.id}`)
}

async function finishWithoutMl(job: ClaimedSession, filePath: string) {
  const deleted = await unlinkExerciseFile(filePath)
  await updateLocked(job, {
    status: ExerciseSessionStatus.FAILED,
    // No more attempts: retry needs a new consent and the video is gone.
    errorMessage: EXERCISE_MESSAGES.consentRevoked,
    lastError: 'Exercise consent not active when the worker picked the session up',
    lockedBy: null,
    lockedAt: null,
    completedAt: new Date(),
    ...(deleted ? { videoDeletedAt: new Date() } : {}),
  })
  // eslint-disable-next-line no-console
  console.log(`${LOG} session ${job.id} → FAILED (exercise consent not active, no ML call)`)
}

async function cleanupAfterScoring(sessionId: string, filePath: string, mlSubjectId: string) {
  try {
    if (await unlinkExerciseFile(filePath)) {
      await prisma.exerciseSession.updateMany({ where: { id: sessionId }, data: { videoDeletedAt: new Date() } })
    }
    if (await deleteMlSubject(mlSubjectId)) {
      await prisma.exerciseSession.updateMany({ where: { id: sessionId }, data: { mlSubjectDeletedAt: new Date() } })
    }
  } catch (error) {
    // The score is saved; reconcile() finishes the cleanup later.
    // eslint-disable-next-line no-console
    console.error(`${LOG} cleanup after scoring ${sessionId} failed:`, (error as Error)?.message ?? error)
  }
}

// ---------------------------------------------------------------------------
// Failures
// ---------------------------------------------------------------------------

function isRetryable(error: unknown): boolean {
  if (error instanceof RetryableJobError) return true
  if (error instanceof OpenPoseApiError) return error.retryable
  return false
}

/** Parent-facing text: no URLs, no stack traces, no OpenPose stderr. */
function exerciseUserFacingError(error: unknown): string {
  if (error instanceof JobError) return error.message
  if (error instanceof OpenPoseApiError && error.kind === 'http' && !error.retryable) return EXERCISE_MESSAGES.unreadable
  return EXERCISE_MESSAGES.final
}

async function recordFailure(job: ClaimedSession, ctx: RunContext, error: unknown) {
  if (error instanceof LostLockError) {
    const exists = await prisma.exerciseSession.count({ where: { id: job.id } })
    if (!exists) await discardVanished(job.id, ctx)
    // Otherwise another worker owns the session now; it decides what happens.
    return
  }
  if (!(await prisma.exerciseSession.count({ where: { id: job.id } }))) {
    await discardVanished(job.id, ctx)
    return
  }

  const technical = (error instanceof Error ? error.message : String(error)).slice(0, 2000)
  const retry = isRetryable(error) && job.attempts < job.maxAttempts
  // eslint-disable-next-line no-console
  console.error(`${LOG} session ${job.id} attempt ${job.attempts}/${job.maxAttempts} failed:`, technical)

  if (retry) {
    await prisma.exerciseSession.updateMany({
      where: { id: job.id, lockedBy: WORKER_ID },
      data: {
        status: ExerciseSessionStatus.QUEUED,
        lockedBy: null,
        lockedAt: null,
        runAfter: new Date(Date.now() + exerciseRetryDelayMs(job.attempts)),
        lastError: technical,
        errorMessage: EXERCISE_MESSAGES.retrying(job.attempts + 1, job.maxAttempts),
      },
    })
    return
  }

  // Final: keep the video (≤ 24 h) for "Thử chấm lại", but do not leave the
  // ML subject behind.
  const updated = await prisma.exerciseSession.updateMany({
    where: { id: job.id, lockedBy: WORKER_ID },
    data: {
      status: ExerciseSessionStatus.FAILED,
      lockedBy: null,
      lockedAt: null,
      completedAt: new Date(),
      lastError: technical,
      errorMessage: exerciseUserFacingError(error),
    },
  })
  if (updated.count && ctx.mlSubjectId && (await deleteMlSubject(ctx.mlSubjectId))) {
    await prisma.exerciseSession.updateMany({
      where: { id: job.id, status: ExerciseSessionStatus.FAILED },
      data: { mlSubjectDeletedAt: new Date() },
    })
  }
}

/**
 * The row disappeared mid-run (e.g. an older backend deleted the child, which
 * cascades without asking the ML server): drop whatever this run produced.
 */
async function discardVanished(sessionId: string, ctx: RunContext) {
  if (ctx.filePath) {
    await unlinkExerciseFile(ctx.filePath)
  } else {
    // Gone before it was loaded: uploads are stored as <session id><ext>.
    for (const ext of EXERCISE_EXTENSIONS) await unlinkExerciseFile(path.join(EXERCISE_UPLOAD_DIR, `${sessionId}${ext}`))
  }
  if (ctx.mlSubjectId) await deleteMlSubject(ctx.mlSubjectId)
  // eslint-disable-next-line no-console
  console.warn(`${LOG} session ${sessionId} was deleted during scoring; discarded its video and ML data`)
}

// ---------------------------------------------------------------------------
// Files and ML subjects
// ---------------------------------------------------------------------------

/** True when the file is gone afterwards. Only touches files under uploads/exercises. */
export async function unlinkExerciseFile(filePath: string): Promise<boolean> {
  const root = path.resolve(process.cwd(), EXERCISE_UPLOAD_DIR)
  const fullPath = path.resolve(process.cwd(), filePath)
  if (!fullPath.startsWith(root + path.sep)) return false
  try {
    await fs.promises.unlink(fullPath)
    return true
  } catch (error: any) {
    if (error?.code === 'ENOENT') return true
    // eslint-disable-next-line no-console
    console.error(`${LOG} could not delete ${path.basename(fullPath)}:`, error?.message ?? error)
    return false
  }
}

/** True when the ML server no longer holds the subject (a JSON 404/422 counts as deleted). */
async function deleteMlSubject(subjectId: string): Promise<boolean> {
  try {
    await openposeService.deleteSubject(subjectId)
    return true
  } catch (error) {
    if (error instanceof OpenPoseApiError && error.kind === 'http' && (error.status === 404 || error.status === 422)) {
      return true
    }
    // eslint-disable-next-line no-console
    console.error(`${LOG} could not delete ML subject ${subjectId}:`, (error as Error)?.message ?? error)
    return false
  }
}
