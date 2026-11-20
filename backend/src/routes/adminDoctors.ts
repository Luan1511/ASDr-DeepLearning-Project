import { createHash, randomBytes } from 'node:crypto'
import { Router } from 'express'
import { z } from 'zod'
import { UserRole } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { asyncHandler } from '../middleware/asyncHandler'
import { requireAuth } from '../middleware/auth'
import { requireRole } from '../middleware/requireRole'

export const adminDoctorsRouter = Router()
adminDoctorsRouter.use(requireAuth, requireRole(UserRole.ADMIN))

const inviteSchema = z.object({
  email: z.string().trim().email().max(254).transform((x) => x.toLowerCase()),
  displayName: z.string().trim().min(2).max(100),
  title: z.string().trim().min(2).max(80),
  specialty: z.string().trim().min(2).max(100),
  workplace: z.string().trim().min(2).max(160),
  city: z.string().trim().min(2).max(100),
  bio: z.string().trim().max(1000).default(''),
  languages: z.array(z.string().trim().min(2).max(40)).max(8).default(['Tiếng Việt']),
})

adminDoctorsRouter.get('/', asyncHandler(async (_req, res) => {
  const doctors = await prisma.doctorProfile.findMany({ where: { isMock: false }, include: { user: { select: { email: true } }, verifiedBy: { select: { name: true } } }, orderBy: [{ verificationStatus: 'asc' }, { displayName: 'asc' }] })
  const invitations = await prisma.doctorInvitation.findMany({ where: { usedAt: null, revokedAt: null, expiresAt: { gt: new Date() } }, select: { id: true, email: true, displayName: true, specialty: true, expiresAt: true, createdAt: true }, orderBy: { createdAt: 'desc' } })
  return res.json({ doctors: doctors.map(({ user, verifiedBy, ...doctor }) => ({ ...doctor, email: user.email, verifiedBy: verifiedBy?.name ?? null })), invitations })
}))

adminDoctorsRouter.post('/invitations', asyncHandler(async (req, res) => {
  const input = inviteSchema.parse(req.body)
  const account = await prisma.user.findFirst({ where: { email: { equals: input.email, mode: 'insensitive' } }, select: { id: true } })
  if (account) return res.status(409).json({ error: 'EMAIL_EXISTS' })
  const rawToken = randomBytes(32).toString('base64url')
  const tokenHash = createHash('sha256').update(rawToken).digest('hex')
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  const invitation = await prisma.$transaction(async (tx) => {
    await tx.doctorInvitation.updateMany({ where: { email: input.email, usedAt: null, revokedAt: null }, data: { revokedAt: new Date() } })
    return tx.doctorInvitation.create({ data: { ...input, tokenHash, createdById: req.user!.id, expiresAt }, select: { id: true, email: true, expiresAt: true } })
  })
  return res.status(201).json({ invitation: { ...invitation, token: rawToken, acceptPath: `/doctor-invitation/${rawToken}` } })
}))

adminDoctorsRouter.delete('/invitations/:id', asyncHandler(async (req, res) => {
  const changed = await prisma.doctorInvitation.updateMany({ where: { id: req.params.id, usedAt: null, revokedAt: null }, data: { revokedAt: new Date() } })
  return changed.count ? res.json({ revoked: true }) : res.status(404).json({ error: 'INVITATION_NOT_FOUND' })
}))

adminDoctorsRouter.get('/:id/history', asyncHandler(async (req, res) => {
  const doctor = await prisma.doctorProfile.findFirst({ where: { id: req.params.id, isMock: false }, select: { id: true } })
  if (!doctor) return res.status(404).json({ error: 'DOCTOR_NOT_FOUND' })
  const events = await prisma.doctorManagementEvent.findMany({ where: { doctorId: doctor.id }, orderBy: { occurredAt: 'desc' }, take: 100 })
  return res.json({ events })
}))

adminDoctorsRouter.patch('/:id/verification', asyncHandler(async (req, res) => {
  const input = z.object({ status: z.enum(['PENDING', 'VERIFIED', 'REJECTED']) }).parse(req.body)
  const doctor = await prisma.doctorProfile.findFirst({ where: { id: req.params.id, isMock: false } })
  if (!doctor) return res.status(404).json({ error: 'DOCTOR_NOT_FOUND' })
  const updated = await prisma.$transaction(async (tx) => {
    const updated = await tx.doctorProfile.update({ where: { id: doctor.id }, data: { verificationStatus: input.status, verifiedAt: input.status === 'VERIFIED' ? new Date() : null, verifiedById: input.status === 'VERIFIED' ? req.user!.id : null } })
    await tx.doctorManagementEvent.create({ data: { doctorId: doctor.id, adminId: req.user!.id, adminName: req.user!.name, action: 'VERIFICATION', previous: doctor.verificationStatus, next: input.status } })
    return updated
  })
  return res.json({ doctor: { id: updated.id, verificationStatus: updated.verificationStatus, verifiedAt: updated.verifiedAt } })
}))

adminDoctorsRouter.patch('/:id/active', asyncHandler(async (req, res) => {
  const input = z.object({ active: z.boolean() }).parse(req.body)
  const doctor = await prisma.doctorProfile.findFirst({ where: { id: req.params.id, isMock: false } })
  if (!doctor) return res.status(404).json({ error: 'DOCTOR_NOT_FOUND' })
  if (input.active && doctor.verificationStatus !== 'VERIFIED') return res.status(409).json({ error: 'DOCTOR_NOT_VERIFIED' })
  await prisma.$transaction(async (tx) => {
    await tx.doctorProfile.update({ where: { id: doctor.id }, data: { isActive: input.active } })
    await tx.doctorManagementEvent.create({ data: { doctorId: doctor.id, adminId: req.user!.id, adminName: req.user!.name, action: 'ACTIVE', previous: String(doctor.isActive), next: String(input.active) } })
  })
  return res.json({ active: input.active })
}))
