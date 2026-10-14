/**
 * Permanent deletion of a child's data at the parent's request: database rows
 * (uploads, results, jobs, consent records, exercise sessions and scores,
 * questionnaire responses), the raw videos kept on this server and the
 * keypoints / video copies kept by the ML server.
 *
 * Order matters. The ML server is cleaned first, so when it is unreachable
 * the profile and results stay intact and the parent can retry, instead of
 * leaving skeleton data on the ML server that nothing points to any more.
 * The database delete then runs in one transaction that locks the affected
 * rows: the queue workers claim with FOR UPDATE SKIP LOCKED, so they can
 * neither start one of them meanwhile nor find them afterwards. Running jobs
 * (and exercise sessions being scored) block the deletion because the ML
 * server would recreate the subject when they finish.
 *
 * The exercise and questionnaire tables may not exist yet on a shared
 * database that has not had the Giai đoạn 4 migrations applied; deleting a
 * child must still work there, so those steps are skipped when the tables are
 * missing.
 */
import fs from 'fs'
import path from 'path'
import { ExerciseSessionStatus, JobStatus, Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { mayHaveMlData, mlSubjectIdFor } from '../lib/screeningData'
import { sessionFingerprint, sessionMayHaveMlData } from '../lib/exerciseData'
import { OpenPoseApiError, openposeService } from './openposeService'

export type DataDeletionErrorCode = 'SCREENING_IN_PROGRESS' | 'EXERCISE_IN_PROGRESS' | 'ML_UNAVAILABLE'

export class DataDeletionError extends Error {
  constructor(
    readonly code: DataDeletionErrorCode,
    readonly httpStatus: number,
    message: string,
  ) {
    super(message)
    this.name = 'DataDeletionError'
  }
}

export type DeletionSummary = {
  deletedScreenings: number
  mlSubjectsDeleted: number
  deletedExerciseSessions: number
  deletedQuestionnaires: number
}

const deletableVideoSelect = {
  id: true,
  status: true,
  filePath: true,
  job: { select: { status: true, attempts: true } },
  result: { select: { rawAiResponse: true } },
} satisfies Prisma.VideoUploadSelect

type DeletableVideo = Prisma.VideoUploadGetPayload<{ select: typeof deletableVideoSelect }>

const deletableSessionSelect = {
  id: true,
  status: true,
  filePath: true,
  attempts: true,
  mlSubjectId: true,
  mlSubjectDeletedAt: true,
} satisfies Prisma.ExerciseSessionSelect

type DeletableSession = Prisma.ExerciseSessionGetPayload<{ select: typeof deletableSessionSelect }>

function inProgress() {
  return new DataDeletionError(
    'SCREENING_IN_PROGRESS',
    409,
    'A screening is being analysed; delete the data once the analysis has finished.',
  )
}

function exerciseInProgress() {
  return new DataDeletionError(
    'EXERCISE_IN_PROGRESS',
    409,
    'An exercise attempt is being scored; delete the data once scoring has finished.',
  )
}

/** Changes whenever the worker may have sent the upload to the ML server again. */
function processingFingerprint(video: DeletableVideo) {
  return `${video.job ? `${video.job.status}:${video.job.attempts}` : 'no-job'}|${video.result ? 'result' : '-'}`
}

function assertNoneRunning(videos: DeletableVideo[]) {
  if (videos.some((v) => v.job?.status === JobStatus.RUNNING)) throw inProgress()
}

function assertNoSessionProcessing(sessions: DeletableSession[]) {
  if (sessions.some((s) => s.status === ExerciseSessionStatus.PROCESSING)) throw exerciseInProgress()
}

/** Ask the ML server to delete each subject; throws ML_UNAVAILABLE (nothing deleted locally) on failure. */
async function deleteSubjectsOnMl(subjectIds: string[]): Promise<number> {
  let deleted = 0
  const failures: string[] = []
  for (const subjectId of subjectIds) {
    try {
      await openposeService.deleteSubject(subjectId)
      deleted += 1
    } catch (error) {
      // A JSON 404 means nothing is stored (failed runs clean up after
      // themselves); 422 is an id the ML server refuses to store. An HTML 404
      // is an offline ngrok tunnel, i.e. a failure.
      if (error instanceof OpenPoseApiError && error.kind === 'http' && (error.status === 404 || error.status === 422)) {
        continue
      }
      failures.push(`${subjectId}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (failures.length) {
    // eslint-disable-next-line no-console
    console.error(`[data-deletion] ML server did not delete ${failures.length} subject(s): ${failures.join('; ')}`)
    throw new DataDeletionError(
      'ML_UNAVAILABLE',
      503,
      'Could not delete the skeleton data on the ML server; the profile and results were kept.',
    )
  }
  return deleted
}

/**
 * Inside the deletion transaction: lock the jobs, refuse running ones and any
 * upload that was (re)processed after its ML data was cleaned.
 */
async function lockAndCheck(tx: Prisma.TransactionClient, videos: DeletableVideo[], cleaned: Map<string, string>) {
  if (videos.length) {
    await tx.$queryRaw`SELECT "id" FROM "ScreeningJob" WHERE "videoId" IN (${Prisma.join(videos.map((v) => v.id))}) FOR UPDATE`
  }
  // Re-read under the locks: the snapshot above may predate a worker claim.
  const current = await tx.videoUpload.findMany({
    where: { id: { in: videos.map((v) => v.id) } },
    select: deletableVideoSelect,
  })
  assertNoneRunning(current)
  for (const video of current) {
    const before = cleaned.get(video.id)
    if (before === undefined ? mayHaveMlData(video) : before !== processingFingerprint(video)) throw inProgress()
  }
  return current
}

/**
 * Same check for exercise sessions re-read under their row locks: refuse
 * sessions the worker claimed, or (re)sent to the ML server, after the ML
 * cleanup ran.
 */
function checkSessions(current: DeletableSession[], cleaned: Map<string, string>) {
  assertNoSessionProcessing(current)
  for (const s of current) {
    const before = cleaned.get(s.id)
    if (before === undefined ? sessionMayHaveMlData(s) : before !== sessionFingerprint(s)) throw exerciseInProgress()
  }
}

async function removeUploadFile(filePath: string) {
  const uploadsDir = path.join(process.cwd(), 'uploads')
  const fullPath = path.resolve(process.cwd(), filePath)
  if (!fullPath.startsWith(uploadsDir + path.sep)) return
  try {
    await fs.promises.unlink(fullPath)
  } catch (error: any) {
    if (error?.code !== 'ENOENT') {
      // eslint-disable-next-line no-console
      console.error(`[data-deletion] could not delete upload ${path.basename(fullPath)}:`, error?.message ?? error)
    }
  }
}

async function cleanMlServer(videos: DeletableVideo[], sessions: DeletableSession[] = []) {
  // Refuse before touching anything when either queue is busy with this data.
  assertNoneRunning(videos)
  assertNoSessionProcessing(sessions)
  const mlSubjectsDeleted =
    (await deleteSubjectsOnMl(videos.filter((v) => mayHaveMlData(v)).map((v) => mlSubjectIdFor(v)))) +
    (await deleteSubjectsOnMl(sessions.filter(sessionMayHaveMlData).map((s) => s.mlSubjectId!)))
  const cleaned = new Map(videos.map((v) => [v.id, processingFingerprint(v)]))
  const cleanedSessions = new Map(sessions.map((s) => [s.id, sessionFingerprint(s)]))
  return { mlSubjectsDeleted, cleaned, cleanedSessions }
}

const TABLES_TTL_MS = 60_000
let tablesCache: { value: { exercise: boolean; questionnaire: boolean }; at: number } | null = null

/** Whether the Giai đoạn 4 tables exist (checked outside any transaction, cached 60 s). */
export async function exerciseTablesPresent(): Promise<{ exercise: boolean; questionnaire: boolean }> {
  if (tablesCache && Date.now() - tablesCache.at < TABLES_TTL_MS) return tablesCache.value
  // Unqualified names resolve through search_path, i.e. Prisma's ?schema=.
  const [row] = await prisma.$queryRaw<Array<{ exercise: boolean; questionnaire: boolean }>>`
    SELECT to_regclass('"ExerciseSession"') IS NOT NULL AS "exercise",
           to_regclass('"QuestionnaireResponse"') IS NOT NULL AS "questionnaire"`
  const value = { exercise: Boolean(row?.exercise), questionnaire: Boolean(row?.questionnaire) }
  // Only cache the migrated state: right after the owner applies the
  // migrations, a cached "missing" would skip ML cleanup of new sessions.
  tablesCache = value.exercise && value.questionnaire ? { value, at: Date.now() } : null
  return value
}

/** Delete a child profile with every screening, exercise attempt, questionnaire and consent record of that child. */
export async function deleteChildData(childId: string): Promise<DeletionSummary> {
  const tables = await exerciseTablesPresent()
  const videos = await prisma.videoUpload.findMany({ where: { childId }, select: deletableVideoSelect })
  const sessions = tables.exercise
    ? await prisma.exerciseSession.findMany({ where: { childId }, select: deletableSessionSelect })
    : []
  const { mlSubjectsDeleted, cleaned, cleanedSessions } = await cleanMlServer(videos, sessions)

  const removed = await prisma.$transaction(async (tx) => {
    // Blocks new uploads for this child (their FK check waits on this lock).
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "ChildProfile" WHERE "id" = ${childId} FOR UPDATE`
    if (!locked.length) return null
    let currentSessions: DeletableSession[] = []
    if (tables.exercise) {
      // The exercise worker claims with SKIP LOCKED, so it cannot start these now.
      await tx.$queryRaw`SELECT "id" FROM "ExerciseSession" WHERE "childId" = ${childId} FOR UPDATE`
      currentSessions = await tx.exerciseSession.findMany({ where: { childId }, select: deletableSessionSelect })
    }
    const current = await tx.videoUpload.findMany({ where: { childId }, select: deletableVideoSelect })
    const checked = await lockAndCheck(tx, current, cleaned)
    checkSessions(currentSessions, cleanedSessions)
    const questionnaires = tables.questionnaire ? await tx.questionnaireResponse.count({ where: { childId } }) : 0
    await tx.childProfile.delete({ where: { id: childId } })
    return { videos: checked, sessions: currentSessions, questionnaires }
  })

  if (!removed) {
    return { deletedScreenings: 0, mlSubjectsDeleted, deletedExerciseSessions: 0, deletedQuestionnaires: 0 }
  }
  for (const video of removed.videos) await removeUploadFile(video.filePath)
  for (const session of removed.sessions) await removeUploadFile(session.filePath)
  return {
    deletedScreenings: removed.videos.length,
    mlSubjectsDeleted,
    deletedExerciseSessions: removed.sessions.length,
    deletedQuestionnaires: removed.questionnaires,
  }
}

/** Delete one screening: upload row, result, job, raw video and ML data. */
export async function deleteScreeningData(videoId: string): Promise<DeletionSummary> {
  const videos = await prisma.videoUpload.findMany({ where: { id: videoId }, select: deletableVideoSelect })
  const { mlSubjectsDeleted, cleaned } = await cleanMlServer(videos)

  const removed = await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "VideoUpload" WHERE "id" = ${videoId} FOR UPDATE`
    if (!locked.length) return []
    const checked = await lockAndCheck(tx, videos, cleaned)
    await tx.videoUpload.delete({ where: { id: videoId } })
    return checked
  })

  for (const video of removed) await removeUploadFile(video.filePath)
  return { deletedScreenings: removed.length, mlSubjectsDeleted, deletedExerciseSessions: 0, deletedQuestionnaires: 0 }
}

/** Delete one exercise attempt: session row, its score, the raw video (if still kept) and ML data. */
export async function deleteExerciseSessionData(
  sessionId: string,
): Promise<{ deleted: boolean; mlSubjectsDeleted: number }> {
  const sessions = await prisma.exerciseSession.findMany({ where: { id: sessionId }, select: deletableSessionSelect })
  if (!sessions.length) return { deleted: false, mlSubjectsDeleted: 0 }
  const { mlSubjectsDeleted, cleanedSessions } = await cleanMlServer([], sessions)

  const removed = await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "ExerciseSession" WHERE "id" = ${sessionId} FOR UPDATE`
    if (!locked.length) return null
    const current = await tx.exerciseSession.findMany({ where: { id: sessionId }, select: deletableSessionSelect })
    checkSessions(current, cleanedSessions)
    await tx.exerciseSession.delete({ where: { id: sessionId } })
    return current[0] ?? null
  })

  if (removed) await removeUploadFile(removed.filePath)
  return { deleted: removed !== null, mlSubjectsDeleted }
}

/** Delete one stored questionnaire response (answers are only in the database). */
export async function deleteQuestionnaireResponse(id: string): Promise<{ deleted: boolean }> {
  const result = await prisma.questionnaireResponse.deleteMany({ where: { id } })
  return { deleted: result.count > 0 }
}
