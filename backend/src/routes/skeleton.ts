import { Router } from 'express'
import fs from 'fs'
import path from 'path'
import multer from 'multer'
import archiver = require('archiver')
import { randomUUID } from 'crypto'
import { UserRole } from '@prisma/client'
import { env } from '../lib/env'
import { asyncHandler } from '../middleware/asyncHandler'
import { requireAuth } from '../middleware/auth'
import { requireRole } from '../middleware/requireRole'
import { validateSubjectIdParam } from '../middleware/subjectId'
import { openposeService } from '../services/openposeService'

export const skeletonRouter = Router()

skeletonRouter.use(requireAuth)
skeletonRouter.use(requireRole(UserRole.ADMIN))
skeletonRouter.param('subject_id', validateSubjectIdParam)

const uploadStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const uploadDir = path.join(process.cwd(), 'uploads', 'skeleton')
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true })
    }
    cb(null, uploadDir)
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '')
    cb(null, `skeleton_${randomUUID()}${ext}`)
  },
})

const upload = multer({
  storage: uploadStorage,
  limits: { fileSize: env.SKELETON_MAX_UPLOAD_MB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = (path.extname(file.originalname) || '').toLowerCase()
    const okExt = ['.mp4', '.mov', '.avi', '.mkv', '.webm'].includes(ext)
    const okMime =
      file.mimetype.startsWith('video/') ||
      ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska', 'video/webm'].includes(file.mimetype)

    if (okExt && okMime) return cb(null, true)
    return cb(new Error('UNSUPPORTED_FILE_TYPE'))
  },
})

function flattenKeypoints(frames: Array<{ frame_index: number; people: Array<{ person_id: number; body25: Array<{ id: number; x: number; y: number; confidence: number }> }> }>) {
  const rows: string[] = ['frame_index,person_id,joint_id,x,y,confidence']

  for (const frame of frames) {
    for (const person of frame.people ?? []) {
      for (const joint of person.body25 ?? []) {
        rows.push(
          [
            frame.frame_index,
            person.person_id,
            joint.id,
            joint.x,
            joint.y,
            joint.confidence,
          ].join(','),
        )
      }
    }
  }

  return rows.join('\n')
}

skeletonRouter.get(
  '/subjects/list',
  asyncHandler(async (_req, res) => {
    const data = await openposeService.listSubjects()
    return res.json(data)
  }),
)

skeletonRouter.post(
  '/extract',
  upload.single('video'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'MISSING_FILE', detail: 'video file is required' })
    }

    try {
      const data = await openposeService.extractSubject({
        filePath: req.file.path,
        originalFilename: req.file.originalname,
        mimeType: req.file.mimetype,
      })
      return res.status(200).json(data)
    } finally {
      if (req.file.path) {
        fs.promises.unlink(req.file.path).catch(() => {})
      }
    }
  }),
)

skeletonRouter.get(
  '/:subject_id',
  asyncHandler(async (req, res) => {
    const subjectId = req.params.subject_id
    const data = await openposeService.getSubject(subjectId)
    return res.json(data)
  }),
)

skeletonRouter.get(
  '/:subject_id/keypoints',
  asyncHandler(async (req, res) => {
    const subjectId = req.params.subject_id
    const data = await openposeService.getSubjectKeypoints(subjectId)
    return res.json(data)
  }),
)

skeletonRouter.get(
  '/:subject_id/download',
  asyncHandler(async (req, res, next) => {
    const subjectId = req.params.subject_id
    const detail = await openposeService.getSubject(subjectId)
    const keypoints = await openposeService.getSubjectKeypoints(subjectId)
    const zipName = `${subjectId.replace(/[^a-zA-Z0-9._-]/g, '_')}.zip`

    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`)

    const archive = new archiver.ZipArchive({ zlib: { level: 9 } })
    archive.on('error', (err: Error) => {
      // Once streaming started the JSON error handler can no longer respond.
      if (res.headersSent) res.destroy(err)
      else next(err)
    })
    archive.pipe(res)

    archive.append(JSON.stringify(keypoints, null, 2), { name: 'keypoints_body25.json' })
    archive.append(
      JSON.stringify(
        {
          subject_id: subjectId,
          filename: detail.metadata?.filename ?? subjectId,
          created_at: detail.metadata?.created_at ?? new Date().toISOString(),
          num_frames: keypoints.num_frames,
          keypoint_format: keypoints.keypoint_format,
          status: detail.metadata?.status ?? 'completed',
          // fps / width / height probed by the ML server (null on older servers).
          video: detail.metadata?.video ?? keypoints.video ?? null,
        },
        null,
        2,
      ),
      { name: 'metadata.json' },
    )
    archive.append(
      [
        'ASDr skeleton extraction archive',
        '',
        `Subject ID: ${subjectId}`,
        `Filename: ${detail.metadata?.filename ?? subjectId}`,
        `Generated at: ${new Date().toISOString()}`,
        `Frames: ${keypoints.num_frames}`,
        '',
        'This archive includes the full keypoint payload plus one JSON file per frame for downstream visualization and re-processing.',
      ].join('\n'),
      { name: 'README.txt' },
    )

    for (const [index, frame] of (keypoints.frames ?? []).entries()) {
      archive.append(JSON.stringify(frame, null, 2), {
        name: `frames/frame_${String(index).padStart(4, '0')}.json`,
      })
    }

    archive.append(flattenKeypoints(keypoints.frames), { name: 'keypoints_flat.csv' })

    archive.finalize()
  }),
)

skeletonRouter.delete(
  '/:subject_id',
  asyncHandler(async (req, res) => {
    const subjectId = req.params.subject_id
    const data = await openposeService.deleteSubject(subjectId)
    return res.json(data)
  }),
)
