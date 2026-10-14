/**
 * Parent-facing shapes of the questionnaire API (frontend lib/questionnaireTypes.ts).
 *
 * `answers`, the consent snapshot, `userId` and the recorded Follow-Up paths
 * (incl. any "Other" description) are never output: they stay in the
 * database for the parent's record. Item numbers appear only as the list to
 * go through in a pending Follow-Up, the items still scoring 1 after it and
 * the per-item Follow-Up scores (numbers only, for the doctor summary).
 *
 * Licensed text is output only by serializeQuestionnaireContent and
 * serializeFollowUpState, from the content file (mchatContent.ts). Follow-Up
 * views carry position ids for examples, never the structure ids that name
 * an example's scoring group (examplePositionId / toStructureAnswer).
 */
import type { QuestionnaireResponse } from '@prisma/client'
import type { McHatEligibility } from './questionnaires/age'
import { COPYRIGHT_NOTICE, DISCLAIMER, outcomeCopy } from './questionnaires/copy'
import {
  ENTRY_MODE,
  MCHAT_RF,
  type FollowUpStatus,
  type McHatBand,
  type McHatOutcome,
  type Respondent,
  type ResponseMode,
  type StoredFollowUpSource,
} from './questionnaires/mchatRf'
import {
  StepMismatchError,
  followUpProgress,
  parseFollowUpAnswers,
  preamblesFor,
  type FollowUpAnswers,
  type FollowUpProgress,
  type StepAnswer,
  type StepPosition,
} from './questionnaires/followUpEngine'
import type { ChecklistContent, ChoiceContent, McHatContentFile, PromptContent, TextContent } from './questionnaires/mchatContent'
import { followUpItem, type ChecklistNode } from './questionnaires/mchatRfStructure'

export function serializeInstrument() {
  return {
    code: MCHAT_RF.instrument,
    name: MCHAT_RF.name,
    structureVersion: MCHAT_RF.structureVersion,
    scoringVersion: MCHAT_RF.scoringVersion,
    ageMonths: { min: MCHAT_RF.ageMonths.min, max: MCHAT_RF.ageMonths.max },
    itemCount: MCHAT_RF.itemCount,
    mode: ENTRY_MODE,
    copyright: MCHAT_RF.copyright,
    officialFormUrl: MCHAT_RF.officialFormUrl,
    a365Url: MCHAT_RF.a365Url,
    cdcMilestonesUrl: MCHAT_RF.cdcMilestonesUrl,
  }
}

export function serializeEligibility(e: McHatEligibility) {
  return {
    eligible: e.eligible,
    reason: e.reason,
    ageMonths: e.ageMonths,
    eligibleFrom: e.eligibleFrom,
    eligibleUntil: e.eligibleUntil,
  }
}

export type SerializeResponseOptions = {
  /** MCHAT_MODE=inapp and the content file is ready. */
  inAppAvailable?: boolean
}

function sortedUnique(items: readonly number[]): number[] {
  return [...new Set(items)].sort((a, b) => a - b)
}

/** In-app progress of a MODERATE response; null when nothing usable is stored. */
function storedProgress(row: QuestionnaireResponse): FollowUpProgress | null {
  if (row.band !== 'MODERATE') return null
  const answers = parseFollowUpAnswers(row.followUpAnswers, row.failedItems)
  return answers ? followUpProgress(answers) : null
}

function followUpSummary(row: QuestionnaireResponse, inAppAvailable: boolean) {
  const moderate = row.band === 'MODERATE'
  const status = row.followUpStatus as FollowUpStatus
  const progress = storedProgress(row)
  const failed = sortedUnique(row.failedItems)
  const stillFailing = new Set(row.followUpFailedItems)
  // Like the per-item scores, review flags are output only once the Follow-Up is COMPLETED.
  const reviewItems = status === 'COMPLETED' ? (progress?.reviewItems ?? []) : []
  return {
    inAppAvailable: moderate && status === 'PENDING' && inAppAvailable,
    inAppStarted: (progress?.stepCount ?? 0) > 0,
    itemsDone: progress ? progress.items.filter((i) => i.state === 'DONE').length : 0,
    itemsTotal: moderate ? failed.length : 0,
    needsReview: reviewItems.length > 0,
    reviewItems,
    // Numbers only, once the Follow-Up is recorded (in the app or assisted).
    itemScores:
      moderate && status === 'COMPLETED'
        ? failed.map((item) => ({ item, score: (stillFailing.has(item) ? 1 : 0) as 0 | 1 }))
        : [],
  }
}

export function serializeQuestionnaireResponse(row: QuestionnaireResponse, options: SerializeResponseOptions = {}) {
  const band = row.band as McHatBand
  const followUpStatus = row.followUpStatus as FollowUpStatus
  const outcome = row.outcome as McHatOutcome
  const followUpPending = band === 'MODERATE' && followUpStatus === 'PENDING'
  const failedItems = followUpPending ? [...row.failedItems].sort((a, b) => a - b) : []
  const followUp = followUpSummary(row, options.inAppAvailable === true)

  return {
    id: row.id,
    childId: row.childId,
    instrument: row.instrument as typeof MCHAT_RF.instrument,
    structureVersion: row.structureVersion,
    scoringVersion: row.scoringVersion,
    mode: row.mode as ResponseMode,
    contentVersion: row.contentVersion ?? null,
    respondent: row.respondent as Respondent,
    childAgeMonths: row.childAgeMonths,
    totalScore: row.totalScore,
    band,
    failedItems,
    followUpStatus,
    followUpSource: (row.followUpSource as StoredFollowUpSource | null) ?? null,
    followUpFailCount: row.followUpFailCount ?? null,
    followUpFailedItems: followUpStatus === 'COMPLETED' ? [...row.followUpFailedItems].sort((a, b) => a - b) : [],
    followUp,
    outcome,
    rescreenAfter: row.rescreenAfter ? row.rescreenAfter.toISOString() : null,
    completedAt: row.completedAt.toISOString(),
    actions: outcomeCopy(outcome, {
      afterFollowUp: followUpStatus === 'COMPLETED',
      rescreenAfter: row.rescreenAfter,
      followUpItems: failedItems,
      inAppAvailable: followUp.inAppAvailable,
    }),
    disclaimer: DISCLAIMER,
    copyright: COPYRIGHT_NOTICE,
  }
}

export type QuestionnaireResponseDto = ReturnType<typeof serializeQuestionnaireResponse>

// ---------------------------------------------------------------------------
// In-app mode (licensed text from the content file)
// ---------------------------------------------------------------------------

/**
 * Copyright lines of an in-app screen: always the official authors' line
 * (MCHAT_RF.copyright), plus the content file's own line when it says
 * something else (e.g. the translation credit).
 */
function copyrightLines(content: McHatContentFile): { copyrightNotice: string; contentCopyrightNotice?: string } {
  const own = content.copyrightNotice.trim()
  return own && own !== MCHAT_RF.copyright
    ? { copyrightNotice: MCHAT_RF.copyright, contentCopyrightNotice: own }
    : { copyrightNotice: MCHAT_RF.copyright }
}

/** GET /api/questionnaires/content: stage-1 texts in item order, no scoring direction. */
export function serializeQuestionnaireContent(content: McHatContentFile) {
  return {
    contentVersion: content.contentVersion,
    ...copyrightLines(content),
    translationSource: content.translationSource,
    ui: { ...content.ui },
    stage1: Array.from({ length: MCHAT_RF.itemCount }, (_, i) => {
      const item = content.stage1[String(i + 1)]
      return { number: i + 1, text: item.text, examples: item.examples }
    }),
  }
}

/**
 * Example ids in the views are POSITION ids: "e" + the 1-based position of
 * the example in its checklist. The structure ids (p…/f…/n…, …o) name the
 * example's group, i.e. which answer scores, so they never leave the server;
 * toStructureAnswer() maps a posted position id back.
 */
export function examplePositionId(index: number): string {
  return `e${index + 1}`
}

const POSITION_ID = /^e([1-9]\d{0,2})$/

/** The checklist node `node` of `item` (main or supplementary graph), or null. */
function checklistNode(item: number, node: string): ChecklistNode | null {
  const graph = followUpItem(item)
  const found = graph.nodes[node] ?? graph.supplementary?.nodes[node]
  return found?.type === 'CHECKLIST' ? found : null
}

function structureExampleId(list: ChecklistNode | null, positionId: string): string {
  const match = POSITION_ID.exec(positionId)
  const example = match && list ? list.examples[Number(match[1]) - 1] : undefined
  if (!example) throw new StepMismatchError('unknown example')
  return example.id
}

/**
 * Maps a posted Follow-Up answer from view ids to structure ids: `example` of
 * an example row and the chosen option of a "most often" question. Unknown
 * ids (structure ids included) throw StepMismatchError.
 */
export function toStructureAnswer<T extends StepAnswer & { item: number }>(answer: T): T {
  const graph = followUpItem(answer.item)
  const mapped = { ...answer }
  if (answer.example !== undefined) mapped.example = structureExampleId(checklistNode(answer.item, answer.node), answer.example)
  const node = graph.nodes[answer.node]
  if (node?.type === 'MOST_OFTEN' && answer.value !== 'MAYBE') {
    mapped.value = structureExampleId(checklistNode(answer.item, node.source), answer.value)
  }
  return mapped
}

export type StepView =
  | { kind: 'PROMPT'; node: string; text: string; note: string }
  | { kind: 'YES_NO'; node: string; text: string; allowMaybe: boolean; maybeLabel: string }
  /** After value MAYBE; `example` (position id) when the "maybe" was given on an example row. */
  | { kind: 'MAYBE_RESOLVE'; node: string; text: string; example?: string }
  | {
      kind: 'EXAMPLE'
      node: string
      stem: string
      /** Position id ("e" + index + 1). */
      example: string
      text: string
      isOther: boolean
      /** 0-based position in the checklist. */
      index: number
      count: number
      otherPlaceholder: string | null
      allowMaybe: boolean
      maybeLabel: string
    }
  | { kind: 'MOST_OFTEN'; node: string; text: string; options: Array<{ example: string; text: string }> }
  | { kind: 'CHOICE'; node: string; text: string; options: Array<{ option: string; text: string }> }

function stepView(item: number, pos: StepPosition, content: McHatContentFile): StepView {
  const itemContent = content.followUp[String(item)]
  const nodes = (pos.supplementary ? itemContent.supplementary : itemContent.nodes) ?? {}
  const node = nodes[pos.node]
  switch (pos.kind) {
    case 'PROMPT': {
      const c = node as PromptContent
      return { kind: 'PROMPT', node: pos.node, text: c.text, note: c.note }
    }
    case 'YES_NO':
      return { kind: 'YES_NO', node: pos.node, text: (node as TextContent).text, allowMaybe: true, maybeLabel: content.ui.maybe }
    case 'EXAMPLE': {
      const c = node as ChecklistContent
      return {
        kind: 'EXAMPLE',
        node: pos.node,
        stem: c.stem,
        example: examplePositionId(pos.index),
        text: c.examples[pos.example],
        isOther: pos.isOther,
        index: pos.index,
        count: pos.count,
        otherPlaceholder: pos.isOther ? content.ui.otherDescribe : null,
        allowMaybe: true,
        maybeLabel: content.ui.maybe,
      }
    }
    case 'MOST_OFTEN': {
      const structure = followUpItem(item).nodes[pos.node]
      const sourceId = structure.type === 'MOST_OFTEN' ? structure.source : ''
      const list = checklistNode(item, sourceId)
      const source = itemContent.nodes[sourceId] as ChecklistContent | undefined
      return {
        kind: 'MOST_OFTEN',
        node: pos.node,
        text: (node as TextContent).text,
        options: pos.options.map((example) => ({
          example: examplePositionId(list ? list.examples.findIndex((e) => e.id === example) : -1),
          text: source?.examples[example] ?? '',
        })),
      }
    }
    case 'CHOICE': {
      const c = node as ChoiceContent
      return {
        kind: 'CHOICE',
        node: pos.node,
        text: c.text,
        options: pos.options.map((option) => ({ option, text: c.options[option] })),
      }
    }
  }
}

/** The yes/no question or example row (structure ids) a "maybe" was given on. */
export type MaybeAt = { node: string; example?: string }

function isMaybeAt(pos: StepPosition, maybe: MaybeAt | undefined): boolean {
  if (!maybe || pos.node !== maybe.node) return false
  if (pos.kind === 'YES_NO') return maybe.example === undefined
  return pos.kind === 'EXAMPLE' && pos.example === maybe.example
}

/**
 * GET/POST /api/questionnaire-responses/:id/follow-up…: the item list and the
 * current question. `maybe` turns the current yes/no question or example row
 * into its "most often yes or no?" resolution (nothing is recorded for a
 * "maybe"). Per-item scores and review flags are output only once the
 * Follow-Up is COMPLETED, so a parent cannot see mid-way how an item ended.
 */
export function serializeFollowUpState(
  row: QuestionnaireResponse,
  answers: FollowUpAnswers,
  content: McHatContentFile,
  options: SerializeResponseOptions & { maybe?: MaybeAt } = {},
) {
  const status = row.followUpStatus as FollowUpStatus
  const progress = followUpProgress(answers)
  const completed = status === 'COMPLETED'
  const stillFailing = new Set(row.followUpFailedItems)

  const items = progress.items.map((p) => ({
    item: p.item,
    state: completed ? ('DONE' as const) : p.state,
    score: completed ? ((stillFailing.has(p.item) ? 1 : 0) as 0 | 1) : null,
    needsReview: completed ? p.needsReview : false,
  }))

  let current: {
    item: number
    itemIndex: number
    itemCount: number
    header: string
    recap: string
    preamble: string | null
    canGoBack: boolean
    step: StepView
  } | null = null

  if (status === 'PENDING' && progress.currentIndex !== null) {
    const index = progress.currentIndex
    const p = progress.items[index]
    const pos = p.position!
    const itemContent = content.followUp[String(p.item)]
    const preamble = preamblesFor(answers, index)
      .map((id) => itemContent.preambles?.[id])
      .find((text): text is string => typeof text === 'string')
    current = {
      item: p.item,
      itemIndex: index,
      itemCount: answers.order.length,
      header: itemContent.header,
      recap: itemContent.recap,
      preamble: preamble ?? null,
      canGoBack: progress.stepCount > 0,
      step: isMaybeAt(pos, options.maybe)
        ? {
            kind: 'MAYBE_RESOLVE',
            node: pos.node,
            text: content.ui.maybePrompt,
            ...(pos.kind === 'EXAMPLE' ? { example: examplePositionId(pos.index) } : {}),
          }
        : stepView(p.item, pos, content),
    }
  }

  const { maybe: _maybe, ...responseOptions } = options
  return {
    responseId: row.id,
    status,
    ...copyrightLines(content),
    items,
    current,
    ...(completed ? { response: serializeQuestionnaireResponse(row, responseOptions) } : {}),
  }
}

export type FollowUpStateDto = ReturnType<typeof serializeFollowUpState>
