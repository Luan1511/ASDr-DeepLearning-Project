import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import multer from 'multer'
import sharp from 'sharp'
import { Router } from 'express'
import { prisma } from '../lib/prisma'
import { asyncHandler } from '../middleware/asyncHandler'
import { requireAuth } from '../middleware/auth'
import { requireCommunityActive } from '../middleware/community'
import { UserRole } from '@prisma/client'
import { communityBlockedUserIds } from '../services/community'

const mediaRoot = path.resolve(process.cwd(), 'uploads', 'community')
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } })
export const communityMediaRouter = Router()
communityMediaRouter.use(requireAuth, requireCommunityActive)

communityMediaRouter.post('/', upload.single('image'), asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'IMAGE_REQUIRED' })
  let image: ReturnType<typeof sharp>
  try {
    image = sharp(req.file.buffer, { limitInputPixels: 30_000_000, failOn: 'error' })
    const metadata = await image.metadata()
    if (!['jpeg', 'png', 'webp'].includes(metadata.format ?? '')) return res.status(415).json({ error: 'UNSUPPORTED_IMAGE_TYPE' })
    if (!metadata.width || !metadata.height) return res.status(400).json({ error: 'INVALID_IMAGE' })
    const storageName = `${randomUUID()}.webp`
    const filePath = path.join(mediaRoot, storageName)
    await fs.mkdir(mediaRoot, { recursive: true })
    await image.rotate().resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true }).webp({ quality: 84, effort: 4 }).toFile(filePath)
    const output = await fs.stat(filePath)
    let media
    try {
      media = await prisma.communityMedia.create({ data: { uploaderId: req.user!.id, storageName, mimeType: 'image/webp', byteSize: output.size, width: Math.min(metadata.width, 2400), height: Math.min(metadata.height, 2400) } })
    } catch (error) {
      await fs.unlink(filePath).catch(() => undefined)
      throw error
    }
    return res.status(201).json({ media: { id: media.id, url: `/community/media/${media.id}`, mimeType: media.mimeType, width: media.width, height: media.height } })
  } catch (error) {
    if (error instanceof Error && error.message.includes('Input buffer')) return res.status(400).json({ error: 'INVALID_IMAGE' })
    throw error
  }
}))

communityMediaRouter.get('/:id', asyncHandler(async (req, res) => {
  const media = await prisma.communityMedia.findUnique({ where: { id: req.params.id }, include: { post: { select: { hiddenAt: true, userId: true } } } })
  if (!media) return res.status(404).json({ error: 'MEDIA_NOT_FOUND' })
  const isOwner = media.uploaderId === req.user!.id
  const isAdmin = req.user!.role === UserRole.ADMIN
  if (!isOwner && !isAdmin && !media.post) return res.status(404).json({ error: 'MEDIA_NOT_FOUND' })
  if (!isOwner && !isAdmin && media.post?.hiddenAt) return res.status(404).json({ error: 'MEDIA_NOT_FOUND' })
  if (!isOwner && !isAdmin && media.post && (await communityBlockedUserIds(prisma, req.user!.id)).includes(media.post.userId)) return res.status(404).json({ error: 'MEDIA_NOT_FOUND' })
  res.setHeader('Cache-Control', 'private, no-store')
  res.type(media.mimeType)
  return res.sendFile(path.join(mediaRoot, path.basename(media.storageName)), (error) => {
    if (error && !res.headersSent) res.status(404).json({ error: 'MEDIA_NOT_FOUND' })
  })
}))
