/**
 * In-app M-CHAT-R/F Follow-Up: a pure path-replay state machine over the
 * graphs in mchatRfStructure.ts. Nothing here knows any wording.
 *
 * Per item the only state is the recorded path (node ids + answers). The
 * position, the score and the review flag are always recomputed by replaying
 * that path from the entry node, so a stored path is auditable and a client
 * that is out of date gets a StepMismatchError instead of a wrong record.
 */
import {
  STRUCTURE_VERSION,
  followUpItem,
  structureHash,
  type ChecklistNode,
  type ChecklistRoute,
  type Example,
  type FollowUpItemStructure,
  type Score,
  type Target,
} from './mchatRfStructure'

export const OTHER_TEXT_MAX = 200

export type YesNo = 'YES' | 'NO'

/** One recorded answer. value: YES/NO, ACK (prompt), or an example/option id. */
export type Step = { node: string; example?: string; value: string; maybe?: true; otherText?: string }

/** What a client sends for the current position. */
export type StepAnswer = { node: string; example?: string; value: string; maybe?: boolean; otherText?: string }

/** A question of one item. `index` is 0-based within the checklist; options keep the structure order. */
export type Position =
  | { kind: 'PROMPT'; node: string; supplementary: boolean }
  | { kind: 'YES_NO'; node: string; supplementary: boolean }
  | { kind: 'EXAMPLE'; node: string; supplementary: boolean; example: string; isOther: boolean; index: number; count: number }
  | { kind: 'MOST_OFTEN'; node: string; supplementary: boolean; options: string[] }
  | { kind: 'CHOICE'; node: string; supplementary: boolean; options: string[] }

/** The next question plus what is known so far (score is set while item 2's supplementary runs). */
export type StepPosition = Position & { done: false; score: Score | null; needsReview: boolean }

export type ItemDone = { done: true; score: Score; needsReview: boolean }

export class StepMismatchError extends Error {
  constructor(readonly reason: string) {
    super(`Follow-Up step mismatch: ${reason}`)
    this.name = 'StepMismatchError'
  }
}

export class NothingToUndoError extends Error {
  constructor() {
    super('No recorded Follow-Up step to undo.')
    this.name = 'NothingToUndoError'
  }
}

// ---------------------------------------------------------------------------
// One item
// ---------------------------------------------------------------------------

function sameTarget(a: Target, b: Target): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** Route of a checklist given the endorsed examples that count. */
export function routeChecklist(route: ChecklistRoute, endorsed: readonly Example[]): Target {
  switch (route.kind) {
    case 'ANY_YES':
      return endorsed.length > 0 ? route.anyYes : route.noneYes
    case 'COUNT_YES': {
      const n = endorsed.length
      const band = route.bands.find((b) => n >= b.min && (b.max === null || n <= b.max))
      if (!band) throw new RangeError(`No count band for ${n}`)
      return band.to
    }
    case 'PASS_FAIL_SPLIT': {
      const pass = endorsed.some((e) => e.group === 'PASS')
      const fail = endorsed.some((e) => e.group === 'FAIL')
      if (pass && fail) return { goto: route.both }
      return pass ? route.passOnly : route.failOnlyOrNone
    }
    case 'FAIL_GROUP_ANY':
      return endorsed.some((e) => e.group === 'FAIL') ? route.anyFail : route.noFail
  }
}

function isYesNo(value: unknown): value is YesNo {
  return value === 'YES' || value === 'NO'
}

/**
 * Every yes/no point of the Follow-Up takes a "maybe" ("most often yes or
 * no?" → that branch): the yes/no questions and each checklist example row.
 */
function isMaybeKind(kind: Position['kind']): boolean {
  return kind === 'YES_NO' || kind === 'EXAMPLE'
}

/** Checks an answer against a position and returns the step to record. */
function toStep(pos: Position, answer: StepAnswer): Step {
  if (answer.node !== pos.node) throw new StepMismatchError(`expected node ${pos.node}`)
  const exampleGiven = answer.example !== undefined
  const maybe = answer.maybe === true
  const otherText = typeof answer.otherText === 'string' ? answer.otherText.trim() : ''
  if (pos.kind !== 'EXAMPLE' && exampleGiven) throw new StepMismatchError('unexpected example')
  if (!isMaybeKind(pos.kind) && maybe) throw new StepMismatchError('maybe is only for yes/no questions')
  if (otherText && !(pos.kind === 'EXAMPLE' && pos.isOther)) throw new StepMismatchError('otherText is only for an Other row')

  switch (pos.kind) {
    case 'PROMPT':
      if (answer.value !== 'ACK') throw new StepMismatchError('expected ACK')
      return { node: pos.node, value: 'ACK' }
    case 'YES_NO':
      if (!isYesNo(answer.value)) throw new StepMismatchError('expected YES or NO')
      return maybe ? { node: pos.node, value: answer.value, maybe: true } : { node: pos.node, value: answer.value }
    case 'EXAMPLE': {
      if (answer.example !== pos.example) throw new StepMismatchError(`expected example ${pos.example}`)
      if (!isYesNo(answer.value)) throw new StepMismatchError('expected YES or NO')
      if (otherText.length > OTHER_TEXT_MAX) throw new StepMismatchError('otherText too long')
      const step: Step = maybe
        ? { node: pos.node, example: pos.example, value: answer.value, maybe: true }
        : { node: pos.node, example: pos.example, value: answer.value }
      // The description only matters for an endorsed row.
      if (pos.isOther && answer.value === 'YES' && otherText) step.otherText = otherText
      return step
    }
    case 'MOST_OFTEN':
    case 'CHOICE':
      if (!pos.options.includes(answer.value)) throw new StepMismatchError('unknown option')
      return { node: pos.node, value: answer.value }
  }
}

type Replay = { result: StepPosition | ItemDone; steps: Step[] }

/** Replays `path` from the entry node; throws StepMismatchError on an invalid path. */
function replay(item: number, path: readonly StepAnswer[]): Replay {
  const graph: FollowUpItemStructure = followUpItem(item)
  const steps: Step[] = []
  let cursor = 0
  let score: Score | null = null
  let needsReview = false
  let supplementary = false
  let nodeId = graph.entry
  /** Checklist node → endorsed examples that count (for MOST_OFTEN). */
  const endorsed = new Map<string, Example[]>()

  const at = (pos: Position): StepPosition | null => {
    if (cursor === path.length) return { ...pos, done: false, score, needsReview } as StepPosition
    steps.push(toStep(pos, path[cursor]))
    cursor += 1
    return null
  }

  // Graphs are acyclic (tested), so this terminates; the bound is a guard.
  for (let guard = 0; guard < 200; guard++) {
    const nodes = supplementary ? graph.supplementary!.nodes : graph.nodes
    const node = nodes[nodeId]
    if (!node) throw new RangeError(`Item ${item}: unknown node ${nodeId}`)
    let target: Target

    switch (node.type) {
      case 'PROMPT': {
        const stop = at({ kind: 'PROMPT', node: nodeId, supplementary })
        if (stop) return { result: stop, steps }
        target = { goto: node.next }
        break
      }
      case 'YES_NO': {
        const stop = at({ kind: 'YES_NO', node: nodeId, supplementary })
        if (stop) return { result: stop, steps }
        target = steps[steps.length - 1].value === 'YES' ? node.yes : node.no
        break
      }
      case 'CHOICE': {
        const stop = at({ kind: 'CHOICE', node: nodeId, supplementary, options: node.options.map((o) => o.id) })
        if (stop) return { result: stop, steps }
        const chosen = steps[steps.length - 1].value
        target = node.options.find((o) => o.id === chosen)!.to
        break
      }
      case 'CHECKLIST': {
        const list: ChecklistNode = node
        const yes: Example[] = []
        for (const [index, example] of list.examples.entries()) {
          if (list.askMode === 'UNTIL_FIRST_YES' && yes.length > 0) break
          const stop = at({
            kind: 'EXAMPLE',
            node: nodeId,
            supplementary,
            example: example.id,
            isOther: example.isOther,
            index,
            count: list.examples.length,
          })
          if (stop) return { result: stop, steps }
          if (steps[steps.length - 1].value === 'YES') yes.push(example)
        }
        // An endorsed "Other" row is counted or not per the list's policy (always
        // the route that does not hide a possible 1); the item is flagged when
        // the other choice would have changed the route.
        const withoutOther = yes.filter((e) => !e.isOther)
        const counted = list.otherPolicy === 'COUNTED_REVIEW' ? yes : withoutOther
        const alternative = list.otherPolicy === 'COUNTED_REVIEW' ? withoutOther : yes
        target = routeChecklist(list.route, counted)
        if (withoutOther.length !== yes.length && !sameTarget(routeChecklist(list.route, alternative), target)) {
          needsReview = true
        }
        endorsed.set(nodeId, counted)
        break
      }
      case 'MOST_OFTEN': {
        const options = endorsed.get(node.source) ?? []
        const stop = at({ kind: 'MOST_OFTEN', node: nodeId, supplementary, options: options.map((e) => e.id) })
        if (stop) return { result: stop, steps }
        const chosen = options.find((e) => e.id === steps[steps.length - 1].value)!
        target = chosen.group === 'PASS' ? node.pass : node.fail
        break
      }
    }

    if ('goto' in target) {
      nodeId = target.goto
    } else if ('score' in target) {
      if (supplementary) throw new RangeError(`Item ${item}: a supplementary node cannot score`)
      score = target.score
      if (!graph.supplementary) break
      supplementary = true
      nodeId = graph.supplementary.entry
    } else {
      if (!supplementary) throw new RangeError(`Item ${item}: end outside the supplementary graph`)
      break
    }
  }

  if (score === null) throw new RangeError(`Item ${item}: graph did not terminate`)
  if (cursor !== path.length) throw new StepMismatchError('the item has already ended')
  return { result: { done: true, score, needsReview }, steps }
}

/** Where `path` leaves the item: the next question, or the item's score. */
export function currentStep(item: number, path: readonly StepAnswer[]): StepPosition | ItemDone {
  return replay(item, path).result
}

/** Records `answer` at the current position; throws StepMismatchError when it does not fit. */
export function applyAnswer(item: number, path: readonly Step[], answer: StepAnswer): Step[] {
  const { result, steps } = replay(item, path)
  if (result.done) throw new StepMismatchError('the item has already ended')
  return [...steps, toStep(result, answer)]
}

// ---------------------------------------------------------------------------
// The whole Follow-Up of one response (stored in QuestionnaireResponse.followUpAnswers)
// ---------------------------------------------------------------------------

export type FollowUpItemRecord = { path: Step[]; score?: Score; needsReview?: boolean }

export type FollowUpAnswers = {
  engine: typeof STRUCTURE_VERSION
  structureHash: string
  /** Stage-1 items that scored 1, ascending: the items to go through. */
  order: number[]
  /** Keyed by item number; `score`/`needsReview` are written for the audit trail once the item is done. */
  items: Record<string, FollowUpItemRecord>
}

export type ItemProgress = {
  item: number
  state: 'TODO' | 'IN_PROGRESS' | 'DONE'
  score: Score | null
  needsReview: boolean
  path: Step[]
  /** Next question of this item; null once done. */
  position: StepPosition | null
}

export type FollowUpProgress = {
  items: ItemProgress[]
  /** Index in `order` of the item being answered; null when every item is done. */
  currentIndex: number | null
  complete: boolean
  /** Items scoring 1 (complete only). */
  stillFailing: number[]
  reviewItems: number[]
  stepCount: number
}

export function initFollowUpAnswers(failedItems: readonly number[]): FollowUpAnswers {
  return {
    engine: STRUCTURE_VERSION,
    structureHash: structureHash(),
    order: [...new Set(failedItems)].sort((a, b) => a - b),
    items: {},
  }
}

function pathOf(answers: FollowUpAnswers, item: number): Step[] {
  return answers.items[String(item)]?.path ?? []
}

export function followUpProgress(answers: FollowUpAnswers): FollowUpProgress {
  const items: ItemProgress[] = []
  let currentIndex: number | null = null
  let stepCount = 0
  answers.order.forEach((item, index) => {
    const path = pathOf(answers, item)
    stepCount += path.length
    if (currentIndex !== null && path.length > 0) throw new StepMismatchError(`item ${item} answered out of order`)
    const result = currentStep(item, path)
    if (!result.done && currentIndex === null) currentIndex = index
    items.push({
      item,
      state: result.done ? 'DONE' : path.length > 0 ? 'IN_PROGRESS' : 'TODO',
      score: result.done ? result.score : null,
      needsReview: result.needsReview,
      path,
      position: result.done ? null : result,
    })
  })
  const complete = currentIndex === null
  return {
    items,
    currentIndex,
    complete,
    stillFailing: complete ? items.filter((i) => i.score === 1).map((i) => i.item) : [],
    reviewItems: items.filter((i) => i.needsReview).map((i) => i.item),
    stepCount,
  }
}

/** Rewrites the per-item audit fields from the paths. */
function withDerived(answers: FollowUpAnswers): FollowUpAnswers {
  const progress = followUpProgress(answers)
  const items: Record<string, FollowUpItemRecord> = {}
  for (const p of progress.items) {
    if (p.path.length === 0) continue
    items[String(p.item)] = p.state === 'DONE' ? { path: p.path, score: p.score!, needsReview: p.needsReview } : { path: p.path }
  }
  return { ...answers, items }
}

function currentItemOrThrow(answers: FollowUpAnswers, item: number): ItemProgress {
  const progress = followUpProgress(answers)
  if (progress.currentIndex === null) throw new StepMismatchError('the Follow-Up is already complete')
  const current = progress.items[progress.currentIndex]
  if (current.item !== item) throw new StepMismatchError(`expected item ${current.item}`)
  return current
}

/** Records one answer for the current item. */
export function applyFollowUpAnswer(answers: FollowUpAnswers, answer: StepAnswer & { item: number }): FollowUpAnswers {
  const current = currentItemOrThrow(answers, answer.item)
  const { item: _item, ...stepAnswer } = answer
  const path = applyAnswer(current.item, current.path, stepAnswer)
  return withDerived({ ...answers, items: { ...answers.items, [String(current.item)]: { path } } })
}

/**
 * A "maybe" is resolved by the client first; this only checks it is asked at
 * the current yes/no question or example row (`example` = structure id).
 */
export function assertMaybeAllowed(answers: FollowUpAnswers, item: number, node: string, example?: string): StepPosition {
  const current = currentItemOrThrow(answers, item)
  const pos = current.position!
  if (pos.node !== node) throw new StepMismatchError(`expected node ${pos.node}`)
  if (!isMaybeKind(pos.kind)) throw new StepMismatchError('maybe is only for yes/no questions')
  if (pos.kind === 'EXAMPLE' ? example !== pos.example : example !== undefined) {
    throw new StepMismatchError(pos.kind === 'EXAMPLE' ? `expected example ${pos.example}` : 'unexpected example')
  }
  return pos
}

/**
 * Removes the last recorded step of the current item; when the current item
 * has none, re-opens the previous item and removes its last step.
 */
export function undoFollowUpStep(answers: FollowUpAnswers): FollowUpAnswers {
  const progress = followUpProgress(answers)
  let index = progress.currentIndex ?? answers.order.length - 1
  if (index >= 0 && pathOf(answers, answers.order[index]).length === 0) index -= 1
  if (index < 0) throw new NothingToUndoError()
  const item = answers.order[index]
  const path = pathOf(answers, item)
  if (path.length === 0) throw new NothingToUndoError()
  const items = { ...answers.items, [String(item)]: { path: path.slice(0, -1) } }
  if (path.length === 1) delete items[String(item)]
  return withDerived({ ...answers, items })
}

/** Preamble ids to show with the item at `index` (item 7 right after item 6). */
export function preamblesFor(answers: FollowUpAnswers, index: number): string[] {
  const graph = followUpItem(answers.order[index])
  const previous = index > 0 ? answers.order[index - 1] : null
  return graph.preambles.filter((p) => p.whenFollowUpJustAdministered === previous).map((p) => p.id)
}

function isStepLike(value: unknown): value is Step {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const s = value as Record<string, unknown>
  return (
    typeof s.node === 'string' &&
    typeof s.value === 'string' &&
    (s.example === undefined || typeof s.example === 'string') &&
    (s.maybe === undefined || s.maybe === true) &&
    (s.otherText === undefined || typeof s.otherText === 'string')
  )
}

/**
 * Reads the stored JSON. Returns null when it is absent or unusable for the
 * current structure (other engine/hash, other item list, invalid paths): the
 * caller then starts from initFollowUpAnswers(failedItems).
 */
export function parseFollowUpAnswers(raw: unknown, failedItems: readonly number[]): FollowUpAnswers | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  if (r.engine !== STRUCTURE_VERSION || r.structureHash !== structureHash()) return null
  const expected = initFollowUpAnswers(failedItems).order
  if (!Array.isArray(r.order) || r.order.length !== expected.length || r.order.some((n, i) => n !== expected[i])) return null
  if (!r.items || typeof r.items !== 'object' || Array.isArray(r.items)) return null
  const items: Record<string, FollowUpItemRecord> = {}
  for (const [key, record] of Object.entries(r.items as Record<string, unknown>)) {
    if (!expected.includes(Number(key)) || String(Number(key)) !== key) return null
    const path = (record as { path?: unknown } | null)?.path
    if (!Array.isArray(path) || !path.every(isStepLike)) return null
    items[key] = { path: path.map((s) => ({ ...s })) }
  }
  const answers: FollowUpAnswers = { engine: STRUCTURE_VERSION, structureHash: structureHash(), order: expected, items }
  try {
    return withDerived(answers)
  } catch (error) {
    if (error instanceof StepMismatchError) return null
    throw error
  }
}
