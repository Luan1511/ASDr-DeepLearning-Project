/**
 * Routing skeleton of M-CHAT-R/F (March 2025 form): the 20 stage-1 items and
 * the 20 Follow-Up flowcharts, as ids, node types and routes only.
 *
 * No wording lives here. The licensed text comes from a separate content file
 * (mchatContent.ts) keyed by these ids, and that file can never change the
 * routing: it must carry structureHash() of this constant.
 *
 * Ids: item pages are numbered 1..20; node ids are local to the item;
 * examples are p… (pass-type, "0 examples"), f… (fail-type, "1 examples"),
 * n… (neutral, routed by yes-to-any or by a count); a trailing "o" marks the
 * "Other (describe)" row.
 */
import { createHash } from 'crypto'
import { MCHAT_RF } from './mchatRf'

export const STRUCTURE_VERSION = 'mchat-rf-2025-03'

export type Score = 0 | 1
/** `end` is only valid inside an unscored supplementary graph. */
export type Target = { goto: string } | { score: Score } | { end: true }
export type ExampleGroup = 'PASS' | 'FAIL' | 'NEUTRAL'

export type Example = { id: string; group: ExampleGroup; isOther: boolean }

export type Threshold = {
  count: number
  /** HALF_OF_OCCASIONS: `count` halves of the occasions (1 = half). */
  per: 'WEEK' | 'DAY' | 'HALF_OF_OCCASIONS'
  /** true = "at least", false = "more than". */
  inclusive: boolean
}

/**
 * Open question; acknowledged, never scored. Its content has a `text` and a
 * `note` (the interviewer note under the prompt). Most official pages carry
 * such a note but not necessarily all, so the content file may leave `note`
 * empty where the licensed page has none (mchatContent.ts).
 */
export type PromptNode = {
  type: 'PROMPT'
  next: string
}

export type YesNoNode = {
  type: 'YES_NO'
  role: 'QUESTION' | 'PROBE' | 'FREQUENCY'
  threshold: Threshold | null
  /** "Maybe" → "most often yes or no?" → continue down that branch. */
  allowMaybe: true
  yes: Target
  no: Target
}

export type ChoiceNode = { type: 'CHOICE'; options: Array<{ id: string; to: Target }> }

export type CountBand = { min: number; max: number | null; to: Target }

export type ChecklistRoute =
  | { kind: 'ANY_YES'; anyYes: Target; noneYes: Target }
  | { kind: 'COUNT_YES'; bands: CountBand[] }
  /** Yes only to PASS → passOnly; to FAIL only or to none → failOnlyOrNone; to both → `both` (a MOST_OFTEN node). */
  | { kind: 'PASS_FAIL_SPLIT'; passOnly: Target; failOnlyOrNone: Target; both: string }
  /** Item 5: only the FAIL list routes; the PASS list never changes the score. */
  | { kind: 'FAIL_GROUP_ANY'; anyFail: Target; noFail: Target }

/**
 * What an endorsed "Other (describe)" row does to the routing. A program
 * cannot judge the description, so each list takes the route that does not
 * hide a possible 1 (sensitivity first), and the item is flagged for review
 * by a health worker whenever the other choice would have changed the route:
 *
 * - NOT_COUNTED_REVIEW: the row is not counted. Used where counting it leans
 *   toward 0: the pass-type lists of items 3, 9, 17 and 20 (yes to any → 0 or
 *   → a question that can end in 0) and item 15's count list (2+ → 0).
 * - COUNTED_REVIEW: the row is counted. Used where counting it leans toward
 *   1: item 5's fail-type list (any → the frequency question, else 0) and
 *   item 12's count list (2+ → the second list, else 0). Not counting it
 *   there would end the item at 0 without asking what decides a 1.
 */
export type OtherPolicy = 'NOT_COUNTED_REVIEW' | 'COUNTED_REVIEW'

export type ChecklistNode = {
  type: 'CHECKLIST'
  examples: Example[]
  askMode: 'EACH' | 'UNTIL_FIRST_YES'
  otherPolicy: OtherPolicy | null
  route: ChecklistRoute
}

/** Lists the endorsed examples of `source` (both groups); the answer's group decides. */
export type MostOftenNode = { type: 'MOST_OFTEN'; source: string; pass: Target; fail: Target }

export type FollowUpNode = PromptNode | YesNoNode | ChoiceNode | ChecklistNode | MostOftenNode
export type FollowUpNodeType = FollowUpNode['type']

export type Preamble = { id: 'after6'; whenFollowUpJustAdministered: number }

export type FollowUpItemStructure = {
  item: number
  entry: string
  nodes: Record<string, FollowUpNode>
  /** Asked after the score; never changes it (item 2). */
  supplementary: { entry: string; nodes: Record<string, FollowUpNode>; scored: false } | null
  preambles: Preamble[]
}

export type Stage1ItemStructure = {
  number: number
  /** The answer that scores 1 (an unanswered item also counts as elevated). */
  elevatedOn: 'YES' | 'NO'
  /** The official item text carries inline examples. */
  hasExamples: boolean
}

export type McHatRfStructure = {
  instrument: 'MCHAT_RF'
  structureVersion: typeof STRUCTURE_VERSION
  stage1: Stage1ItemStructure[]
  followUp: FollowUpItemStructure[]
}

// ---------------------------------------------------------------------------
// Builders (keep the table below readable)
// ---------------------------------------------------------------------------

const S0: Target = { score: 0 }
const S1: Target = { score: 1 }
const END: Target = { end: true }
const go = (node: string): Target => ({ goto: node })

function examples(group: ExampleGroup, prefix: string, count: number, withOther = false): Example[] {
  const list: Example[] = Array.from({ length: count }, (_, i) => ({ id: `${prefix}${i + 1}`, group, isOther: false }))
  if (withOther) list.push({ id: `${prefix}${count + 1}o`, group, isOther: true })
  return list
}

/** `otherPolicy` applies only when the list has an Other row (see OtherPolicy). */
function checklist(
  list: Example[],
  route: ChecklistRoute,
  askMode: ChecklistNode['askMode'] = 'EACH',
  otherPolicy: OtherPolicy = 'NOT_COUNTED_REVIEW',
): ChecklistNode {
  return {
    type: 'CHECKLIST',
    examples: list,
    askMode,
    otherPolicy: list.some((e) => e.isOther) ? otherPolicy : null,
    route,
  }
}

const prompt = (next: string): PromptNode => ({ type: 'PROMPT', next })

function yesNo(yes: Target, no: Target, role: YesNoNode['role'] = 'QUESTION', threshold: Threshold | null = null): YesNoNode {
  return { type: 'YES_NO', role, threshold, allowMaybe: true, yes, no }
}

const anyYes = (yes: Target, none: Target): ChecklistRoute => ({ kind: 'ANY_YES', anyYes: yes, noneYes: none })

/** prompt → cl (standard split) → mo: items 1, 10, 11, 16. */
function standardSplitItem(item: number, pass: number, fail: number): FollowUpItemStructure {
  return {
    item,
    entry: 'prompt',
    nodes: {
      prompt: prompt('cl'),
      cl: checklist([...examples('PASS', 'p', pass), ...examples('FAIL', 'f', fail)], {
        kind: 'PASS_FAIL_SPLIT',
        passOnly: S0,
        failOnlyOrNone: S1,
        both: 'mo',
      }),
      mo: { type: 'MOST_OFTEN', source: 'cl', pass: S0, fail: S1 },
    },
    supplementary: null,
    preambles: [],
  }
}

/** prompt → one checklist routed by yes-to-any. */
function anyYesItem(item: number, list: Example[], yes: Target, none: Target, extra: Record<string, FollowUpNode> = {}) {
  return {
    item,
    entry: 'prompt',
    nodes: { prompt: prompt('cl'), cl: checklist(list, anyYes(yes, none)), ...extra },
    supplementary: null,
    preambles: [],
  } satisfies FollowUpItemStructure
}

// ---------------------------------------------------------------------------
// The 2025 graphs (mchat_structure.md §2 and §4)
// ---------------------------------------------------------------------------

const FOLLOW_UP: FollowUpItemStructure[] = [
  // 1: prompt → split P4/F3 → most often
  standardSplitItem(1, 4, 3),
  // 2: two fail-type examples, yes to either → 1; then an unscored supplementary.
  {
    item: 2,
    entry: 'cl',
    nodes: { cl: checklist(examples('FAIL', 'f', 2), anyYes(S1, S0)) },
    supplementary: {
      entry: 's1',
      scored: false,
      nodes: {
        s1: yesNo(go('s2'), END),
        s2: {
          type: 'CHOICE',
          options: [
            { id: 'r1', to: END },
            { id: 'r2', to: END },
            { id: 'r3', to: END },
          ],
        },
      },
    },
    preambles: [],
  },
  // 3: 10 pass-type + Other, any → 0
  anyYesItem(3, examples('PASS', 'p', 10, true), S0, S1),
  // 4: 4 pass-type, any → 0
  anyYesItem(4, examples('PASS', 'p', 4), S0, S1),
  // 5: P list does not route; any F (4 + Other) → frequency (> 2 / week): yes → 1, no → 0.
  // The Other row is counted: it sits in the list that leads toward 1.
  {
    item: 5,
    entry: 'prompt',
    nodes: {
      prompt: prompt('cl'),
      cl: checklist(
        [...examples('PASS', 'p', 2), ...examples('FAIL', 'f', 4, true)],
        { kind: 'FAIL_GROUP_ANY', anyFail: go('freq'), noFail: S0 },
        'EACH',
        'COUNTED_REVIEW',
      ),
      freq: yesNo(S1, S0, 'FREQUENCY', { count: 2, per: 'WEEK', inclusive: false }),
    },
    supplementary: null,
    preambles: [],
  },
  // 6: 4 neutral, any → probe (yes → 0, no → 1); none → 1
  anyYesItem(6, examples('NEUTRAL', 'n', 4), go('q1'), S1, { q1: yesNo(S0, S1, 'PROBE') }),
  // 7: optional preamble after item 6; 4 neutral, any → q1 (yes → q2, no → 1); q2 choice
  {
    item: 7,
    entry: 'prompt',
    nodes: {
      prompt: prompt('cl'),
      cl: checklist(examples('NEUTRAL', 'n', 4), anyYes(go('q1'), S1)),
      q1: yesNo(go('q2'), S1),
      q2: {
        type: 'CHOICE',
        options: [
          { id: 'optA', to: S0 },
          { id: 'optBoth', to: S0 },
          { id: 'optB', to: S1 },
        ],
      },
    },
    supplementary: null,
    preambles: [{ id: 'after6', whenFollowUpJustAdministered: 6 }],
  },
  // 8: q1 (yes → 0) → q2 (no → 1) → prompt → 7 pass-type → frequency (> half of occasions)
  {
    item: 8,
    entry: 'q1',
    nodes: {
      q1: yesNo(S0, go('q2')),
      q2: yesNo(go('prompt'), S1),
      prompt: prompt('cl'),
      cl: checklist(examples('PASS', 'p', 7), anyYes(go('freq'), S1)),
      freq: yesNo(S0, S1, 'FREQUENCY', { count: 1, per: 'HALF_OF_OCCASIONS', inclusive: false }),
    },
    supplementary: null,
    preambles: [],
  },
  // 9: 5 pass-type + Other, any → q1 (yes → 0, no → 1); none → 1
  anyYesItem(9, examples('PASS', 'p', 5, true), go('q1'), S1, { q1: yesNo(S0, S1) }),
  // 10, 11: standard split
  standardSplitItem(10, 3, 4),
  standardSplitItem(11, 3, 3),
  // 12: count list (9 + Other): 0–1 → 0; 2+ → prompt → split P2/F3 → most often.
  // The Other row is counted: 2+ leads to the list that can score 1.
  {
    item: 12,
    entry: 'cnt',
    nodes: {
      cnt: checklist(
        examples('NEUTRAL', 'n', 9, true),
        {
          kind: 'COUNT_YES',
          bands: [
            { min: 0, max: 1, to: S0 },
            { min: 2, max: null, to: go('prompt') },
          ],
        },
        'EACH',
        'COUNTED_REVIEW',
      ),
      prompt: prompt('cl'),
      cl: checklist([...examples('PASS', 'p', 2), ...examples('FAIL', 'f', 3)], {
        kind: 'PASS_FAIL_SPLIT',
        passOnly: S0,
        failOnlyOrNone: S1,
        both: 'mo',
      }),
      mo: { type: 'MOST_OFTEN', source: 'cl', pass: S0, fail: S1 },
    },
    supplementary: null,
    preambles: [],
  },
  // 13: a single probe
  { item: 13, entry: 'q1', nodes: { q1: yesNo(S0, S1, 'PROBE') }, supplementary: null, preambles: [] },
  // 14: count list of 6: none → 1, exactly 1 → f1 (≥ 1/day) → f2 (≥ 5/day); 2+ → 0
  {
    item: 14,
    entry: 'prompt',
    nodes: {
      prompt: prompt('cnt'),
      cnt: checklist(examples('NEUTRAL', 'n', 6), {
        kind: 'COUNT_YES',
        bands: [
          { min: 0, max: 0, to: S1 },
          { min: 1, max: 1, to: go('f1') },
          { min: 2, max: null, to: S0 },
        ],
      }),
      f1: yesNo(go('f2'), S1, 'FREQUENCY', { count: 1, per: 'DAY', inclusive: true }),
      f2: yesNo(S0, S1, 'FREQUENCY', { count: 5, per: 'DAY', inclusive: true }),
    },
    supplementary: null,
    preambles: [],
  },
  // 15: count list (6 + Other): 0–1 → 1, 2+ → 0
  {
    item: 15,
    entry: 'prompt',
    nodes: {
      prompt: prompt('cnt'),
      cnt: checklist(examples('NEUTRAL', 'n', 6, true), {
        kind: 'COUNT_YES',
        bands: [
          { min: 0, max: 1, to: S1 },
          { min: 2, max: null, to: S0 },
        ],
      }),
    },
    supplementary: null,
    preambles: [],
  },
  // 16: standard split
  standardSplitItem(16, 3, 2),
  // 17: 4 pass-type + Other, any → 0
  anyYesItem(17, examples('PASS', 'p', 4, true), S0, S1),
  // 18: q1 (yes → cl) → q2 (yes → cl, no → 1); 3 ordered examples, stop at the first yes
  {
    item: 18,
    entry: 'q1',
    nodes: {
      q1: yesNo(go('cl'), go('q2')),
      q2: yesNo(go('cl'), S1),
      cl: checklist(examples('NEUTRAL', 'n', 3), anyYes(S0, S1), 'UNTIL_FIRST_YES'),
    },
    supplementary: null,
    preambles: [],
  },
  // 19: three questions, any yes → 0
  {
    item: 19,
    entry: 'q1',
    nodes: { q1: yesNo(S0, go('q2')), q2: yesNo(S0, go('q3')), q3: yesNo(S0, S1) },
    supplementary: null,
    preambles: [],
  },
  // 20: 3 pass-type + Other, any → 0 (Other only when judged positive → review)
  anyYesItem(20, examples('PASS', 'p', 3, true), S0, S1),
]

const ELEVATED_ON_YES: ReadonlySet<number> = new Set(MCHAT_RF.elevatedOnYes)
// Items printed without an example parenthetical on the official form.
const WITHOUT_EXAMPLES: ReadonlySet<number> = new Set([2, 11, 13, 14, 16])

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v)
  }
  return value
}

export const MCHAT_RF_STRUCTURE: Readonly<McHatRfStructure> = deepFreeze({
  instrument: 'MCHAT_RF',
  structureVersion: STRUCTURE_VERSION,
  stage1: Array.from({ length: MCHAT_RF.itemCount }, (_, i) => ({
    number: i + 1,
    elevatedOn: ELEVATED_ON_YES.has(i + 1) ? ('YES' as const) : ('NO' as const),
    hasExamples: !WITHOUT_EXAMPLES.has(i + 1),
  })),
  followUp: FOLLOW_UP,
})

/** Follow-Up graph of one item (1..20). */
export function followUpItem(item: number): FollowUpItemStructure {
  const found = MCHAT_RF_STRUCTURE.followUp.find((f) => f.item === item)
  if (!found) throw new RangeError(`No Follow-Up page for item ${item}`)
  return found
}

/** JSON with object keys sorted at every level (arrays keep their order). */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

let cachedHash: string | null = null

/** sha256 of the canonical structure JSON, first 16 hex chars. */
export function structureHash(): string {
  if (cachedHash === null) {
    cachedHash = createHash('sha256').update(canonicalJson(MCHAT_RF_STRUCTURE)).digest('hex').slice(0, 16)
  }
  return cachedHash
}
