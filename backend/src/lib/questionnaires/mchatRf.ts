/**
 * M-CHAT-R/F structure and scoring rules, by item number only.
 *
 * The instrument is copyrighted: this repo holds no item wording, instructions
 * or Follow-Up wording. Parents read the official form (officialFormUrl) and
 * enter Có/Không per item number; the rules below turn that into a result.
 */
import { secondBirthday } from './age'

export const MCHAT_RF = Object.freeze({
  instrument: 'MCHAT_RF',
  name: 'M-CHAT-R/F',
  structureVersion: 'mchat-rf-2025-03',
  scoringVersion: 'mchat-rf-scoring-v1',
  itemCount: 20,
  /** Items where "Có" scores 1; on every other item "Không" scores 1. */
  elevatedOnYes: Object.freeze([2, 5, 12] as const),
  bands: Object.freeze([
    Object.freeze({ band: 'LOW', min: 0, max: 2 }),
    Object.freeze({ band: 'MODERATE', min: 3, max: 7 }),
    Object.freeze({ band: 'HIGH', min: 8, max: 20 }),
  ] as const),
  /** Follow-Up: this many items still scoring 1 → refer. */
  followUpReferAt: 2,
  ageMonths: Object.freeze({ min: 16, max: 30 }),
  /** A LOW (or Follow-Up negative) result before this age is repeated after the second birthday. */
  rescreenBeforeMonths: 24,
  copyright: 'M-CHAT-R/F™ © 2009 Diana Robins, Deborah Fein, & Marianne Barton',
  officialFormUrl: 'https://www.mchatscreen.com/mchat-rf/translations/',
  a365Url: 'https://a365.vn',
  cdcMilestonesUrl: 'https://www.cdc.gov/act-early/resources/milestone-checklists.html',
})

export type McHatBand = 'LOW' | 'MODERATE' | 'HIGH'
export type McHatOutcome = 'SCREEN_NEGATIVE' | 'FOLLOW_UP_NEEDED' | 'REFER'
export type FollowUpStatus = 'NOT_NEEDED' | 'PENDING' | 'COMPLETED' | 'NOT_APPLICABLE'
/** Item number → answer; true = "Có". */
export type Answers = Record<number, boolean>

export const ENTRY_MODE = 'OFFICIAL_FORM_ENTRY'
/** The parent answered the items shown in the app (licensed content file, MCHAT_MODE=inapp). */
export const IN_APP_MODE = 'IN_APP'
export const RESPONSE_MODES = [ENTRY_MODE, IN_APP_MODE] as const
export type ResponseMode = (typeof RESPONSE_MODES)[number]
export const RESPONDENTS = ['MOTHER', 'FATHER', 'GUARDIAN', 'OTHER_CAREGIVER'] as const
export type Respondent = (typeof RESPONDENTS)[number]
/** Who ran the Follow-Up interview with the parent (assisted entry). */
export const FOLLOW_UP_SOURCES = ['HEALTH_WORKER', 'A365', 'OTHER'] as const
export type FollowUpSource = (typeof FOLLOW_UP_SOURCES)[number]
/** Stored when the parent completed the automated Follow-Up in the app. */
export const IN_APP_FOLLOW_UP_SOURCE = 'IN_APP'
export type StoredFollowUpSource = FollowUpSource | typeof IN_APP_FOLLOW_UP_SOURCE

export const ITEM_NUMBERS: readonly number[] = Object.freeze(
  Array.from({ length: MCHAT_RF.itemCount }, (_, i) => i + 1),
)

const ITEM_KEY = /^(?:[1-9]|1\d|20)$/
const ELEVATED_ON_YES: ReadonlySet<number> = new Set(MCHAT_RF.elevatedOnYes)

export class AnswersInvalidError extends Error {
  constructor(
    readonly missing: number[],
    readonly invalid: string[],
  ) {
    super(
      invalid.length > 0
        ? `Invalid answer keys or values: ${invalid.join(', ')}`
        : `Missing answers for items: ${missing.join(', ')}`,
    )
    this.name = 'AnswersInvalidError'
  }
}

export class FollowUpError extends Error {
  constructor(readonly code: 'FOLLOW_UP_NOT_APPLICABLE' | 'FOLLOW_UP_ITEMS_INVALID') {
    super(
      code === 'FOLLOW_UP_NOT_APPLICABLE'
        ? 'Follow-Up only applies to a MODERATE result that is still pending.'
        : 'Follow-Up items must be distinct items that scored 1 in the first stage.',
    )
    this.name = 'FollowUpError'
  }
}

/**
 * Accepts {"1": true, …, "20": false}: keys exactly "1".."20" (no padding),
 * values boolean. Unknown keys and non-boolean values are reported in
 * `invalid`; absent items in `missing`.
 */
export function parseAnswers(raw: unknown): Answers {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new AnswersInvalidError([...ITEM_NUMBERS], ['answers'])
  }
  const answers: Answers = {}
  const invalid: string[] = []
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!ITEM_KEY.test(key) || typeof value !== 'boolean') {
      invalid.push(key)
      continue
    }
    answers[Number(key)] = value
  }
  const missing = ITEM_NUMBERS.filter((n) => !(n in answers) && !invalid.includes(String(n)))
  if (missing.length > 0 || invalid.length > 0) throw new AnswersInvalidError(missing, invalid)
  return answers
}

/** JSON stored on the row: item numbers in order, nothing else. */
export function answersToJson(answers: Answers): Record<string, boolean> {
  const json: Record<string, boolean> = {}
  for (const n of ITEM_NUMBERS) json[String(n)] = answers[n]
  return json
}

export function bandForTotal(total: number): McHatBand {
  const match = MCHAT_RF.bands.find((b) => total >= b.min && total <= b.max)
  if (!match) throw new RangeError(`Total ${total} is outside 0..${MCHAT_RF.itemCount}`)
  return match.band
}

export function scoreStage1(answers: Answers): {
  itemScores: Record<number, 0 | 1>
  total: number
  band: McHatBand
  failedItems: number[]
} {
  const itemScores: Record<number, 0 | 1> = {}
  const failedItems: number[] = []
  for (const n of ITEM_NUMBERS) {
    const answer = answers[n]
    if (typeof answer !== 'boolean') throw new AnswersInvalidError([n], [])
    const score: 0 | 1 = (answer === ELEVATED_ON_YES.has(n)) ? 1 : 0
    itemScores[n] = score
    if (score === 1) failedItems.push(n)
  }
  const total = failedItems.length
  return { itemScores, total, band: bandForTotal(total), failedItems }
}

/**
 * LOW → screen negative (repeat after the 2nd birthday when younger than 24
 * months); MODERATE → Follow-Up pending; HIGH → refer right away, never
 * downgraded by a Follow-Up.
 */
export function outcomeAfterStage1(
  band: McHatBand,
  ageMonths: number,
  dobUtc: Date,
): { outcome: McHatOutcome; followUpStatus: FollowUpStatus; rescreenAfter: Date | null } {
  switch (band) {
    case 'LOW':
      return {
        outcome: 'SCREEN_NEGATIVE',
        followUpStatus: 'NOT_NEEDED',
        rescreenAfter: ageMonths < MCHAT_RF.rescreenBeforeMonths ? secondBirthday(dobUtc) : null,
      }
    case 'MODERATE':
      return { outcome: 'FOLLOW_UP_NEEDED', followUpStatus: 'PENDING', rescreenAfter: null }
    case 'HIGH':
      return { outcome: 'REFER', followUpStatus: 'NOT_APPLICABLE', rescreenAfter: null }
  }
}

/**
 * Rescreen date once a Follow-Up is recorded: a SCREEN_NEGATIVE result
 * before 24 months is repeated after the second birthday, as for LOW.
 */
export function rescreenAfterFollowUp(outcome: McHatOutcome, ageMonths: number, dobUtc: Date): Date | null {
  return outcome === 'SCREEN_NEGATIVE' && ageMonths < MCHAT_RF.rescreenBeforeMonths ? secondBirthday(dobUtc) : null
}

/**
 * Records which first-stage items still score 1 after the Follow-Up
 * interview. Only a pending MODERATE result qualifies; the items must be a
 * duplicate-free subset of `failedItems`.
 */
export function applyFollowUp(
  r: { band: McHatBand; followUpStatus: FollowUpStatus; failedItems: number[] },
  stillFailing: number[],
): { followUpFailedItems: number[]; followUpFailCount: number; outcome: 'SCREEN_NEGATIVE' | 'REFER' } {
  if (r.band !== 'MODERATE' || r.followUpStatus !== 'PENDING') throw new FollowUpError('FOLLOW_UP_NOT_APPLICABLE')
  const failed = new Set(r.failedItems)
  const unique = new Set(stillFailing)
  if (unique.size !== stillFailing.length || !stillFailing.every((n) => Number.isInteger(n) && failed.has(n))) {
    throw new FollowUpError('FOLLOW_UP_ITEMS_INVALID')
  }
  const followUpFailedItems = [...stillFailing].sort((a, b) => a - b)
  return {
    followUpFailedItems,
    followUpFailCount: followUpFailedItems.length,
    outcome: followUpFailedItems.length >= MCHAT_RF.followUpReferAt ? 'REFER' : 'SCREEN_NEGATIVE',
  }
}
