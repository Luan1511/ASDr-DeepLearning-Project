import { prisma } from '../lib/prisma'
import { env } from '../lib/env'
import {
  CONSENT_VERSION,
  EXERCISE_CONSENT_PREFIX,
  EXERCISE_CONSENT_VERSION,
  REQUIRED_CONSENT_SCOPES,
  buildConsentStatement,
  buildExerciseConsentStatement,
  normalizeMlRetention,
  type ConsentStatement,
  type MlVideoRetention,
} from '../lib/consent'
import { isActiveExerciseConsent } from '../lib/exerciseData'
import { openposeService } from './openposeService'

const RETENTION_TTL_MS = 60_000
let retentionCache: { value: MlVideoRetention; at: number } | null = null

/** Ask the ML server what it keeps; an unreachable or older server counts as "unknown". */
export async function getMlVideoRetention(): Promise<MlVideoRetention> {
  if (retentionCache && Date.now() - retentionCache.at < RETENTION_TTL_MS) return retentionCache.value
  let value: MlVideoRetention = 'unknown'
  try {
    const health = await openposeService.getHealth()
    value = normalizeMlRetention(health?.video_retention)
  } catch {
    value = 'unknown'
  }
  retentionCache = { value, at: Date.now() }
  return value
}

export async function getCurrentConsentStatement(): Promise<ConsentStatement> {
  return buildConsentStatement({
    backendKeepsVideo: env.RETAIN_UPLOADED_VIDEOS,
    mlVideoRetention: await getMlVideoRetention(),
  })
}

/** Active = current version, not revoked, covers every required scope. */
export async function findActiveConsent(childId: string) {
  const consent = await prisma.consentRecord.findFirst({
    where: { childId, version: CONSENT_VERSION, revokedAt: null },
    orderBy: { grantedAt: 'desc' },
  })
  if (!consent) return null
  return REQUIRED_CONSENT_SCOPES.every((s) => consent.scopes.includes(s)) ? consent : null
}

// ---------------------------------------------------------------------------
// Exercise consent ("exercise-…" version namespace, see lib/consent.ts)
// ---------------------------------------------------------------------------

export async function getCurrentExerciseConsentStatement(): Promise<ConsentStatement> {
  return buildExerciseConsentStatement({
    // Exercise videos are always deleted after scoring, whatever RETAIN_UPLOADED_VIDEOS says.
    backendKeepsVideo: false,
    mlVideoRetention: await getMlVideoRetention(),
  })
}

/** Active = exercise version, not revoked, covers EXERCISE_VIDEO. Never a screening consent. */
export async function findActiveExerciseConsent(childId: string) {
  const consent = await prisma.consentRecord.findFirst({
    where: { childId, version: EXERCISE_CONSENT_VERSION, revokedAt: null },
    orderBy: { grantedAt: 'desc' },
  })
  return consent && isActiveExerciseConsent(consent) ? consent : null
}

/**
 * When the most recent exercise consent was revoked (by the parent, or by an
 * older backend whose screening re-grant revokes every record), else null.
 */
export async function lastExerciseConsentRevokedAt(childId: string): Promise<Date | null> {
  const latest = await prisma.consentRecord.findFirst({
    where: { childId, version: { startsWith: EXERCISE_CONSENT_PREFIX } },
    orderBy: { grantedAt: 'desc' },
    select: { revokedAt: true },
  })
  return latest?.revokedAt ?? null
}
