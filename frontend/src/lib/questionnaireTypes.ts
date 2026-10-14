/** DTOs of the parent-questionnaire API (backend lib/questionnaireSerializers.ts). */

export type QuestionnaireInstrument = 'MCHAT_RF'
export type McHatBand = 'LOW' | 'MODERATE' | 'HIGH'
export type McHatOutcome = 'SCREEN_NEGATIVE' | 'FOLLOW_UP_NEEDED' | 'REFER'
export type FollowUpStatus = 'NOT_NEEDED' | 'PENDING' | 'COMPLETED' | 'NOT_APPLICABLE'
/** IN_APP = the automated Follow-Up taken in AIMBRACE; the others are recorded after an assisted Follow-Up. */
export type FollowUpSource = 'HEALTH_WORKER' | 'A365' | 'OTHER' | 'IN_APP'
/** Sources a parent can pick when recording an assisted Follow-Up (POST /follow-up). */
export type AssistedFollowUpSource = Exclude<FollowUpSource, 'IN_APP'>
export type Respondent = 'MOTHER' | 'FATHER' | 'GUARDIAN' | 'OTHER_CAREGIVER'

/** Server switch MCHAT_MODE. */
export type QuestionnaireServerMode = 'off' | 'entry' | 'inapp'
/** How the 20 stage-1 answers were collected. */
export type QuestionnaireResponseMode = 'IN_APP' | 'OFFICIAL_FORM_ENTRY'

export type InstrumentDto = {
  code: QuestionnaireInstrument
  name: string
  structureVersion: string
  scoringVersion: string
  ageMonths: { min: number; max: number }
  itemCount: number
  mode: QuestionnaireResponseMode
  copyright: string
  officialFormUrl: string
  a365Url: string
  cdcMilestonesUrl: string
}

export type QuestionnairesDto = {
  enabled: boolean
  mode: QuestionnaireServerMode
  /** available: the items can be answered in the app; followUpAvailable: so can the Follow-Up. */
  inApp: { available: boolean; contentVersion: string | null; followUpAvailable?: boolean }
  instruments: InstrumentDto[]
}

/**
 * GET /questionnaires/content — the licensed text, keyed by structure ids.
 * Rendered verbatim; it never carries scoring direction.
 */
export type McHatContentDto = {
  contentVersion: string
  copyrightNotice: string
  /** Credit line of the content file (translation/licence), shown IN ADDITION to the official line when it differs. */
  contentCopyrightNotice?: string | null
  translationSource: string
  ui: {
    stage1Instructions: string
    yes: string
    no: string
    maybe: string
    maybePrompt: string
    mostOftenPrompt: string
    otherDescribe: string
    followUpInstructions: string
  }
  stage1: Array<{ number: number; text: string; examples: string }>
}

export type EligibilityDto = {
  eligible: boolean
  reason: 'TOO_YOUNG' | 'TOO_OLD' | null
  ageMonths: number
  /** YYYY-MM-DD */
  eligibleFrom: string
  /** YYYY-MM-DD */
  eligibleUntil: string
}

export type FollowUpSummaryDto = {
  /** The automated Follow-Up can be taken (or resumed) for this response right now. */
  inAppAvailable: boolean
  /** At least one in-app Follow-Up answer is stored. */
  inAppStarted: boolean
  itemsDone: number
  itemsTotal: number
  /** An "other" description could change an item's route: a health worker should look at it. Only after COMPLETED (false / [] before). */
  needsReview: boolean
  reviewItems: number[]
  /** Per-item Follow-Up scores, only after COMPLETED (doctor summary; numbers only). */
  itemScores: Array<{ item: number; score: 0 | 1 }>
}

export type QuestionnaireResponseDto = {
  id: string
  childId: string
  instrument: QuestionnaireInstrument
  structureVersion: string
  scoringVersion: string
  mode: QuestionnaireResponseMode
  /** `${contentVersion}@${structureHash}` for IN_APP responses, else null. */
  contentVersion: string | null
  respondent: Respondent
  childAgeMonths: number
  totalScore: number
  band: McHatBand
  /** Item numbers that scored 1 (shown only while a follow-up is pending). */
  failedItems: number[]
  followUpStatus: FollowUpStatus
  followUpSource: FollowUpSource | null
  followUpFailCount: number | null
  followUpFailedItems: number[]
  followUp: FollowUpSummaryDto
  outcome: McHatOutcome
  rescreenAfter: string | null
  completedAt: string
  actions: { title: string; body: string[] }
  disclaimer: string
  copyright: string
}

export type ChildQuestionnairesDto = {
  eligibility: { MCHAT_RF: EligibilityDto }
  responses: QuestionnaireResponseDto[]
}

// ---------------------------------------------------------------------------
// In-app Follow-Up (GET /questionnaire-responses/:id/follow-up, POST …/answer, POST …/back)
// ---------------------------------------------------------------------------

/**
 * `example` ids are OPAQUE position ids ('e1', 'e2', … = position of the example in its
 * checklist). The client only echoes them back; they carry no meaning (the server maps them
 * to its structure ids and answers 409 STEP_MISMATCH for an unknown id).
 */
export type FollowUpStepView =
  | { kind: 'PROMPT'; node: string; text: string; note: string }
  | { kind: 'YES_NO'; node: string; text: string; allowMaybe: boolean; maybeLabel: string }
  /**
   * Returned for value 'MAYBE' without recording; answer with value YES|NO + maybe:true
   * (+ the same `example` when it came from a checklist row).
   */
  | { kind: 'MAYBE_RESOLVE'; node: string; text: string; example?: string }
  | {
      kind: 'EXAMPLE'
      node: string
      stem: string
      example: string
      text: string
      isOther: boolean
      index: number
      count: number
      otherPlaceholder: string | null
      allowMaybe: boolean
      maybeLabel: string
    }
  | { kind: 'MOST_OFTEN'; node: string; text: string; options: Array<{ example: string; text: string }> }
  | { kind: 'CHOICE'; node: string; text: string; options: Array<{ option: string; text: string }> }

export type FollowUpItemState = {
  item: number
  state: 'TODO' | 'IN_PROGRESS' | 'DONE'
  /** null (and needsReview false) until the Follow-Up is COMPLETED: never rely on it before. */
  score: 0 | 1 | null
  needsReview: boolean
}

export type FollowUpStateDto = {
  responseId: string
  status: FollowUpStatus
  copyrightNotice: string
  /** Credit line of the content file, shown in addition to the official line when it differs. */
  contentCopyrightNotice?: string | null
  items: FollowUpItemState[]
  current: null | {
    item: number
    itemIndex: number
    itemCount: number
    header: string
    recap: string
    preamble: string | null
    canGoBack: boolean
    step: FollowUpStepView
  }
  /** Present once COMPLETED. */
  response?: QuestionnaireResponseDto
}

/** Body of POST /questionnaire-responses/:id/follow-up/answer. */
export type FollowUpAnswerInput = {
  item: number
  node: string
  /** Opaque position id of the example (EXAMPLE rows and their MAYBE_RESOLVE). */
  example?: string
  /** 'ACK' (PROMPT), 'YES' | 'NO' | 'MAYBE' (yes/no, example rows), an example id (MOST_OFTEN) or an option id (CHOICE). */
  value: string
  maybe?: true
  otherText?: string
}

// ---------------------------------------------------------------------------
// Admin (GET /admin/questionnaires/status) — aggregates only
// ---------------------------------------------------------------------------

export type McHatContentState = 'missing' | 'invalid' | 'ready'

export type AdminQuestionnaireStatusDto = {
  mode: QuestionnaireServerMode
  content: {
    state: McHatContentState
    /** Stage 1 is complete (items shown in the app even while the Follow-Up texts are missing). */
    stage1Ready?: boolean
    /** File name only (no directories). */
    path?: string | null
    file?: string | null
    errors: string[]
    contentVersion: string | null
    licenseRef: string | null
    translationSource: string | null
    structureHash: string | null
  }
  /** null when the server cannot count (e.g. the QuestionnaireResponse table is missing). */
  counts: {
    total: number
    byBand: Record<McHatBand, number>
    followUpPending: number
    inApp: number
  } | null
}
