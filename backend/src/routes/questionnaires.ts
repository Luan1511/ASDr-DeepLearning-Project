/**
 * Parent questionnaires (M-CHAT-R/F).
 *
 * MCHAT_MODE:
 * - off (the default until the instrument's authors allow in-app use) closes
 *   the routes that create or change data (consent statement, new response,
 *   Follow-Up) with 503 QUESTIONNAIRE_DISABLED. Reading and deleting
 *   responses that were stored earlier stays open: the parent keeps access to
 *   and control over their child's data whatever the flag.
 * - entry: answers typed by item number from the official form; Follow-Up
 *   recorded after an assisted interview.
 * - inapp: when the licensed content file (MCHAT_CONTENT_PATH) is ready, the
 *   items and the automated Follow-Up are also offered in the app. When only
 *   stage 1 of the file is complete, the items are offered in the app and the
 *   Follow-Up stays the assisted entry. Without a usable file it behaves
 *   exactly like entry.
 *
 * Scoring is always done here; a client never sends a score. Answers are
 * written once and never returned or edited; consent is a snapshot stored on
 * the response row itself (lib/consent.ts).
 */
import { Router, type NextFunction, type Request, type Response } from 'express'
import { Prisma, type QuestionnaireResponse } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { env } from '../lib/env'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../middleware/asyncHandler'
import { QUESTIONNAIRE_CONSENT_VERSION, buildQuestionnaireConsentStatement } from '../lib/consent'
import { mchatEligibility } from '../lib/questionnaires/age'
import { CONTENT_UNAVAILABLE_MESSAGE, DISABLED_MESSAGE } from '../lib/questionnaires/copy'
import {
  AnswersInvalidError,
  ENTRY_MODE,
  FOLLOW_UP_SOURCES,
  FollowUpError,
  IN_APP_FOLLOW_UP_SOURCE,
  IN_APP_MODE,
  MCHAT_RF,
  RESPONDENTS,
  RESPONSE_MODES,
  answersToJson,
  applyFollowUp,
  outcomeAfterStage1,
  parseAnswers,
  rescreenAfterFollowUp,
  scoreStage1,
  type FollowUpStatus,
  type McHatBand,
  type McHatOutcome,
} from '../lib/questionnaires/mchatRf'
import {
  NothingToUndoError,
  OTHER_TEXT_MAX,
  StepMismatchError,
  applyFollowUpAnswer,
  assertMaybeAllowed,
  followUpProgress,
  initFollowUpAnswers,
  parseFollowUpAnswers,
  undoFollowUpStep,
  type FollowUpAnswers,
} from '../lib/questionnaires/followUpEngine'
import {
  getContentStatus,
  getReadyContent,
  getStage1Content,
  resolveContentPath,
  storedContentVersion,
  type ContentStatus,
  type McHatContentFile,
} from '../lib/questionnaires/mchatContent'
import {
  serializeEligibility,
  serializeFollowUpState,
  serializeInstrument,
  serializeQuestionnaireContent,
  serializeQuestionnaireResponse,
  toStructureAnswer,
  type MaybeAt,
} from '../lib/questionnaireSerializers'
import { deleteQuestionnaireResponse } from '../services/dataDeletion'

function requireQuestionnaireEnabled(_req: Request, res: Response, next: NextFunction) {
  if (env.MCHAT_MODE === 'off') {
    return res.status(503).json({ error: 'QUESTIONNAIRE_DISABLED', message: DISABLED_MESSAGE })
  }
  return next()
}

/** The licensed content when MCHAT_MODE=inapp and the whole file is ready (stage 1 + Follow-Up); else null. */
function inAppContent(): McHatContentFile | null {
  if (env.MCHAT_MODE !== 'inapp') return null
  return getReadyContent(resolveContentPath(env.MCHAT_CONTENT_PATH))
}

/** The licensed content when MCHAT_MODE=inapp and at least stage 1 is complete; else null (entry behaviour). */
function stage1Content(): McHatContentFile | null {
  if (env.MCHAT_MODE !== 'inapp') return null
  return getStage1Content(resolveContentPath(env.MCHAT_CONTENT_PATH))
}

/** For the admin status page: the mode and why in-app is (not) available. */
export function questionnaireContentStatus(): { mode: typeof env.MCHAT_MODE; content: ContentStatus } {
  return { mode: env.MCHAT_MODE, content: getContentStatus(resolveContentPath(env.MCHAT_CONTENT_PATH)) }
}

function contentUnavailable(res: Response, status: 409 | 503) {
  return res.status(status).json({ error: 'QUESTIONNAIRE_CONTENT_UNAVAILABLE', message: CONTENT_UNAVAILABLE_MESSAGE })
}

function asJson(answers: FollowUpAnswers): Prisma.InputJsonValue {
  return answers as unknown as Prisma.InputJsonValue
}

async function findOwnedChild(childId: string, userId: string) {
  return prisma.childProfile.findFirst({ where: { id: childId, userId }, select: { id: true, dateOfBirth: true } })
}

/** A response is reachable only through a child the signed-in parent owns. */
async function findOwnedResponse(id: string, userId: string) {
  return prisma.questionnaireResponse.findFirst({ where: { id, child: { userId } } })
}

// ---------------------------------------------------------------------------
// /api/questionnaires
// ---------------------------------------------------------------------------

/** Instrument list + consent statement + licensed content (inapp). */
export const questionnairesRouter = Router()
questionnairesRouter.use(requireAuth)

questionnairesRouter.get('/', (_req, res) => {
  const content = stage1Content()
  return res.json({
    enabled: env.MCHAT_MODE !== 'off',
    mode: env.MCHAT_MODE,
    inApp: {
      available: content !== null,
      contentVersion: content?.contentVersion ?? null,
      followUpAvailable: inAppContent() !== null,
    },
    instruments: [serializeInstrument()],
  })
})

questionnairesRouter.get('/consent-statement', requireQuestionnaireEnabled, (_req, res) => {
  return res.json({ statement: buildQuestionnaireConsentStatement() })
})

questionnairesRouter.get('/content', (_req, res) => {
  const content = stage1Content()
  if (!content) return contentUnavailable(res, 503)
  // Licensed text: shown to signed-in parents only, never cached by intermediaries.
  res.setHeader('Cache-Control', 'private, no-store')
  return res.json(serializeQuestionnaireContent(content))
})

// ---------------------------------------------------------------------------
// /api/children/:childId/questionnaires
// ---------------------------------------------------------------------------

/** Mounted at /children/:childId/questionnaires. */
export const childQuestionnairesRouter = Router({ mergeParams: true })
childQuestionnairesRouter.use(requireAuth)

childQuestionnairesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const childId = z.string().uuid().parse(req.params.childId)
    const child = await findOwnedChild(childId, req.user!.id)
    if (!child) return res.status(404).json({ error: 'CHILD_NOT_FOUND' })

    const responses = await prisma.questionnaireResponse.findMany({
      where: { childId },
      orderBy: { completedAt: 'desc' },
    })
    const inAppAvailable = inAppContent() !== null
    return res.json({
      eligibility: { MCHAT_RF: serializeEligibility(mchatEligibility(child.dateOfBirth, new Date())) },
      responses: responses.map((r) => serializeQuestionnaireResponse(r, { inAppAvailable })),
    })
  }),
)

const submitSchema = z.object({
  instrument: z.literal(MCHAT_RF.instrument),
  respondent: z.enum(RESPONDENTS),
  // Shape checked by parseAnswers, which reports missing item numbers.
  answers: z.unknown(),
  consentAccepted: z.boolean().optional(),
  consentVersion: z.string().max(100).optional(),
  mode: z.enum(RESPONSE_MODES).optional(),
})

childQuestionnairesRouter.post(
  '/',
  requireQuestionnaireEnabled,
  asyncHandler(async (req, res) => {
    const userId = req.user!.id
    const childId = z.string().uuid().parse(req.params.childId)
    const input = submitSchema.parse(req.body)

    const child = await findOwnedChild(childId, userId)
    if (!child) return res.status(404).json({ error: 'CHILD_NOT_FOUND' })

    if (input.consentAccepted !== true) return res.status(400).json({ error: 'CONSENT_REQUIRED' })
    if (input.consentVersion !== QUESTIONNAIRE_CONSENT_VERSION) {
      return res.status(409).json({ error: 'CONSENT_VERSION_OUTDATED', currentVersion: QUESTIONNAIRE_CONSENT_VERSION })
    }

    const mode = input.mode ?? ENTRY_MODE
    const content = mode === IN_APP_MODE ? stage1Content() : null
    // The automated Follow-Up needs the whole file; otherwise a MODERATE result goes to the assisted entry.
    const followUpInApp = content !== null && inAppContent() !== null
    if (mode === IN_APP_MODE && !content) return contentUnavailable(res, 409)

    const now = new Date()
    const eligibility = mchatEligibility(child.dateOfBirth, now)
    if (!eligibility.eligible) {
      return res.status(422).json({
        error: 'AGE_OUT_OF_RANGE',
        reason: eligibility.reason,
        ageMonths: eligibility.ageMonths,
        min: MCHAT_RF.ageMonths.min,
        max: MCHAT_RF.ageMonths.max,
        eligibleFrom: eligibility.eligibleFrom,
        eligibleUntil: eligibility.eligibleUntil,
      })
    }

    let answers
    try {
      answers = parseAnswers(input.answers)
    } catch (error) {
      if (!(error instanceof AnswersInvalidError)) throw error
      if (error.invalid.length > 0) {
        return res.status(400).json({ error: 'VALIDATION_ERROR', invalid: error.invalid, missing: error.missing })
      }
      return res.status(400).json({ error: 'INCOMPLETE_ANSWERS', missing: error.missing })
    }

    const stage1 = scoreStage1(answers)
    const next = outcomeAfterStage1(stage1.band, eligibility.ageMonths, child.dateOfBirth)
    const response = await prisma.questionnaireResponse.create({
      data: {
        userId,
        childId,
        instrument: MCHAT_RF.instrument,
        structureVersion: MCHAT_RF.structureVersion,
        scoringVersion: MCHAT_RF.scoringVersion,
        mode,
        contentVersion: content ? storedContentVersion(content) : null,
        respondent: input.respondent,
        childAgeMonths: eligibility.ageMonths,
        answers: answersToJson(answers),
        totalScore: stage1.total,
        band: stage1.band,
        failedItems: stage1.failedItems,
        followUpStatus: next.followUpStatus,
        followUpFailedItems: [],
        // The in-app Follow-Up starts right away for a MODERATE result.
        ...(followUpInApp && stage1.band === 'MODERATE' ? { followUpAnswers: asJson(initFollowUpAnswers(stage1.failedItems)) } : {}),
        outcome: next.outcome,
        rescreenAfter: next.rescreenAfter,
        consentVersion: QUESTIONNAIRE_CONSENT_VERSION,
        // Snapshot exactly what was shown so the row stays auditable if the wording changes.
        consentStatement: buildQuestionnaireConsentStatement(),
        consentedAt: now,
        completedAt: now,
      },
    })

    return res.status(201).json({ response: serializeQuestionnaireResponse(response, { inAppAvailable: inAppContent() !== null }) })
  }),
)

// ---------------------------------------------------------------------------
// /api/questionnaire-responses/:id
// ---------------------------------------------------------------------------

/** One stored response: read, Follow-Up (in-app or assisted entry), delete. */
export const questionnaireResponsesRouter = Router()
questionnaireResponsesRouter.use(requireAuth)

questionnaireResponsesRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().parse(req.params.id)
    const response = await findOwnedResponse(id, req.user!.id)
    if (!response) return res.status(404).json({ error: 'RESPONSE_NOT_FOUND' })
    return res.json({ response: serializeQuestionnaireResponse(response, { inAppAvailable: inAppContent() !== null }) })
  }),
)

const followUpSchema = z.object({
  source: z.enum(FOLLOW_UP_SOURCES),
  // Membership and duplicates are checked by applyFollowUp (FOLLOW_UP_ITEMS_INVALID).
  stillFailingItems: z.array(z.number()).max(MCHAT_RF.itemCount),
})

/** Assisted entry: the items still scoring 1 after an interview with a health worker / a365. */
questionnaireResponsesRouter.post(
  '/:id/follow-up',
  requireQuestionnaireEnabled,
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().parse(req.params.id)
    const input = followUpSchema.parse(req.body)
    const response = await findOwnedResponse(id, req.user!.id)
    if (!response) return res.status(404).json({ error: 'RESPONSE_NOT_FOUND' })

    let followUp
    try {
      followUp = applyFollowUp(
        {
          band: response.band as McHatBand,
          followUpStatus: response.followUpStatus as FollowUpStatus,
          failedItems: response.failedItems,
        },
        input.stillFailingItems,
      )
    } catch (error) {
      if (!(error instanceof FollowUpError)) throw error
      const status = error.code === 'FOLLOW_UP_NOT_APPLICABLE' ? 409 : 400
      return res.status(status).json({ error: error.code })
    }

    // Conditional on PENDING so two concurrent submissions cannot both apply
    // (an in-app answer holds the row lock until its transaction ends).
    const updated = await prisma.questionnaireResponse.updateMany({
      where: { id, followUpStatus: 'PENDING' },
      data: {
        followUpStatus: 'COMPLETED',
        followUpSource: input.source,
        followUpFailedItems: followUp.followUpFailedItems,
        followUpFailCount: followUp.followUpFailCount,
        followUpCompletedAt: new Date(),
        // The assisted result replaces any partial in-app answers.
        followUpAnswers: Prisma.DbNull,
        outcome: followUp.outcome,
        rescreenAfter: await followUpRescreenAfter(prisma, response, followUp.outcome),
      },
    })
    if (updated.count === 0) return res.status(409).json({ error: 'FOLLOW_UP_NOT_APPLICABLE' })

    const fresh = await findOwnedResponse(id, req.user!.id)
    if (!fresh) return res.status(404).json({ error: 'RESPONSE_NOT_FOUND' })
    return res.json({ response: serializeQuestionnaireResponse(fresh, { inAppAvailable: inAppContent() !== null }) })
  }),
)

/** In-app Follow-Up state: item list + current question (inapp mode with ready content). */
questionnaireResponsesRouter.get(
  '/:id/follow-up',
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().parse(req.params.id)
    const row = await findOwnedResponse(id, req.user!.id)
    if (!row) return res.status(404).json({ error: 'RESPONSE_NOT_FOUND' })
    if (row.band !== 'MODERATE') return res.status(409).json({ error: 'FOLLOW_UP_NOT_APPLICABLE' })
    const content = inAppContent()
    if (!content) return contentUnavailable(res, 503)

    const answers = parseFollowUpAnswers(row.followUpAnswers, row.failedItems) ?? initFollowUpAnswers(row.failedItems)
    res.setHeader('Cache-Control', 'private, no-store')
    return res.json(serializeFollowUpState(row, answers, content, { inAppAvailable: true }))
  }),
)

const followUpAnswerSchema = z.object({
  item: z.number().int().min(1).max(MCHAT_RF.itemCount),
  node: z.string().min(1).max(32),
  example: z.string().min(1).max(32).optional(),
  // YES | NO | MAYBE | ACK | an example / option id
  value: z.string().min(1).max(32),
  maybe: z.boolean().optional(),
  otherText: z.string().max(OTHER_TEXT_MAX).optional(),
})

type LockedOutcome =
  | { ok: false; status: number; error: string }
  | { ok: true; row: QuestionnaireResponse; answers: FollowUpAnswers; maybe?: MaybeAt }

/**
 * Rescreen date after a Follow-Up: like a LOW result, a negative Follow-Up
 * before 24 months is repeated after the second birthday.
 */
async function followUpRescreenAfter(
  db: Prisma.TransactionClient | typeof prisma,
  row: QuestionnaireResponse,
  outcome: McHatOutcome,
): Promise<Date | null> {
  if (outcome !== 'SCREEN_NEGATIVE' || row.childAgeMonths >= MCHAT_RF.rescreenBeforeMonths) return null
  const child = await db.childProfile.findUnique({ where: { id: row.childId }, select: { dateOfBirth: true } })
  return child ? rescreenAfterFollowUp(outcome, row.childAgeMonths, child.dateOfBirth) : null
}

/**
 * Row-locked read-modify-write of the in-app Follow-Up of a pending MODERATE
 * response. `change` returns the new answers (or null for a "maybe" that is
 * not recorded); when every item is done the Follow-Up is finalised with the
 * same rule as the assisted entry (applyFollowUp), source IN_APP.
 */
async function withLockedFollowUp(
  id: string,
  userId: string,
  change: (answers: FollowUpAnswers) => { answers: FollowUpAnswers | null; maybe?: MaybeAt },
): Promise<LockedOutcome> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "QuestionnaireResponse" WHERE "id" = ${id} FOR UPDATE`
    const row = await tx.questionnaireResponse.findFirst({ where: { id, child: { userId } } })
    if (!row) return { ok: false as const, status: 404, error: 'RESPONSE_NOT_FOUND' }
    if (row.band !== 'MODERATE' || row.followUpStatus !== 'PENDING') {
      return { ok: false as const, status: 409, error: 'FOLLOW_UP_NOT_APPLICABLE' }
    }
    const current = parseFollowUpAnswers(row.followUpAnswers, row.failedItems) ?? initFollowUpAnswers(row.failedItems)

    let result
    try {
      result = change(current)
    } catch (error) {
      if (error instanceof StepMismatchError) return { ok: false as const, status: 409, error: 'STEP_MISMATCH' }
      if (error instanceof NothingToUndoError) return { ok: false as const, status: 409, error: 'NOTHING_TO_UNDO' }
      throw error
    }
    if (!result.answers) return { ok: true as const, row, answers: current, maybe: result.maybe }

    const next = result.answers
    const progress = followUpProgress(next)
    if (!progress.complete) {
      const updated = await tx.questionnaireResponse.update({ where: { id }, data: { followUpAnswers: asJson(next) } })
      return { ok: true as const, row: updated, answers: next }
    }

    const followUp = applyFollowUp(
      { band: 'MODERATE', followUpStatus: 'PENDING', failedItems: row.failedItems },
      progress.stillFailing,
    )
    const updated = await tx.questionnaireResponse.update({
      where: { id },
      data: {
        followUpAnswers: asJson(next),
        followUpStatus: 'COMPLETED',
        followUpSource: IN_APP_FOLLOW_UP_SOURCE,
        followUpFailedItems: followUp.followUpFailedItems,
        followUpFailCount: followUp.followUpFailCount,
        followUpCompletedAt: new Date(),
        outcome: followUp.outcome,
        rescreenAfter: await followUpRescreenAfter(tx, row, followUp.outcome),
      },
    })
    return { ok: true as const, row: updated, answers: next }
  })
}

/** Answers the current question; value MAYBE returns its resolution question without recording. */
questionnaireResponsesRouter.post(
  '/:id/follow-up/answer',
  requireQuestionnaireEnabled,
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().parse(req.params.id)
    const input = followUpAnswerSchema.parse(req.body)
    const userId = req.user!.id
    const owned = await findOwnedResponse(id, userId)
    if (!owned) return res.status(404).json({ error: 'RESPONSE_NOT_FOUND' })
    const content = inAppContent()
    if (!content) return contentUnavailable(res, 503)

    const result = await withLockedFollowUp(id, userId, (answers) => {
      // Views carry position ids ("e3"); the engine works on structure ids.
      const answer = toStructureAnswer(input)
      if (answer.value === 'MAYBE') {
        assertMaybeAllowed(answers, answer.item, answer.node, answer.example)
        return { answers: null, maybe: { node: answer.node, example: answer.example } }
      }
      return { answers: applyFollowUpAnswer(answers, answer) }
    })
    if (!result.ok) return res.status(result.status).json({ error: result.error })
    res.setHeader('Cache-Control', 'private, no-store')
    return res.json(
      serializeFollowUpState(result.row, result.answers, content, { inAppAvailable: true, maybe: result.maybe }),
    )
  }),
)

/** Removes the last recorded step (re-opening the previous item when the current one has none). */
questionnaireResponsesRouter.post(
  '/:id/follow-up/back',
  requireQuestionnaireEnabled,
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().parse(req.params.id)
    const userId = req.user!.id
    const owned = await findOwnedResponse(id, userId)
    if (!owned) return res.status(404).json({ error: 'RESPONSE_NOT_FOUND' })
    const content = inAppContent()
    if (!content) return contentUnavailable(res, 503)

    const result = await withLockedFollowUp(id, userId, (answers) => ({ answers: undoFollowUpStep(answers) }))
    if (!result.ok) return res.status(result.status).json({ error: result.error })
    res.setHeader('Cache-Control', 'private, no-store')
    return res.json(serializeFollowUpState(result.row, result.answers, content, { inAppAvailable: true }))
  }),
)

questionnaireResponsesRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().parse(req.params.id)
    const response = await findOwnedResponse(id, req.user!.id)
    if (!response) return res.status(404).json({ error: 'RESPONSE_NOT_FOUND' })

    const { deleted } = await deleteQuestionnaireResponse(id)
    if (!deleted) return res.status(404).json({ error: 'RESPONSE_NOT_FOUND' })
    return res.json({ deleted: true })
  }),
)
