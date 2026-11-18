import { Router } from 'express'
import type { Prisma } from '@prisma/client'
import { z } from 'zod'
import {
  DOCTOR_SHARE_VERSION,
  REQUIRED_SHARE_SCOPES,
  buildDoctorShareStatement,
  createDoctorLinkSchema,
  doctorMatchesQuery,
  listedDoctorFilter,
  normalizeScopes,
  serializeDoctor,
  serializeDoctorLink,
} from '../lib/doctorShare'
import { env } from '../lib/env'
import { prisma } from '../lib/prisma'
import { isSchemaOutdatedError } from '../lib/prismaErrors'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../middleware/asyncHandler'
import { requireDoctorsEnabled } from '../middleware/requireDoctor'
import { findOwnedChild } from './exercises'

/** Parent side: the doctor directory and the text of the sharing agreement. */
export const doctorsRouter = Router()

doctorsRouter.use(requireAuth)

/** Works in every mode so the UI can decide what to show. */
doctorsRouter.get('/capabilities', (_req, res) => {
  return res.json({ mode: env.DOCTOR_MODE, available: env.DOCTOR_MODE !== 'off', demo: env.DOCTOR_MODE === 'demo' })
})

doctorsRouter.get('/share-statement', requireDoctorsEnabled, (_req, res) => {
  return res.json({ statement: buildDoctorShareStatement(env.DOCTOR_MODE) })
})

const listQuerySchema = z.object({
  q: z.string().trim().max(80).optional(),
  city: z.string().trim().max(80).optional(),
  specialty: z.string().trim().max(80).optional(),
})

/** Doctors a parent can connect with, plus which of the parent's children each one already sees. */
doctorsRouter.get(
  '/',
  requireDoctorsEnabled,
  asyncHandler(async (req, res) => {
    const query = listQuerySchema.parse(req.query)
    const [all, links] = await Promise.all([
      prisma.doctorProfile.findMany({
        where: listedDoctorFilter(env.DOCTOR_MODE),
        orderBy: [{ acceptingNew: 'desc' }, { displayName: 'asc' }],
      }),
      prisma.doctorChildLink.findMany({
        where: { grantedById: req.user!.id, revokedAt: null },
        select: { id: true, doctorId: true, childId: true },
      }),
    ])
    // The directory is small, and searching here (not in SQL) ignores Vietnamese
    // marks and letter case whatever the database collation is.
    const doctors = all.filter(
      (doctor) =>
        (!query.city || doctor.city === query.city) &&
        (!query.specialty || doctor.specialty === query.specialty) &&
        (!query.q || doctorMatchesQuery(doctor, query.q)),
    )

    const sorted = (values: string[]) => Array.from(new Set(values)).sort((a, b) => a.localeCompare(b, 'vi'))
    return res.json({
      demo: env.DOCTOR_MODE === 'demo',
      doctors: doctors.map((doctor) => ({
        ...serializeDoctor(doctor),
        links: links.filter((l) => l.doctorId === doctor.id).map((l) => ({ id: l.id, childId: l.childId })),
      })),
      cities: sorted(all.map((d) => d.city)),
      specialties: sorted(all.map((d) => d.specialty)),
    })
  }),
)

doctorsRouter.get(
  '/:id',
  requireDoctorsEnabled,
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().safeParse(req.params.id)
    const doctor = id.success
      ? await prisma.doctorProfile.findFirst({ where: { id: id.data, ...listedDoctorFilter(env.DOCTOR_MODE) } })
      : null
    if (!doctor) return res.status(404).json({ error: 'DOCTOR_NOT_FOUND' })
    return res.json({ doctor: serializeDoctor(doctor) })
  }),
)

// ---------------------------------------------------------------------------
// /children/:childId/doctor-links — the grants of one child
// ---------------------------------------------------------------------------

export const childDoctorLinksRouter = Router({ mergeParams: true })

childDoctorLinksRouter.use(requireAuth)

/**
 * Every grant of the child, newest first. Always available (also when the
 * feature is off) so a parent can see and end what was shared; a database
 * without the doctor tables simply has no grants.
 */
childDoctorLinksRouter.get(
  '/doctor-links',
  asyncHandler(async (req, res) => {
    const child = await findOwnedChild(req.params.childId, req.user!.id)
    if (!child) return res.status(404).json({ error: 'CHILD_NOT_FOUND' })
    try {
      const links = await prisma.doctorChildLink.findMany({
        where: { childId: child.id },
        include: { doctor: true },
        orderBy: { grantedAt: 'desc' },
      })
      return res.json({ available: env.DOCTOR_MODE !== 'off', links: links.map(serializeDoctorLink) })
    } catch (error) {
      if (isSchemaOutdatedError(error)) return res.json({ available: false, links: [] })
      throw error
    }
  }),
)

childDoctorLinksRouter.post(
  '/doctor-links',
  requireDoctorsEnabled,
  asyncHandler(async (req, res) => {
    const userId = req.user!.id
    const input = createDoctorLinkSchema.parse(req.body)
    const child = await findOwnedChild(req.params.childId, userId)
    if (!child) return res.status(404).json({ error: 'CHILD_NOT_FOUND' })

    if (input.version !== DOCTOR_SHARE_VERSION) {
      return res.status(409).json({ error: 'SHARE_VERSION_OUTDATED', currentVersion: DOCTOR_SHARE_VERSION })
    }
    const scopes = normalizeScopes(input.scopes)
    if (!REQUIRED_SHARE_SCOPES.every((s) => scopes.includes(s))) {
      return res.status(400).json({ error: 'SHARE_SCOPE_REQUIRED', required: REQUIRED_SHARE_SCOPES })
    }

    const doctor = await prisma.doctorProfile.findFirst({
      where: { id: input.doctorId, ...listedDoctorFilter(env.DOCTOR_MODE) },
    })
    if (!doctor) return res.status(404).json({ error: 'DOCTOR_NOT_FOUND' })
    // A doctor never receives a record from their own account.
    if (doctor.userId === userId) return res.status(400).json({ error: 'CANNOT_SHARE_WITH_SELF' })
    if (!doctor.acceptingNew) {
      const already = await prisma.doctorChildLink.count({ where: { doctorId: doctor.id, childId: child.id, revokedAt: null } })
      if (!already) return res.status(409).json({ error: 'DOCTOR_NOT_ACCEPTING' })
    }

    // Snapshot exactly what the parent agreed to. A new grant to the same
    // doctor replaces the previous one (so the scopes can be changed).
    const statement = buildDoctorShareStatement(env.DOCTOR_MODE)
    const link = await prisma.$transaction(async (tx) => {
      await tx.doctorChildLink.updateMany({
        where: { doctorId: doctor.id, childId: child.id, revokedAt: null },
        data: { revokedAt: new Date() },
      })
      return tx.doctorChildLink.create({
        data: {
          doctorId: doctor.id,
          childId: child.id,
          grantedById: userId,
          scopes,
          version: DOCTOR_SHARE_VERSION,
          statement: statement as unknown as Prisma.InputJsonValue,
          message: input.message,
        },
        include: { doctor: true },
      })
    })
    return res.status(201).json({ link: serializeDoctorLink(link) })
  }),
)

/** Ending a grant is always allowed, whatever DOCTOR_MODE says. */
childDoctorLinksRouter.delete(
  '/doctor-links/:linkId',
  asyncHandler(async (req, res) => {
    const child = await findOwnedChild(req.params.childId, req.user!.id)
    if (!child) return res.status(404).json({ error: 'CHILD_NOT_FOUND' })
    const linkId = z.string().uuid().safeParse(req.params.linkId)
    if (!linkId.success) return res.status(404).json({ error: 'LINK_NOT_FOUND' })

    const result = await prisma.doctorChildLink.updateMany({
      where: { id: linkId.data, childId: child.id, revokedAt: null },
      data: { revokedAt: new Date() },
    })
    if (!result.count) {
      const exists = await prisma.doctorChildLink.count({ where: { id: linkId.data, childId: child.id } })
      if (!exists) return res.status(404).json({ error: 'LINK_NOT_FOUND' })
    }
    return res.json({ revoked: result.count })
  }),
)
