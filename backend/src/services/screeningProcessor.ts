/**
 * Durable screening queue.
 *
 * Jobs live in the ScreeningJob table, so a backend restart no longer leaves
 * uploads stuck in PROCESSING. A worker in this process claims due jobs with
 * FOR UPDATE SKIP LOCKED (safe with several backend instances), refreshes
 * lockedAt as a heartbeat while OpenPose runs, and retries transient failures
 * with exponential backoff. Jobs whose heartbeat stops (crash/restart) are
 * re-queued after STALE_LOCK_MS.
 *
 * Timestamps come from the app clock: the columns are TIMESTAMP without time
 * zone holding UTC (Prisma's convention) and the database session time zone
 * may not be UTC (initdb picks the host's zone, e.g. Asia/Bangkok), so neither
 * SQL NOW() nor raw-bound Date parameters may be compared with them directly.
 */
import fs from 'fs'
import os from 'os'
import path from 'path'
import { randomUUID } from 'crypto'
import { JobStatus, Prisma, ScreeningStatus } from '@prisma/client'
import { env } from '../lib/env'
import { prisma } from '../lib/prisma'
import { SCHEMA_OUTDATED_HINT, isSchemaOutdatedError } from '../lib/prismaErrors'
import { generateMockAiResult, toRiskEnum } from './aiMock'
import { computeGaitFeatures, resolveFps, type GaitFeatures } from './gaitFeatures'
import {
  OpenPoseApiError,
  getOpenPoseBaseUrl,
  openposeService,
  type OpenPoseKeypointFrame,
  type OpenPosePipelineResponse,
} from './openposeService'
import { normalizePrediction } from './screeningResult'

const WORKER_ID = `${os.hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`
const HEARTBEAT_MS = 30_000
const STALE_LOCK_MS = 2 * 60_000
const BACKOFF_BASE_MS = 30_000
const RECOVERY_EVERY_TICKS = 10
const SCHEMA_RETRY_MS = 60_000

/** Failure the worker should retry later (e.g. the ML server is still busy). */
class RetryableJobError extends Error {}
/** Failure with a message that is already safe to show to parents. */
class JobError extends Error {}

type ClaimedJob = { id: string; videoId: string; attempts: number; maxAttempts: number }

let stopped = true
let polling = false
let running = 0
let ticks = 0
let consecutivePollErrors = 0
let pausedUntil = 0
let timer: NodeJS.Timeout | null = null

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Queue (or re-queue) analysis of an upload. Idempotent: queued/running jobs
 * are left alone, failed ones start over with a fresh attempt budget.
 */
export async function enqueueScreeningProcessing(videoId: string): Promise<{ status: JobStatus }> {
  const now = new Date()
  const job = await prisma.screeningJob.upsert({
    where: { videoId },
    create: { videoId, status: JobStatus.QUEUED, maxAttempts: env.SCREENING_MAX_ATTEMPTS, runAfter: now },
    update: {},
  })

  let status = job.status
  if (job.status === JobStatus.FAILED || job.status === JobStatus.SUCCEEDED) {
    // SUCCEEDED without a result only happens if the result row was deleted.
    const requeued = await prisma.screeningJob.updateMany({
      where: { id: job.id, status: job.status },
      data: {
        status: JobStatus.QUEUED,
        attempts: 0,
        maxAttempts: env.SCREENING_MAX_ATTEMPTS,
        runAfter: now,
        lockedBy: null,
        lockedAt: null,
        lastError: null,
      },
    })
    if (requeued.count) status = JobStatus.QUEUED
  }

  await prisma.videoUpload.update({
    where: { id: videoId },
    data: { status: ScreeningStatus.PROCESSING, errorMessage: null },
  })

  kick()
  return { status }
}

/** 1-based position among queued jobs, or null when the job is not waiting. */
export async function getQueuePosition(videoId: string): Promise<number | null> {
  const job = await prisma.screeningJob.findUnique({ where: { videoId } })
  if (!job || job.status !== JobStatus.QUEUED) return null
  const ahead = await prisma.screeningJob.count({
    where: { status: { in: [JobStatus.QUEUED, JobStatus.RUNNING] }, createdAt: { lt: job.createdAt } },
  })
  return ahead + 1
}

export function startScreeningWorker() {
  if (!stopped) return
  stopped = false
  timer = setInterval(() => void tick(), env.SCREENING_POLL_INTERVAL_MS)
  kick()
  // eslint-disable-next-line no-console
  console.log(`[screening-queue] worker ${WORKER_ID} started (concurrency ${env.ML_MAX_CONCURRENCY})`)
}

export function stopScreeningWorker() {
  stopped = true
  if (timer) clearInterval(timer)
  timer = null
}

// ---------------------------------------------------------------------------
// Worker loop
// ---------------------------------------------------------------------------

function kick() {
  setImmediate(() => void tick())
}

async function tick() {
  if (stopped || polling || Date.now() < pausedUntil) return
  polling = true
  try {
    if (ticks % RECOVERY_EVERY_TICKS === 0) await recoverStaleJobs()
    ticks += 1

    const free = env.ML_MAX_CONCURRENCY - running
    if (free > 0) {
      const jobs = await claimJobs(free)
      for (const job of jobs) {
        running += 1
        void processJob(job).finally(() => {
          running -= 1
          kick()
        })
      }
    }
    consecutivePollErrors = 0
  } catch (error) {
    if (isSchemaOutdatedError(error)) {
      // Missing ScreeningJob table/columns: retrying every few seconds is pointless.
      pausedUntil = Date.now() + SCHEMA_RETRY_MS
      if (consecutivePollErrors === 0) {
        // eslint-disable-next-line no-console
        console.error(`[screening-queue] paused: ${SCHEMA_OUTDATED_HINT}`)
      }
      consecutivePollErrors += 1
      return
    }
    consecutivePollErrors += 1
    // Avoid flooding the log while the database is unreachable.
    if (consecutivePollErrors === 1 || consecutivePollErrors % 20 === 0) {
      // eslint-disable-next-line no-console
      console.error(`[screening-queue] poll failed (${consecutivePollErrors}x):`, (error as Error)?.message ?? error)
    }
  } finally {
    polling = false
  }
}

async function claimJobs(limit: number): Promise<ClaimedJob[]> {
  // A JS Date bound in raw SQL arrives as timestamptz and would be shifted to
  // the session time zone when compared with these naive UTC columns, so pass
  // an ISO string and convert it to naive UTC explicitly.
  const nowIso = new Date().toISOString()
  return prisma.$queryRaw<ClaimedJob[]>`
    UPDATE "ScreeningJob" AS j
    SET "status" = 'RUNNING',
        "lockedBy" = ${WORKER_ID},
        "lockedAt" = (${nowIso}::timestamptz AT TIME ZONE 'UTC'),
        "attempts" = j."attempts" + 1,
        "updatedAt" = (${nowIso}::timestamptz AT TIME ZONE 'UTC')
    WHERE j."id" IN (
      SELECT "id" FROM "ScreeningJob"
      WHERE "status" = 'QUEUED' AND "runAfter" <= (${nowIso}::timestamptz AT TIME ZONE 'UTC')
      ORDER BY "createdAt"
      LIMIT ${limit}::int
      FOR UPDATE SKIP LOCKED
    )
    RETURNING j."id", j."videoId", j."attempts", j."maxAttempts"`
}

async function recoverStaleJobs() {
  const staleBefore = new Date(Date.now() - STALE_LOCK_MS)
  const stale = await prisma.screeningJob.findMany({
    where: { status: JobStatus.RUNNING, lockedAt: { lt: staleBefore } },
  })
  for (const job of stale) {
    const exhausted = job.attempts >= job.maxAttempts
    const updated = await prisma.screeningJob.updateMany({
      // Guard on lockedAt so a job whose heartbeat just resumed is not stolen.
      where: { id: job.id, status: JobStatus.RUNNING, lockedAt: { lt: staleBefore } },
      data: {
        status: exhausted ? JobStatus.FAILED : JobStatus.QUEUED,
        lockedBy: null,
        lockedAt: null,
        runAfter: new Date(),
        lastError: job.lastError ?? 'Worker stopped while processing (backend restart?)',
      },
    })
    if (updated.count && exhausted) {
      await prisma.videoUpload.update({
        where: { id: job.videoId },
        data: {
          status: ScreeningStatus.FAILED,
          errorMessage: 'Quá trình phân tích bị gián đoạn nhiều lần. Vui lòng thử lại.',
        },
      })
    }
    if (updated.count) {
      // eslint-disable-next-line no-console
      console.warn(`[screening-queue] recovered stale job ${job.id} → ${exhausted ? 'FAILED' : 'QUEUED'}`)
    }
  }
}

async function processJob(job: ClaimedJob) {
  const heartbeat = setInterval(() => {
    prisma.screeningJob
      .updateMany({
        where: { id: job.id, lockedBy: WORKER_ID, status: JobStatus.RUNNING },
        data: { lockedAt: new Date() },
      })
      .catch(() => {})
  }, HEARTBEAT_MS)

  try {
    await runScreening(job)
  } catch (error) {
    const technical = error instanceof Error ? error.message : String(error)
    const retry = isRetryable(error) && job.attempts < job.maxAttempts
    // eslint-disable-next-line no-console
    console.error(
      `[screening-queue] job ${job.id} (video ${job.videoId}) attempt ${job.attempts}/${job.maxAttempts} failed:`,
      technical,
    )

    if (retry) {
      const delay = BACKOFF_BASE_MS * 2 ** Math.max(0, job.attempts - 1)
      await prisma.screeningJob.updateMany({
        where: { id: job.id, lockedBy: WORKER_ID },
        data: {
          status: JobStatus.QUEUED,
          lockedBy: null,
          lockedAt: null,
          runAfter: new Date(Date.now() + delay),
          lastError: technical,
        },
      })
      await prisma.videoUpload.update({
        where: { id: job.videoId },
        data: {
          errorMessage: `${userFacingError(error, false)} Hệ thống sẽ tự thử lại (lần ${job.attempts + 1}/${job.maxAttempts}).`,
        },
      })
    } else {
      await prisma.screeningJob.updateMany({
        where: { id: job.id, lockedBy: WORKER_ID },
        data: { status: JobStatus.FAILED, lockedBy: null, lockedAt: null, lastError: technical },
      })
      await prisma.videoUpload.update({
        where: { id: job.videoId },
        data: { status: ScreeningStatus.FAILED, errorMessage: userFacingError(error, true) },
      })
    }
  } finally {
    clearInterval(heartbeat)
  }
}

function isRetryable(error: unknown): boolean {
  if (error instanceof RetryableJobError) return true
  if (error instanceof OpenPoseApiError) return error.retryable
  return false
}

function truncate(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/** Parent-facing message: no URLs, no stack traces, no OpenPose stderr. */
function userFacingError(error: unknown, final: boolean): string {
  if (error instanceof JobError || error instanceof RetryableJobError) return error.message
  if (error instanceof OpenPoseApiError) {
    if (error.kind === 'network' || error.kind === 'html') {
      return final
        ? 'Không kết nối được máy chủ phân tích sau nhiều lần thử. Vui lòng thử lại sau.'
        : 'Chưa kết nối được máy chủ phân tích.'
    }
    if (error.kind === 'timeout') return 'Máy chủ phân tích xử lý quá lâu (hết thời gian chờ).'
    if (error.kind === 'invalid_json') return 'Máy chủ phân tích trả về dữ liệu không hợp lệ.'
    if (error.status && error.status < 500) {
      return `Máy chủ phân tích không xử lý được video${error.detail ? `: ${truncate(error.detail, 200)}` : '.'}`
    }
    // 5xx: usually an infrastructure problem (e.g. the GPU server lost CUDA).
    // "No person detected" arrives as 422 from updated ML servers (branch above).
    return final
      ? 'Máy chủ phân tích gặp sự cố kỹ thuật khi xử lý video. Vui lòng thử lại sau; nếu vẫn lỗi, hãy liên hệ quản trị viên.'
      : 'Máy chủ phân tích đang gặp sự cố kỹ thuật.'
  }
  return 'Đã xảy ra lỗi khi phân tích video.'
}

// ---------------------------------------------------------------------------
// One screening
// ---------------------------------------------------------------------------

async function runScreening(job: ClaimedJob) {
  const video = await prisma.videoUpload.findUnique({ where: { id: job.videoId }, include: { result: true } })
  if (!video) throw new JobError('Không tìm thấy video cần phân tích.')

  if (video.result) {
    await finishJob(job, video.id)
    return
  }

  if (env.BYPASS_EXTRACT_API) {
    await createMockResult(job, video.id)
    return
  }

  const fullPath = path.resolve(process.cwd(), video.filePath)
  let response: OpenPosePipelineResponse
  if (!fs.existsSync(fullPath)) {
    // The ML server may still hold this subject from an earlier attempt.
    response = await recoverFromExistingSubject(video.id, true)
  } else {
    try {
      response = await openposeService.runPipelineAsd({
        filePath: fullPath,
        originalFilename: video.originalFilename,
        mimeType: video.mimeType,
        subjectId: video.id,
        threshold: env.SCREENING_THRESHOLD,
        temperature: env.SCREENING_TEMPERATURE,
        returnKeypoints: true,
      })
    } catch (error) {
      // 409 = the subject already exists (an earlier attempt reached the ML
      // server before this backend restarted or timed out).
      if (error instanceof OpenPoseApiError && error.status === 409) {
        response = await recoverFromExistingSubject(video.id, false)
      } else {
        throw error
      }
    }
  }

  const gaitFeatures = await buildGaitFeatures(video.id, response, video.durationMs)
  const normalized = normalizePrediction(
    response.prediction,
    { threshold: env.SCREENING_THRESHOLD, highRiskThreshold: env.SCREENING_HIGH_RISK_THRESHOLD },
    gaitFeatures?.quality.level,
  )

  const { frames: _frames, saved: _saved, ...responseWithoutFrames } = response
  await prisma.$transaction([
    prisma.screeningResult.create({
      data: {
        videoId: video.id,
        riskLevel: normalized.riskLevel,
        confidenceScore: normalized.confidenceScore,
        ...normalized.legacyScores,
        asdProbability: normalized.asdProbability,
        decisionThreshold: normalized.decisionThreshold,
        highRiskThreshold: normalized.highRiskThreshold,
        calibrated: normalized.calibrated,
        modelVersion: normalized.modelVersion,
        gaitFeatures: (gaitFeatures ?? Prisma.JsonNull) as Prisma.InputJsonValue | typeof Prisma.JsonNull,
        recommendation: normalized.recommendation,
        rawAiResponse: {
          provider: 'openpose-stgcn',
          apiUrl: `${getOpenPoseBaseUrl()}/pipeline/asd`,
          subjectId: response.subject_id || video.id,
          numFrames: response.num_frames,
          keypointFormat: response.keypoint_format,
          generated_at: new Date().toISOString(),
          response: responseWithoutFrames as unknown as Prisma.InputJsonValue,
        },
      },
    }),
    ...finishJobOps(job, video.id),
  ])

  await discardRawVideo(video.id, fullPath)
}

async function recoverFromExistingSubject(
  subjectId: string,
  fileMissing: boolean,
): Promise<OpenPosePipelineResponse> {
  let detail
  try {
    detail = await openposeService.getSubject(subjectId)
  } catch (error) {
    if (error instanceof OpenPoseApiError && error.status === 404) {
      if (fileMissing) throw new JobError('Video gốc không còn trên máy chủ. Vui lòng tải video lên lại.')
      // Folder exists without metadata: extraction is still running upstream.
      throw new RetryableJobError('Máy chủ phân tích vẫn đang xử lý video này.')
    }
    throw error
  }

  const prediction =
    detail.prediction?.prediction ??
    (
      await openposeService.predictSubject(subjectId, {
        threshold: env.SCREENING_THRESHOLD,
        temperature: env.SCREENING_TEMPERATURE,
      })
    ).prediction

  let frames: OpenPoseKeypointFrame[] | undefined
  let videoInfo = detail.metadata.video
  try {
    const keypoints = await openposeService.getSubjectKeypoints(subjectId)
    frames = keypoints.frames
    videoInfo = videoInfo ?? keypoints.video
  } catch {
    frames = undefined
  }

  return {
    subject_id: subjectId,
    filename: detail.metadata.filename,
    num_frames: detail.metadata.num_frames,
    keypoint_format: detail.metadata.keypoint_format,
    prediction,
    video: videoInfo,
    frames,
  }
}

async function buildGaitFeatures(
  subjectId: string,
  response: OpenPosePipelineResponse,
  uploadDurationMs: number | null,
): Promise<GaitFeatures | null> {
  try {
    let frames = response.frames
    if (!frames) frames = (await openposeService.getSubjectKeypoints(subjectId)).frames
    if (!frames?.length) return null
    const { fps, source } = resolveFps({
      mlFps: response.video?.fps,
      numFrames: response.num_frames ?? frames.length,
      uploadDurationMs,
    })
    return computeGaitFeatures({ frames, fps, fpsSource: source })
  } catch (error) {
    // Gait descriptors are supplementary; never fail the screening for them.
    // eslint-disable-next-line no-console
    console.error(`[screening-queue] gait features failed for ${subjectId}:`, (error as Error)?.message ?? error)
    return null
  }
}

function finishJobOps(job: ClaimedJob, videoId: string) {
  return [
    prisma.screeningJob.updateMany({
      where: { id: job.id },
      data: { status: JobStatus.SUCCEEDED, lockedBy: null, lockedAt: null, lastError: null },
    }),
    prisma.videoUpload.update({
      where: { id: videoId },
      data: { status: ScreeningStatus.COMPLETED, errorMessage: null },
    }),
  ]
}

async function finishJob(job: ClaimedJob, videoId: string) {
  await prisma.$transaction(finishJobOps(job, videoId))
}

/** Privacy: keep skeleton + result, drop the raw upload unless configured otherwise. */
async function discardRawVideo(videoId: string, fullPath: string) {
  if (env.RETAIN_UPLOADED_VIDEOS) return
  try {
    await fs.promises.unlink(fullPath)
  } catch (error: any) {
    if (error?.code !== 'ENOENT') {
      // eslint-disable-next-line no-console
      console.error(`[screening-queue] could not delete raw video for ${videoId}:`, error?.message ?? error)
      return
    }
  }
  await prisma.videoUpload.update({ where: { id: videoId }, data: { videoDeletedAt: new Date() } })
}

async function createMockResult(job: ClaimedJob, videoId: string) {
  const mock = generateMockAiResult()
  await prisma.$transaction([
    prisma.screeningResult.create({
      data: {
        videoId,
        riskLevel: toRiskEnum(mock.risk_level),
        confidenceScore: mock.confidence_score,
        // Legacy columns kept non-null for older backends sharing the database.
        eyeContactScore: mock.behavioral_scores.eye_contact,
        motorPatternScore: mock.behavioral_scores.motor_pattern,
        responseBehaviorScore: mock.behavioral_scores.response_behavior,
        repetitiveBehaviorScore: mock.behavioral_scores.repetitive_behavior,
        calibrated: false,
        recommendation: `[Chế độ mô phỏng — không phải kết quả của mô hình] ${mock.recommendation}`,
        rawAiResponse: { ...mock, provider: 'mock', generated_at: new Date().toISOString() },
      },
    }),
    ...finishJobOps(job, videoId),
  ])
}
