import { Router, type NextFunction, type Request, type Response } from 'express'
import fs from 'fs'
import multer from 'multer'
import path from 'path'
import { randomUUID } from 'crypto'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { env } from '../lib/env'
import { serializeResult, serializeScreening } from '../lib/serializers'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../middleware/asyncHandler'
import { enqueueScreeningProcessing, getQueuePosition } from '../services/screeningProcessor'
import { findActiveConsent } from '../services/consentService'
import { openposeService } from '../services/openposeService'
import { RiskLevel, ScreeningStatus } from '@prisma/client'

export const screeningsRouter = Router()

// Report request status without writing video content or names to the log.
screeningsRouter.use((req, res, next) => {
  res.on('finish', () => {
    // eslint-disable-next-line no-console
    console.log(`[screenings] ${req.method} ${req.originalUrl} -> ${res.statusCode}`)
  })
  next()
})

screeningsRouter.use(requireAuth)

// Must match what the ML server accepts (API/server_openpose.py).
const ALLOWED_EXTENSIONS = ['.mp4', '.mov', '.avi', '.mkv']

const uploadStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const uploadDir = path.join(process.cwd(), 'uploads')
    fs.mkdirSync(uploadDir, { recursive: true })
    cb(null, uploadDir)
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase()
    cb(null, `${randomUUID()}${ext}`)
  },
})

const upload = multer({
  storage: uploadStorage,
  limits: {
    fileSize: env.MAX_UPLOAD_MB * 1024 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    const ext = (path.extname(file.originalname) || '').toLowerCase()
    const okExt = ALLOWED_EXTENSIONS.includes(ext)
    const okMime =
      file.mimetype.startsWith('video/') ||
      ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/avi', 'video/x-matroska'].includes(file.mimetype)

    if (okExt && okMime) return cb(null, true)
    return cb(new Error('UNSUPPORTED_FILE_TYPE'))
  },
})

const listQuerySchema = z.object({
  risk_level: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
})

function parseRiskLevel(input?: string): RiskLevel | undefined {
  if (!input) return undefined
  const v = input.trim().toLowerCase()
  if (v === 'low') return RiskLevel.LOW
  if (v === 'medium') return RiskLevel.MEDIUM
  if (v === 'high') return RiskLevel.HIGH
  return undefined
}

screeningsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const userId = req.user!.id
    const query = listQuerySchema.parse(req.query)

    const from = query.from ? new Date(query.from) : undefined
    const to = query.to ? new Date(query.to) : undefined

    const where: any = { userId }

    if (from || to) {
      where.createdAt = {}
      if (from && !Number.isNaN(from.getTime())) where.createdAt.gte = from
      if (to && !Number.isNaN(to.getTime())) where.createdAt.lte = to
    }

    const riskEnum = parseRiskLevel(query.risk_level)
    if (riskEnum) {
      where.result = { is: { riskLevel: riskEnum } }
    }

    const screenings = await prisma.videoUpload.findMany({
      where,
      include: {
        child: true,
        result: true,
        job: true,
      },
      orderBy: { createdAt: 'desc' },
    })

    return res.json({ screenings: screenings.map((s) => serializeScreening(s)) })
  }),
)

const childIdSchema = z.string().uuid()

const uploadBodySchema = z.object({
  childId: childIdSchema.optional(),
  child_id: childIdSchema.optional(),
  // Measured in the browser from the <video> element before upload.
  durationMs: z.coerce.number().int().positive().max(24 * 60 * 60 * 1000).optional(),
  videoWidth: z.coerce.number().int().positive().max(16384).optional(),
  videoHeight: z.coerce.number().int().positive().max(16384).optional(),
})

type UploadGate = { status: number; body: Record<string, unknown> } | null

async function checkChildAndConsent(childId: string | undefined, userId: string): Promise<UploadGate> {
  if (!childId) return { status: 400, body: { error: 'MISSING_CHILD_ID' } }
  const child = await prisma.childProfile.findFirst({ where: { id: childId, userId } })
  if (!child) return { status: 404, body: { error: 'CHILD_NOT_FOUND' } }
  const consent = await findActiveConsent(childId)
  if (!consent) return { status: 403, body: { error: 'CONSENT_REQUIRED' } }
  return null
}

/**
 * When the client passes ?childId=…, reject before Multer streams a large
 * video to disk. Body-only clients are still checked after the upload.
 */
const precheckUpload = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const raw = req.query.childId ?? req.query.child_id
  if (typeof raw === 'string' && raw) {
    const parsed = childIdSchema.safeParse(raw)
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_CHILD_ID' })
    const gate = await checkChildAndConsent(parsed.data, req.user!.id)
    if (gate) return res.status(gate.status).json(gate.body)
  }
  return next()
})

function removeUploadedFile(file?: Express.Multer.File) {
  if (file?.path) fs.promises.unlink(file.path).catch(() => {})
}

screeningsRouter.post(
  '/upload',
  precheckUpload,
  upload.single('video'),
  asyncHandler(async (req, res) => {
    const userId = req.user!.id
    const parsed = uploadBodySchema.safeParse(req.body)
    if (!parsed.success) {
      removeUploadedFile(req.file)
      return res.status(400).json({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() })
    }
    const body = parsed.data

    if (!req.file) return res.status(400).json({ error: 'MISSING_FILE' })

    const childId = body.childId ?? body.child_id
    const file = req.file
    try {
      const gate = await checkChildAndConsent(childId, userId)
      if (gate) {
        removeUploadedFile(file)
        return res.status(gate.status).json(gate.body)
      }
      const consent = await findActiveConsent(childId!)

      const video = await prisma.videoUpload.create({
        data: {
          userId,
          childId: childId!,
          consentId: consent?.id,
          originalFilename: file.originalname,
          storedFilename: file.filename,
          filePath: path.posix.join('uploads', file.filename),
          mimeType: file.mimetype,
          fileSize: file.size,
          durationMs: body.durationMs,
          durationSeconds: body.durationMs ? Math.round(body.durationMs / 1000) : undefined,
          videoWidth: body.videoWidth,
          videoHeight: body.videoHeight,
          status: ScreeningStatus.UPLOADED,
        },
        include: { child: true, result: true, job: true },
      })

      return res.status(201).json({ video: serializeScreening(video) })
    } catch (error) {
      // Never leave an orphaned child video on disk when the request fails.
      removeUploadedFile(file)
      throw error
    }
  }),
)

screeningsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    res.set('Cache-Control', 'no-store')
    const userId = req.user!.id
    const id = z.string().uuid().parse(req.params.id)

    const screening = await prisma.videoUpload.findFirst({
      where: { id, userId },
      include: { child: true, result: true, job: true },
    })

    if (!screening) return res.status(404).json({ error: 'NOT_FOUND' })
    const queuePosition = screening.status === ScreeningStatus.PROCESSING ? await getQueuePosition(id) : null
    return res.json({ screening: serializeScreening(screening, { queuePosition }) })
  }),
)

screeningsRouter.post(
  '/:id/process',
  asyncHandler(async (req, res) => {
    const userId = req.user!.id
    const id = z.string().uuid().parse(req.params.id)

    const screening = await prisma.videoUpload.findFirst({ where: { id, userId }, include: { result: true } })
    if (!screening) return res.status(404).json({ error: 'NOT_FOUND' })

    if (screening.status === ScreeningStatus.COMPLETED && screening.result) {
      return res.json({ status: screening.status, result: serializeResult(screening.result) })
    }

    // Consent can be revoked between upload and processing.
    if (!(await findActiveConsent(screening.childId))) {
      return res.status(403).json({ error: 'CONSENT_REQUIRED' })
    }

    const job = await enqueueScreeningProcessing(id)
    return res.status(202).json({ status: ScreeningStatus.PROCESSING, job })
  }),
)

screeningsRouter.get(
  '/:id/keypoints',
  asyncHandler(async (req, res) => {
    const userId = req.user!.id
    const id = z.string().uuid().parse(req.params.id)

    const screening = await prisma.videoUpload.findFirst({
      where: { id, userId },
      include: { result: true },
    })

    if (!screening) return res.status(404).json({ error: 'NOT_FOUND' })

    const subjectId = (screening.result?.rawAiResponse as any)?.subjectId || id

    try {
      const keypoints = await openposeService.getSubjectKeypoints(subjectId)
      return res.json(keypoints)
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.error(`[screenings] keypoints for ${subjectId} unavailable:`, err?.message ?? err)
      return res.status(404).json({ error: 'KEYPOINTS_NOT_FOUND' })
    }
  }),
)

screeningsRouter.get(
  '/:id/prediction',
  asyncHandler(async (req, res) => {
    const userId = req.user!.id
    const id = z.string().uuid().parse(req.params.id)

    const screening = await prisma.videoUpload.findFirst({
      where: { id, userId },
      include: { result: true },
    })

    if (!screening) return res.status(404).json({ error: 'NOT_FOUND' })

    if (screening.result?.rawAiResponse) {
      const raw = screening.result.rawAiResponse as any
      if (raw.response?.prediction || raw.prediction) {
        return res.json({
          subject_id: raw.subjectId || id,
          prediction: raw.response?.prediction || raw.prediction,
          screening_result: serializeResult(screening.result),
        })
      }
    }

    const subjectId = (screening.result?.rawAiResponse as any)?.subjectId || id
    try {
      const prediction = await openposeService.getSubjectPrediction(subjectId)
      return res.json(prediction)
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.error(`[screenings] prediction for ${subjectId} unavailable:`, err?.message ?? err)
      return res.status(404).json({ error: 'PREDICTION_NOT_FOUND' })
    }
  }),
)
