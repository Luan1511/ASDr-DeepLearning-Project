import { Router } from 'express'
import { EXERCISE_CONSENT_PREFIX, EXERCISE_CONSENT_SCOPES, EXERCISE_CONSENT_VERSION } from '../lib/consent'
import { exerciseConsentBodySchema } from '../lib/exerciseInput'
import { summarizeExerciseProgress } from '../lib/exerciseData'
import { prisma } from '../lib/prisma'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../middleware/asyncHandler'
import {
  findActiveExerciseConsent,
  getCurrentExerciseConsentStatement,
  lastExerciseConsentRevokedAt,
} from '../services/consentService'
import { findOwnedChild, loadProgressRows, requireExercisesEnabled } from './exercises'

/**
 * Mounted at /children/:childId — exercise consent and progress of one child.
 * Only the "exercise-…" consent namespace is touched here; the screening
 * consent (children.ts) is never revoked from this router and vice versa.
 */
export const childExercisesRouter = Router({ mergeParams: true })

childExercisesRouter.use(requireAuth)

function serializeConsent(c: { id: string; version: string; scopes: string[]; grantedAt: Date }) {
  return { id: c.id, version: c.version, scopes: c.scopes, grantedAt: c.grantedAt }
}

childExercisesRouter.get(
  '/exercise-consent',
  requireExercisesEnabled,
  asyncHandler(async (req, res) => {
    const child = await findOwnedChild(req.params.childId, req.user!.id)
    if (!child) return res.status(404).json({ error: 'CHILD_NOT_FOUND' })

    const consent = await findActiveExerciseConsent(child.id)
    return res.json({
      currentVersion: EXERCISE_CONSENT_VERSION,
      consent: consent ? serializeConsent(consent) : null,
      lastRevokedAt: consent ? null : await lastExerciseConsentRevokedAt(child.id),
    })
  }),
)

childExercisesRouter.post(
  '/exercise-consent',
  requireExercisesEnabled,
  asyncHandler(async (req, res) => {
    const userId = req.user!.id
    const input = exerciseConsentBodySchema.parse(req.body)
    const child = await findOwnedChild(req.params.childId, userId)
    if (!child) return res.status(404).json({ error: 'CHILD_NOT_FOUND' })

    if (input.version !== EXERCISE_CONSENT_VERSION) {
      return res.status(409).json({ error: 'CONSENT_VERSION_OUTDATED', currentVersion: EXERCISE_CONSENT_VERSION })
    }
    const scopes = Array.from(new Set(input.scopes))
    if (!EXERCISE_CONSENT_SCOPES.every((s) => scopes.includes(s))) {
      return res.status(400).json({ error: 'CONSENT_SCOPE_REQUIRED', required: EXERCISE_CONSENT_SCOPES })
    }

    // Snapshot exactly what was shown (audit trail).
    const statement = await getCurrentExerciseConsentStatement()
    const consent = await prisma.$transaction(async (tx) => {
      await tx.consentRecord.updateMany({
        where: { childId: child.id, revokedAt: null, version: { startsWith: EXERCISE_CONSENT_PREFIX } },
        data: { revokedAt: new Date() },
      })
      return tx.consentRecord.create({
        data: {
          userId,
          childId: child.id,
          version: EXERCISE_CONSENT_VERSION,
          scopes: scopes.filter((s) => (EXERCISE_CONSENT_SCOPES as readonly string[]).includes(s)),
          statement,
        },
      })
    })
    return res.status(201).json({ consent: serializeConsent(consent) })
  }),
)

/**
 * Always allowed (whatever EXERCISE_MODE says): a parent must be able to
 * withdraw consent. Queued attempts then fail in the worker without an ML call.
 */
childExercisesRouter.delete(
  '/exercise-consent',
  asyncHandler(async (req, res) => {
    const child = await findOwnedChild(req.params.childId, req.user!.id)
    if (!child) return res.status(404).json({ error: 'CHILD_NOT_FOUND' })

    const result = await prisma.consentRecord.updateMany({
      where: { childId: child.id, revokedAt: null, version: { startsWith: EXERCISE_CONSENT_PREFIX } },
      data: { revokedAt: new Date() },
    })
    return res.json({ revoked: result.count })
  }),
)

childExercisesRouter.get(
  '/exercise-progress',
  requireExercisesEnabled,
  asyncHandler(async (req, res) => {
    const child = await findOwnedChild(req.params.childId, req.user!.id)
    if (!child) return res.status(404).json({ error: 'CHILD_NOT_FOUND' })

    const rows = await loadProgressRows({ childId: child.id })
    return res.json({ exercises: summarizeExerciseProgress(rows) })
  }),
)
