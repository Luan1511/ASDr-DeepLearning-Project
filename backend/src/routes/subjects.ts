import { Router } from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { randomUUID } from 'crypto'
import { z } from 'zod'
import { UserRole } from '@prisma/client'
import { env } from '../lib/env'
import { asyncHandler } from '../middleware/asyncHandler'
import { requireAuth } from '../middleware/auth'
import { requireRole } from '../middleware/requireRole'
import { SUBJECT_ID_PATTERN, validateSubjectIdParam } from '../middleware/subjectId'
import { openposeService } from '../services/openposeService'

/**
 * Raw proxy to the ML server's /subjects API, mounted at /subjects and
 * /api/subjects. Admin only: it can list and delete every subject.
 */
export const subjectsRouter = Router()

subjectsRouter.use(requireAuth)
subjectsRouter.use(requireRole(UserRole.ADMIN))
subjectsRouter.param('subject_id', validateSubjectIdParam)

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
    cb(null, `op_subject_${randomUUID()}${ext}`)
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
 * GET /subjects
 * List all subjects on OpenPose server
 */
subjectsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const data = await openposeService.listSubjects()
    return res.json(data)
  }),
)

/**
 * POST /subjects/extract
 * Upload a video and extract OpenPose BODY_25 keypoints
 */
subjectsRouter.post(
  '/extract',
  upload.single('video'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'MISSING_FILE', detail: 'video file is required' })
    }

    const subjectId = typeof req.query.subject_id === 'string' ? req.query.subject_id : undefined
    if (subjectId !== undefined && !SUBJECT_ID_PATTERN.test(subjectId)) {
      fs.promises.unlink(req.file.path).catch(() => {})
      return res.status(422).json({ error: 'INVALID_SUBJECT_ID' })
    }

    try {
      const data = await openposeService.extractSubject({
        filePath: req.file.path,
        originalFilename: req.file.originalname,
        mimeType: req.file.mimetype,
        subjectId,
      })
      return res.status(200).json(data)
    } finally {
      if (req.file?.path) {
        fs.promises.unlink(req.file.path).catch(() => {})
      }
    }
  }),
)

/**
 * POST /subjects/:subject_id/predict
 * Run ST-GCN prediction on an already extracted subject
 */
subjectsRouter.post(
  '/:subject_id/predict',
  asyncHandler(async (req, res) => {
    const subjectId = req.params.subject_id
    const threshold = req.query.threshold !== undefined ? Number(req.query.threshold) : undefined
    const temperature = req.query.temperature !== undefined ? Number(req.query.temperature) : undefined

    if (threshold !== undefined && (isNaN(threshold) || threshold < 0 || threshold > 1)) {
      return res.status(422).json({ error: 'INVALID_THRESHOLD', detail: 'threshold must be between 0.0 and 1.0' })
    }
    if (temperature !== undefined && (isNaN(temperature) || temperature <= 0)) {
      return res.status(422).json({ error: 'INVALID_TEMPERATURE', detail: 'temperature must be > 0.0' })
    }

    const data = await openposeService.predictSubject(subjectId, {
      threshold,
      temperature,
    })
    return res.json(data)
  }),
)

/**
 * GET /subjects/:subject_id
 * Get subject metadata and prediction
 */
subjectsRouter.get(
  '/:subject_id',
  asyncHandler(async (req, res) => {
    const subjectId = req.params.subject_id
    const data = await openposeService.getSubject(subjectId)
    return res.json(data)
  }),
)

/**
 * GET /subjects/:subject_id/keypoints
 * Get extracted BODY_25 keypoint frames
 */
subjectsRouter.get(
  '/:subject_id/keypoints',
  asyncHandler(async (req, res) => {
    const subjectId = req.params.subject_id
    const data = await openposeService.getSubjectKeypoints(subjectId)
    return res.json(data)
  }),
)

/**
 * GET /subjects/:subject_id/prediction
 * Get ST-GCN prediction for subject
 */
subjectsRouter.get(
  '/:subject_id/prediction',
  asyncHandler(async (req, res) => {
    const subjectId = req.params.subject_id
    const data = await openposeService.getSubjectPrediction(subjectId)
    return res.json(data)
  }),
)

/**
 * DELETE /subjects/:subject_id
 * Delete subject from server
 */
subjectsRouter.delete(
  '/:subject_id',
  asyncHandler(async (req, res) => {
    const subjectId = req.params.subject_id
    const data = await openposeService.deleteSubject(subjectId)
    return res.json(data)
  }),
)
