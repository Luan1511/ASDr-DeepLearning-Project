import { Router, type NextFunction, type Request, type Response } from 'express'
import fs from 'fs'
import multer from 'multer'
import path from 'path'
import { randomUUID } from 'crypto'
import { ExerciseSessionStatus, ExerciseStatus, type Prisma } from '@prisma/client'
import { env } from '../lib/env'
import { prisma } from '../lib/prisma'
import {
  chooseMlUpload,
  isExerciseExtension,
  makeExerciseUploadBodySchema,
  maxRecordingMs,
  minRecordingMs,
  sessionListQuerySchema,
  uuidSchema,
} from '../lib/exerciseInput'
import { PENDING_SESSION_STATUSES } from '../lib/exerciseData'
import { serializeExerciseSession } from '../lib/exerciseSerializers'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../middleware/asyncHandler'
import { findActiveExerciseConsent } from '../services/consentService'
import { DataDeletionError, deleteExerciseSessionData } from '../services/dataDeletion'
import {
  EXERCISE_UPLOAD_DIR,
  getExerciseQueuePosition,
  isMlBusy,
  kickExerciseWorker,
} from '../services/exerciseProcessor'
import { getMlCapabilities } from '../services/mlCapabilities'
import { findOwnedChild, requireExercisesEnabled } from './exercises'

/** Practice attempts: upload, status, retry, delete. */
export const exerciseSessionsRouter = Router()

// Status codes only: no file names, no child data in the log.
exerciseSessionsRouter.use((req, res, next) => {
  res.on('finish', () => {
    // eslint-disable-next-line no-console
    console.log(`[exercise-sessions] ${req.method} ${req.baseUrl}${req.path} -> ${res.statusCode}`)
  })
  next()
})

exerciseSessionsRouter.use(requireAuth)

const sessionInclude = {
  exercise: { select: { id: true, slug: true, title: true } },
  template: { select: { version: true } },
  scores: {
    select: {
      algorithmVersion: true,
      status: true,
      overall: true,
      stars: true,
      band: true,
      mode: true,
      reasonCodes: true,
      detail: true,
      createdAt: true,
    },
  },
} satisfies Prisma.ExerciseSessionInclude

type SessionWithRelations = Prisma.ExerciseSessionGetPayload<{ include: typeof sessionInclude }>

/** Queue position and "ML busy" only matter while the session waits. */
async function serializeWithQueue(session: SessionWithRelations) {
  if (session.status !== ExerciseSessionStatus.QUEUED) return serializeExerciseSession(session)
  const [queuePosition, mlBusy] = await Promise.all([getExerciseQueuePosition(session.id), isMlBusy(session.id)])
  return serializeExerciseSession(session, { queuePosition, mlBusy })
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

const uploadDir = path.join(process.cwd(), EXERCISE_UPLOAD_DIR)

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      fs.mkdirSync(uploadDir, { recursive: true })
      cb(null, uploadDir)
    },
    // <session id><ext>: only the extension of the original name is used.
    filename: (_req, file, cb) => {
      cb(null, `${randomUUID()}${path.extname(file.originalname || '').toLowerCase()}`)
    },
  }),
  limits: { fileSize: env.EXERCISE_MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase()
    if (isExerciseExtension(ext) && file.mimetype.startsWith('video/')) return cb(null, true)
    return cb(new Error('UNSUPPORTED_FILE_TYPE'))
  },
})

const uploadBodySchema = makeExerciseUploadBodySchema(env.EXERCISE_MAX_DURATION_SEC * 1000)

type UploadGateResult =
  | { ok: false; status: number; body: Record<string, unknown> }
  | {
      ok: true
      childId: string
      exerciseId: string
      template: { id: string; durationSec: number }
      consentId: string
    }

/** Everything that can be checked from the query string, before the video is streamed to disk. */
async function checkUploadGate(query: Request['query'], userId: string): Promise<UploadGateResult> {
  const { childId, exerciseId, templateId } = query
  if (typeof childId !== 'string' || !childId) return { ok: false, status: 400, body: { error: 'MISSING_CHILD_ID' } }
  if (!uuidSchema.safeParse(childId).success) return { ok: false, status: 400, body: { error: 'INVALID_CHILD_ID' } }
  if (typeof exerciseId !== 'string' || !exerciseId) {
    return { ok: false, status: 400, body: { error: 'MISSING_EXERCISE_ID' } }
  }

  const child = await findOwnedChild(childId, userId)
  if (!child) return { ok: false, status: 404, body: { error: 'CHILD_NOT_FOUND' } }

  const exercise = uuidSchema.safeParse(exerciseId).success
    ? await prisma.exercise.findFirst({
        where: { id: exerciseId, status: ExerciseStatus.PUBLISHED },
        select: { id: true, currentTemplate: { select: { id: true, durationSec: true } } },
      })
    : null
  if (!exercise?.currentTemplate) return { ok: false, status: 404, body: { error: 'EXERCISE_NOT_FOUND' } }
  // The child practised against a specific demonstration; a newer one means
  // the score would compare against something the child never saw.
  if (templateId !== exercise.currentTemplate.id) {
    return {
      ok: false,
      status: 409,
      body: { error: 'TEMPLATE_OUTDATED', currentTemplateId: exercise.currentTemplate.id },
    }
  }

  const consent = await findActiveExerciseConsent(child.id)
  if (!consent) return { ok: false, status: 403, body: { error: 'EXERCISE_CONSENT_REQUIRED' } }

  const pending = await prisma.exerciseSession.count({
    where: { childId: child.id, status: { in: [...PENDING_SESSION_STATUSES] } },
  })
  if (pending >= env.EXERCISE_MAX_PENDING_PER_CHILD) {
    return { ok: false, status: 429, body: { error: 'TOO_MANY_PENDING', limit: env.EXERCISE_MAX_PENDING_PER_CHILD } }
  }

  return { ok: true, childId: child.id, exerciseId: exercise.id, template: exercise.currentTemplate, consentId: consent.id }
}

const precheckUpload = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const gate = await checkUploadGate(req.query, req.user!.id)
  if (!gate.ok) return res.status(gate.status).json(gate.body)
  return next()
})

function removeUploadedFile(file?: Express.Multer.File) {
  if (file?.path) fs.promises.unlink(file.path).catch(() => {})
}

exerciseSessionsRouter.post(
  '/upload',
  requireExercisesEnabled,
  precheckUpload,
  upload.single('video'),
  asyncHandler(async (req, res) => {
    const file = req.file
    if (!file) return res.status(400).json({ error: 'MISSING_FILE' })

    try {
      const parsed = uploadBodySchema.safeParse(req.body)
      if (!parsed.success) {
        removeUploadedFile(file)
        return res.status(400).json({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() })
      }
      const body = parsed.data

      const ext = path.extname(file.filename).toLowerCase()
      // Only reject when the ML server answered: an unreachable server is
      // assumed to be ML 1.0, and the worker re-checks before extracting.
      const caps = await getMlCapabilities()
      if (caps.reachable && chooseMlUpload({ ext, legacy: caps.legacy, webmAsMkv: env.EXERCISE_WEBM_AS_MKV }) === 'UNSUPPORTED') {
        removeUploadedFile(file)
        return res.status(415).json({ error: 'RECORDING_FORMAT_UNSUPPORTED' })
      }

      // Re-check after the (possibly long) upload: consent, template, pending count.
      const gate = await checkUploadGate(req.query, req.user!.id)
      if (!gate.ok) {
        removeUploadedFile(file)
        return res.status(gate.status).json(gate.body)
      }

      const maxMs = maxRecordingMs(gate.template.durationSec, body.practiceMode, env.EXERCISE_MAX_DURATION_SEC * 1000)
      if (body.durationMs > maxMs) {
        removeUploadedFile(file)
        return res.status(422).json({ error: 'RECORDING_TOO_LONG', maxMs })
      }
      const minMs = minRecordingMs(gate.template.durationSec)
      if (body.durationMs < minMs) {
        removeUploadedFile(file)
        return res.status(422).json({ error: 'RECORDING_TOO_SHORT', minMs })
      }

      const session = await prisma.exerciseSession.create({
        data: {
          // The stored file is <session id><ext>, so a file can always be traced to its row.
          id: path.parse(file.filename).name,
          userId: req.user!.id,
          childId: gate.childId,
          exerciseId: gate.exerciseId,
          templateId: gate.template.id,
          consentId: gate.consentId,
          status: ExerciseSessionStatus.QUEUED,
          recordedVia: body.recordedVia,
          practiceMode: body.practiceMode,
          playbackRate: body.playbackRate,
          guideOffsetMs: body.practiceMode === 'FOLLOW_ALONG' ? (body.guideOffsetMs ?? null) : null,
          storedFilename: file.filename,
          filePath: path.posix.join('uploads', 'exercises', file.filename),
          mimeType: file.mimetype.slice(0, 100),
          fileSize: file.size,
          durationMs: body.durationMs,
          videoWidth: body.videoWidth ?? null,
          videoHeight: body.videoHeight ?? null,
          maxAttempts: env.EXERCISE_MAX_ATTEMPTS,
          runAfter: new Date(),
        },
        include: sessionInclude,
      })

      kickExerciseWorker()
      return res.status(201).json({ session: await serializeWithQueue(session) })
    } catch (error) {
      // Never leave a child's video on disk when the request fails.
      removeUploadedFile(file)
      throw error
    }
  }),
)

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

exerciseSessionsRouter.get(
  '/',
  requireExercisesEnabled,
  asyncHandler(async (req, res) => {
    const query = sessionListQuerySchema.parse(req.query)
    const child = await findOwnedChild(query.childId, req.user!.id)
    if (!child) return res.status(404).json({ error: 'CHILD_NOT_FOUND' })

    const sessions = await prisma.exerciseSession.findMany({
      where: { childId: child.id, ...(query.exerciseId ? { exerciseId: query.exerciseId } : {}) },
      include: sessionInclude,
      orderBy: { createdAt: 'desc' },
      take: query.limit,
    })
    return res.json({ sessions: await Promise.all(sessions.map(serializeWithQueue)) })
  }),
)

async function findOwnedSession(id: unknown, userId: string) {
  const parsed = uuidSchema.safeParse(id)
  if (!parsed.success) return null
  return prisma.exerciseSession.findFirst({ where: { id: parsed.data, userId }, include: sessionInclude })
}

exerciseSessionsRouter.get(
  '/:id',
  requireExercisesEnabled,
  asyncHandler(async (req, res) => {
    res.set('Cache-Control', 'no-store')
    const session = await findOwnedSession(req.params.id, req.user!.id)
    if (!session) return res.status(404).json({ error: 'SESSION_NOT_FOUND' })
    return res.json({ session: await serializeWithQueue(session) })
  }),
)

// ---------------------------------------------------------------------------
// Retry / delete
// ---------------------------------------------------------------------------

exerciseSessionsRouter.post(
  '/:id/retry',
  requireExercisesEnabled,
  asyncHandler(async (req, res) => {
    const session = await findOwnedSession(req.params.id, req.user!.id)
    if (!session) return res.status(404).json({ error: 'SESSION_NOT_FOUND' })

    const fileKept =
      session.videoDeletedAt === null && fs.existsSync(path.resolve(process.cwd(), session.filePath))
    if (session.status !== ExerciseSessionStatus.FAILED || !fileKept) {
      return res.status(409).json({ error: 'RETRY_NOT_AVAILABLE' })
    }
    if (!(await findActiveExerciseConsent(session.childId))) {
      return res.status(403).json({ error: 'EXERCISE_CONSENT_REQUIRED' })
    }

    const requeued = await prisma.exerciseSession.updateMany({
      where: { id: session.id, status: ExerciseSessionStatus.FAILED, videoDeletedAt: null },
      data: {
        status: ExerciseSessionStatus.QUEUED,
        attempts: 0,
        maxAttempts: env.EXERCISE_MAX_ATTEMPTS,
        runAfter: new Date(),
        lockedBy: null,
        lockedAt: null,
        lastError: null,
        errorMessage: null,
        completedAt: null,
      },
    })
    if (!requeued.count) return res.status(409).json({ error: 'RETRY_NOT_AVAILABLE' })

    kickExerciseWorker()
    const updated = await findOwnedSession(session.id, req.user!.id)
    if (!updated) return res.status(404).json({ error: 'SESSION_NOT_FOUND' })
    return res.status(202).json({ session: await serializeWithQueue(updated) })
  }),
)

/** Always allowed (whatever EXERCISE_MODE says): parents can delete their data at any time. */
exerciseSessionsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const parsed = uuidSchema.safeParse(req.params.id)
    if (!parsed.success) return res.status(404).json({ error: 'SESSION_NOT_FOUND' })
    const session = await prisma.exerciseSession.findFirst({
      where: { id: parsed.data, userId: req.user!.id },
      select: { id: true },
    })
    if (!session) return res.status(404).json({ error: 'SESSION_NOT_FOUND' })

    try {
      const summary = await deleteExerciseSessionData(session.id)
      return res.json({ deleted: true, mlSubjectsDeleted: summary.mlSubjectsDeleted })
    } catch (error) {
      if (error instanceof DataDeletionError) {
        return res.status(error.httpStatus).json({ error: error.code, message: error.message })
      }
      throw error
    }
  }),
)
