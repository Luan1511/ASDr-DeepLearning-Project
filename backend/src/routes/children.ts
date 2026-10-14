import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../middleware/asyncHandler'
import { CONSENT_SCOPES, CONSENT_VERSION, EXERCISE_CONSENT_PREFIX, REQUIRED_CONSENT_SCOPES } from '../lib/consent'
import {
  createChildSchema,
  normalizeNote,
  parseBirthDate,
  parseGender,
  updateChildSchema,
} from '../lib/childInput'
import { EMPTY_CHILD_SUMMARY, summarizeScreenings } from '../lib/screeningData'
import { serializeChild, serializeScreening } from '../lib/serializers'
import { findActiveConsent, getCurrentConsentStatement } from '../services/consentService'
import { DataDeletionError, deleteChildData } from '../services/dataDeletion'

export const childrenRouter = Router()

childrenRouter.use(requireAuth)

/** Children of the signed-in parent, each with a short screening summary. */
childrenRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const userId = req.user!.id
    const [children, uploads, consents] = await Promise.all([
      prisma.childProfile.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } }),
      prisma.videoUpload.findMany({
        where: { userId },
        select: { childId: true, createdAt: true, result: { select: { riskLevel: true } } },
      }),
      prisma.consentRecord.findMany({
        where: { userId, version: CONSENT_VERSION, revokedAt: null },
        select: { childId: true, scopes: true },
      }),
    ])

    const summaries = summarizeScreenings(uploads)
    const consented = new Set(
      consents.filter((c) => REQUIRED_CONSENT_SCOPES.every((s) => c.scopes.includes(s))).map((c) => c.childId),
    )
    return res.json({
      children: children.map((child) =>
        serializeChild(child, {
          ...(summaries.get(child.id) ?? EMPTY_CHILD_SUMMARY),
          hasActiveConsent: consented.has(child.id),
        }),
      ),
    })
  }),
)

childrenRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = createChildSchema.parse(req.body)
    const userId = req.user!.id

    const dateOfBirth = parseBirthDate(input.dateOfBirth ?? input.date_of_birth!)
    if (!dateOfBirth) return res.status(400).json({ error: 'INVALID_DATE_OF_BIRTH' })

    const child = await prisma.childProfile.create({
      data: {
        userId,
        fullName: input.fullName ?? input.full_name!,
        dateOfBirth,
        gender: parseGender(input.gender),
        note: normalizeNote(input.note),
      },
    })

    return res.status(201).json({ child: serializeChild(child) })
  }),
)

async function findOwnedChild(childId: string, userId: string) {
  return prisma.childProfile.findFirst({ where: { id: childId, userId } })
}

/** Dashboard data for one child: profile, consent status and every screening with its result. */
childrenRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const childId = z.string().uuid().parse(req.params.id)
    const child = await findOwnedChild(childId, req.user!.id)
    if (!child) return res.status(404).json({ error: 'CHILD_NOT_FOUND' })

    const [screenings, consent] = await Promise.all([
      prisma.videoUpload.findMany({
        where: { childId },
        include: { result: true, job: true },
        orderBy: { createdAt: 'desc' },
      }),
      findActiveConsent(childId),
    ])
    const summary = summarizeScreenings(screenings).get(childId) ?? EMPTY_CHILD_SUMMARY

    return res.json({
      child: serializeChild(child, { ...summary, hasActiveConsent: Boolean(consent) }),
      consent: consent
        ? { id: consent.id, version: consent.version, scopes: consent.scopes, grantedAt: consent.grantedAt }
        : null,
      screenings: screenings.map((s) => serializeScreening(s)),
    })
  }),
)

childrenRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const childId = z.string().uuid().parse(req.params.id)
    const input = updateChildSchema.parse(req.body)
    const child = await findOwnedChild(childId, req.user!.id)
    if (!child) return res.status(404).json({ error: 'CHILD_NOT_FOUND' })

    let dateOfBirth: Date | undefined
    if (input.dateOfBirth !== undefined) {
      const parsed = parseBirthDate(input.dateOfBirth)
      if (!parsed) return res.status(400).json({ error: 'INVALID_DATE_OF_BIRTH' })
      dateOfBirth = parsed
    }

    const updated = await prisma.childProfile.update({
      where: { id: childId },
      data: {
        fullName: input.fullName,
        dateOfBirth,
        gender: input.gender === undefined ? undefined : parseGender(input.gender),
        note: normalizeNote(input.note),
      },
    })
    return res.json({ child: serializeChild(updated) })
  }),
)

/**
 * Permanently delete the profile and all of the child's data (screenings,
 * results, consent records, raw uploads, ML-side keypoints and video copies).
 */
childrenRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const childId = z.string().uuid().parse(req.params.id)
    const child = await findOwnedChild(childId, req.user!.id)
    if (!child) return res.status(404).json({ error: 'CHILD_NOT_FOUND' })

    try {
      const summary = await deleteChildData(childId)
      // eslint-disable-next-line no-console
      console.log(
        `[children] deleted child ${childId}: ${summary.deletedScreenings} screening(s), ${summary.mlSubjectsDeleted} ML subject(s)`,
      )
      return res.json({ deleted: true, ...summary })
    } catch (error) {
      if (error instanceof DataDeletionError) {
        return res.status(error.httpStatus).json({ error: error.code, message: error.message })
      }
      throw error
    }
  }),
)

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

// Screening grant/revoke leaves the exercise consent namespace alone (it has
// its own endpoints in childExercises.ts).
const NOT_EXERCISE_CONSENT = { NOT: { version: { startsWith: EXERCISE_CONSENT_PREFIX } } }

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
        where: { childId, revokedAt: null, ...NOT_EXERCISE_CONSENT },
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
      where: { childId, revokedAt: null, ...NOT_EXERCISE_CONSENT },
      data: { revokedAt: new Date() },
    })
    return res.json({ revoked: result.count })
  }),
)
