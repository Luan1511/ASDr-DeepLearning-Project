import { Router } from 'express'
import multer from 'multer'
import path from 'path'
import { randomUUID } from 'crypto'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { env } from '../lib/env'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../middleware/asyncHandler'
import { enqueueMockProcessing } from '../services/screeningProcessor'
import { RiskLevel, ScreeningStatus } from '@prisma/client'

export const screeningsRouter = Router()

screeningsRouter.use(requireAuth)

const uploadStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, path.join(process.cwd(), 'uploads'))
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '')
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
    const okExt = ['.mp4', '.mov', '.avi'].includes(ext)
    const okMime =
      file.mimetype.startsWith('video/') ||
      ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/avi'].includes(file.mimetype)

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
      },
      orderBy: { createdAt: 'desc' },
    })

    return res.json({ screenings })
  }),
)

const uploadSchema = z.object({
  childId: z.string().uuid().optional(),
  child_id: z.string().uuid().optional(),
})

screeningsRouter.post(
  '/upload',
  upload.single('video'),
  asyncHandler(async (req, res) => {
    const userId = req.user!.id
    const body = uploadSchema.parse(req.body)

    if (!req.file) return res.status(400).json({ error: 'MISSING_FILE' })

    const childId = body.childId ?? body.child_id
    if (!childId) return res.status(400).json({ error: 'MISSING_CHILD_ID' })

    const child = await prisma.childProfile.findFirst({ where: { id: childId, userId } })
    if (!child) return res.status(404).json({ error: 'CHILD_NOT_FOUND' })

    const video = await prisma.videoUpload.create({
      data: {
        userId,
        childId,
        originalFilename: req.file.originalname,
        storedFilename: req.file.filename,
        filePath: path.posix.join('uploads', req.file.filename),
        mimeType: req.file.mimetype,
        fileSize: req.file.size,
        status: ScreeningStatus.UPLOADED,
      },
      include: { child: true, result: true },
    })

    return res.status(201).json({ video })
  }),
)

screeningsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const userId = req.user!.id
    const id = z.string().uuid().parse(req.params.id)

    const screening = await prisma.videoUpload.findFirst({
      where: { id, userId },
      include: { child: true, result: true },
    })

    if (!screening) return res.status(404).json({ error: 'NOT_FOUND' })
    return res.json({ screening })
  }),
)

screeningsRouter.post(
  '/:id/process',
  asyncHandler(async (req, res) => {
    const userId = req.user!.id
    const id = z.string().uuid().parse(req.params.id)

    const screening = await prisma.videoUpload.findFirst({ where: { id, userId } })
    if (!screening) return res.status(404).json({ error: 'NOT_FOUND' })

    if (screening.status === ScreeningStatus.COMPLETED) {
      const result = await prisma.screeningResult.findUnique({ where: { videoId: id } })
      return res.json({ status: screening.status, result })
    }

    await enqueueMockProcessing(id)
    return res.status(202).json({ status: ScreeningStatus.PROCESSING })
  }),
)
