import { z } from 'zod'

export const MOVEMENT_VERSION = 'exercise-errors-v0.3'
export const MOVEMENT_PROFILES = ['jump-twists', 'jumping-jacks', 'high-kicks'] as const
export type MovementProfile = (typeof MOVEMENT_PROFILES)[number]

export const CHECK_CODES = {
  'jump-twists': [
    'ARM_LEG_COORDINATION_INVERTED', 'TWIST_REPEAT_DIRECTION', 'TWIST_LEGS_STILL', 'TWIST_REVERSAL_DELAY',
  ],
  'jumping-jacks': [
    'JACKS_ARM_FOOT_OUT_OF_PHASE', 'JACKS_MISSING_FOOT_OPEN', 'JACKS_MISSING_FOOT_CLOSE', 'JACKS_ONE_ARM_IDLE',
  ],
  'high-kicks': ['KICK_SAME_LEG_REPEATED', 'KICK_EXTENSION_MISSING'],
} as const

export type MovementCode = (typeof CHECK_CODES)[MovementProfile][number]
export const MOVEMENT_LABELS: Record<MovementCode, string> = {
  ARM_LEG_COORDINATION_INVERTED: 'Phối hợp tay và chân',
  TWIST_REPEAT_DIRECTION: 'Đổi phía khi xoay',
  TWIST_LEGS_STILL: 'Chuyển động chân theo tay',
  TWIST_REVERSAL_DELAY: 'Đổi hướng cùng nhịp',
  JACKS_ARM_FOOT_OUT_OF_PHASE: 'Nâng tay cùng lúc mở chân',
  JACKS_MISSING_FOOT_OPEN: 'Pha mở chân',
  JACKS_MISSING_FOOT_CLOSE: 'Pha khép chân',
  JACKS_ONE_ARM_IDLE: 'Nâng và hạ cả hai tay',
  KICK_SAME_LEG_REPEATED: 'Đổi chân sau mỗi cú đá',
  KICK_EXTENSION_MISSING: 'Pha duỗi chân',
}

export type MovementFrame = {
  timeSec: number
  pose: Array<[number, number] | null> | null
  confidence: number[]
}

const finite = z.number().finite()
const count = finite.int().nonnegative()
const shared = { version: z.literal(MOVEMENT_VERSION), guideSourceFps: finite.positive() }
const referenceSchema = z.discriminatedUnion('profile', [
  z.object({
    ...shared,
    profile: z.literal('jump-twists'),
    reference: z.object({
      pattern: z.object({
        relation: z.enum(['opposed', 'together', 'uncertain']),
        validCycles: count,
        medianCorrelation: finite.nullable(),
        agreement: finite,
        medianAbsoluteLagCycles: finite.nullable(),
      }),
      reversal: z.object({ delay: finite, spread: finite.nonnegative() }).nullable(),
    }),
  }),
  z.object({
    ...shared,
    profile: z.literal('jumping-jacks'),
    reference: z.object({ guideLag: finite, guidePhaseRepetitions: count }),
  }),
  z.object({
    ...shared,
    profile: z.literal('high-kicks'),
    reference: z.object({
      valid: z.boolean(),
      measurableKicks: count,
      extendedKicks: count,
      reason: z.string().optional(),
    }),
  }),
])
export type MovementReference = z.infer<typeof referenceSchema>

export function readMovementReference(value: unknown): MovementReference | null {
  const result = referenceSchema.safeParse(value)
  return result.success ? result.data : null
}

/**
 * Why a template has no usable movement reference:
 *  - 'none'     the template was compiled without a movement profile;
 *  - 'current'  the stored calibration matches MOVEMENT_VERSION;
 *  - 'outdated' it was compiled by another version of the detectors. The
 *               calibration scalars are version-specific, so the template has
 *               to be compiled again before it gives movement feedback.
 */
export function movementReferenceState(value: unknown): 'none' | 'current' | 'outdated' {
  if (value === undefined || value === null) return 'none'
  return readMovementReference(value) ? 'current' : 'outdated'
}

function isMovementCode(code: string): code is MovementCode {
  return Object.prototype.hasOwnProperty.call(MOVEMENT_LABELS, code)
}

const code = z.string().refine(isMovementCode).transform(value => value as MovementCode)
const label = z.string().min(1).max(180)
/**
 * Stored reports only carry labels, feedback text and time ranges, so a report
 * written by an earlier detector version stays readable after MOVEMENT_VERSION
 * moves on (a strict literal here used to make old attempts lose their feedback).
 */
const reportVersion = z.string().regex(/^exercise-errors-v\d+(\.\d+)*$/)
const reportSchema = z.object({
  version: reportVersion,
  profile: z.enum(MOVEMENT_PROFILES),
  checks: z.array(z.object({
    code,
    label,
    status: z.enum(['evaluated', 'unmeasurable']),
  })).max(4),
  events: z.array(z.object({
    code,
    label,
    feedback: label,
    startSec: finite.nonnegative(),
    endSec: finite.positive(),
    repetitions: count.nullable(),
  }).refine(event => event.endSec > event.startSec)),
})

export type MovementReport = z.infer<typeof reportSchema>

export function readMovementReport(value: unknown): MovementReport | null {
  const result = reportSchema.safeParse(value)
  return result.success ? result.data : null
}

/** Numbers of one attempt for the progress view: how much could be measured and what repeated. */
export type MovementSummary = {
  /** Criteria of the exercise's profile. */
  checks: number
  /** Criteria the recording allowed to measure. */
  evaluated: number
  /** Distinct criteria with at least one repeated error. */
  flagged: number
}

export function summarizeMovementReport(report: MovementReport): MovementSummary {
  const flagged = new Set(report.events.map(event => event.code))
  return {
    checks: report.checks.length,
    evaluated: report.checks.filter(check => check.status === 'evaluated').length,
    flagged: report.checks.filter(check => flagged.has(check.code)).length,
  }
}
