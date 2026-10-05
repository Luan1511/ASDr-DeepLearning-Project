import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../middleware/asyncHandler'
import { Gender } from '@prisma/client'
import { CONSENT_SCOPES, CONSENT_VERSION, REQUIRED_CONSENT_SCOPES } from '../lib/consent'
import { findActiveConsent, getCurrentConsentStatement } from '../services/consentService'

export const childrenRouter = Router()

childrenRouter.use(requireAuth)

childrenRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const userId = req.user!.id
    const children = await prisma.childProfile.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    })
    return res.json({ children })
  }),
)

const createChildSchema = z
  .object({
    fullName: z.string().min(1).optional(),
    full_name: z.string().min(1).optional(),
    dateOfBirth: z.string().min(1).optional(),
    date_of_birth: z.string().min(1).optional(),
    gender: z.string().optional(),
    note: z.string().optional(),
  })
  .refine((v) => v.fullName || v.full_name, { message: 'fullName is required' })
  .refine((v) => v.dateOfBirth || v.date_of_birth, { message: 'dateOfBirth is required' })

function parseGender(input?: string): Gender {
  const v = (input ?? '').trim().toUpperCase()
  if (v === 'MALE') return Gender.MALE
  if (v === 'FEMALE') return Gender.FEMALE
  if (v === 'OTHER') return Gender.OTHER
  return Gender.UNSPECIFIED
}

childrenRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = createChildSchema.parse(req.body)
    const userId = req.user!.id

    const fullName = input.fullName ?? input.full_name!
    const dobRaw = input.dateOfBirth ?? input.date_of_birth!
    const dateOfBirth = new Date(dobRaw)
    if (Number.isNaN(dateOfBirth.getTime())) {
      return res.status(400).json({ error: 'INVALID_DATE_OF_BIRTH' })
    }

    const child = await prisma.childProfile.create({
      data: {
        userId,
        fullName,
        dateOfBirth,
        gender: parseGender(input.gender),
        note: input.note,
      },
    })

    return res.status(201).json({ child })
  }),
)

async function findOwnedChild(childId: string, userId: string) {
  return prisma.childProfile.findFirst({ where: { id: childId, userId } })
}

// ---------------------------------------------------------------------------
// Guardian consent
// ---------------------------------------------------------------------------

childrenRouter.get(
  '/:id/consent',
  asyncHandler(async (req, res) => {
    const childId = z.string().uuid().parse(req.params.id)
    const child = await findOwnedChild(childId, req.user!.id)
    if (!child) return res.status(404).json({ error: 'CHILD_NOT_FOUND' })

    const consent = await findActiveConsent(childId)
    return res.json({
      currentVersion: CONSENT_VERSION,
      consent: consent
        ? { id: consent.id, version: consent.version, scopes: consent.scopes, grantedAt: consent.grantedAt }
        : null,
    })
  }),
)

const grantConsentSchema = z.object({
  accepted: z.literal(true),
  version: z.string().min(1),
  scopes: z.array(z.enum(CONSENT_SCOPES)).min(1),
})

childrenRouter.post(
  '/:id/consent',
  asyncHandler(async (req, res) => {
    const userId = req.user!.id
    const childId = z.string().uuid().parse(req.params.id)
    const input = grantConsentSchema.parse(req.body)

    const child = await findOwnedChild(childId, userId)
    if (!child) return res.status(404).json({ error: 'CHILD_NOT_FOUND' })

    if (input.version !== CONSENT_VERSION) {
      return res.status(409).json({ error: 'CONSENT_VERSION_OUTDATED', currentVersion: CONSENT_VERSION })
    }
    const scopes = Array.from(new Set(input.scopes))
    if (!REQUIRED_CONSENT_SCOPES.every((s) => scopes.includes(s))) {
      return res.status(400).json({ error: 'CONSENT_SCOPE_REQUIRED', required: REQUIRED_CONSENT_SCOPES })
    }

    // Snapshot exactly what was shown so the record stays auditable even if
    // the wording changes later.
    const statement = await getCurrentConsentStatement()
    const consent = await prisma.$transaction(async (tx) => {
      await tx.consentRecord.updateMany({
        where: { childId, revokedAt: null },
        data: { revokedAt: new Date() },
      })
      return tx.consentRecord.create({
        data: { userId, childId, version: CONSENT_VERSION, scopes, statement },
      })
    })

    return res.status(201).json({
      consent: { id: consent.id, version: consent.version, scopes: consent.scopes, grantedAt: consent.grantedAt },
    })
  }),
)

childrenRouter.delete(
  '/:id/consent',
  asyncHandler(async (req, res) => {
    const childId = z.string().uuid().parse(req.params.id)
    const child = await findOwnedChild(childId, req.user!.id)
    if (!child) return res.status(404).json({ error: 'CHILD_NOT_FOUND' })

    const result = await prisma.consentRecord.updateMany({
      where: { childId, revokedAt: null },
      data: { revokedAt: new Date() },
    })
    return res.json({ revoked: result.count })
  }),
)
