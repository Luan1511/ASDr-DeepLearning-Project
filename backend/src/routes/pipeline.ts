import { Router } from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { randomUUID } from 'crypto'
import { UserRole } from '@prisma/client'
import { env } from '../lib/env'
import { asyncHandler } from '../middleware/asyncHandler'
import { requireAuth } from '../middleware/auth'
import { requireRole } from '../middleware/requireRole'
import { SUBJECT_ID_PATTERN } from '../middleware/subjectId'
import { openposeService } from '../services/openposeService'

/**
 * Raw proxy to the ML server's /pipeline/asd, mounted at /pipeline and
 * /api/pipeline. Admin only; parents go through /api/screenings, which
 * enforces ownership, consent and the job queue.
 */
export const pipelineRouter = Router()

pipelineRouter.use(requireAuth)
pipelineRouter.use(requireRole(UserRole.ADMIN))

const uploadStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const uploadDir = path.join(process.cwd(), 'uploads')
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true })
    }
    cb(null, uploadDir)
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '')
    cb(null, `op_pipeline_${randomUUID()}${ext}`)
  },
})

const upload = multer({
  storage: uploadStorage,
  limits: {
    fileSize: env.MAX_UPLOAD_MB * 1024 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    const ext = (path.extname(file.originalname) || '').toLowerCase()
    const okExt = ['.mp4', '.mov', '.avi', '.mkv'].includes(ext)
    const okMime =
      file.mimetype.startsWith('video/') ||
      ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/avi'].includes(file.mimetype)

    if (okExt && okMime) return cb(null, true)
    return cb(new Error('UNSUPPORTED_FILE_TYPE'))
  },
})

/**
 * POST /pipeline/asd
 * End-to-end pipeline: Video -> OpenPose BODY_25 -> ST-GCN ASD Prediction
 */
pipelineRouter.post(
  '/asd',
  upload.single('video'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'MISSING_FILE', detail: 'video file is required' })
    }

    const subjectId = typeof req.query.subject_id === 'string' ? req.query.subject_id : undefined
    const threshold = req.query.threshold !== undefined ? Number(req.query.threshold) : undefined
    const temperature = req.query.temperature !== undefined ? Number(req.query.temperature) : undefined
    const returnKeypoints =
      req.query.return_keypoints === 'true' || req.query.return_keypoints === '1'

    const reject = (status: number, body: Record<string, string>) => {
      fs.promises.unlink(req.file!.path).catch(() => {})
      return res.status(status).json(body)
    }
    if (subjectId !== undefined && !SUBJECT_ID_PATTERN.test(subjectId)) {
      return reject(422, { error: 'INVALID_SUBJECT_ID' })
    }
    if (threshold !== undefined && (isNaN(threshold) || threshold < 0 || threshold > 1)) {
      return reject(422, { error: 'INVALID_THRESHOLD', detail: 'threshold must be between 0.0 and 1.0' })
    }
    if (temperature !== undefined && (isNaN(temperature) || temperature <= 0)) {
      return reject(422, { error: 'INVALID_TEMPERATURE', detail: 'temperature must be > 0.0' })
    }

    try {
      const data = await openposeService.runPipelineAsd({
        filePath: req.file.path,
        originalFilename: req.file.originalname,
        mimeType: req.file.mimetype,
        subjectId,
        threshold,
        temperature,
        returnKeypoints,
      })
      return res.status(200).json(data)
    } finally {
      if (req.file?.path) {
        fs.promises.unlink(req.file.path).catch(() => {})
      }
    }
  }),
)
