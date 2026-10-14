import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  NothingToUndoError,
  OTHER_TEXT_MAX,
  StepMismatchError,
  applyAnswer,
  applyFollowUpAnswer,
  assertMaybeAllowed,
  currentStep,
  followUpProgress,
  initFollowUpAnswers,
  parseFollowUpAnswers,
  preamblesFor,
  undoFollowUpStep,
  type FollowUpAnswers,
  type ItemDone,
  type Step,
  type StepAnswer,
  type StepPosition,
} from '../src/lib/questionnaires/followUpEngine'
import { MCHAT_RF_STRUCTURE, followUpItem, structureHash } from '../src/lib/questionnaires/mchatRfStructure'

/**
 * Plan per node id:
 * - yes/no question: 'YES' | 'NO' | 'MAYBE_YES' | 'MAYBE_NO' (a resolved "maybe")
 * - checklist: the endorsed example ids, or { yes, otherText, maybe } (`maybe`: the
 *   example ids whose yes/no came from a resolved "maybe")
 * - most-often / choice: the chosen id
 * Prompts are acknowledged automatically. A node missing from the plan fails the test.
 */
type Plan = Record<string, string | string[] | { yes: string[]; otherText?: string; maybe?: string[] }>

type Drive = { result: ItemDone; path: Step[]; visited: string[]; positions: StepPosition[] }

function answerFor(pos: StepPosition, plan: Plan): StepAnswer {
  if (pos.kind === 'PROMPT') return { node: pos.node, value: 'ACK' }
  const entry = plan[pos.node]
  assert.ok(entry !== undefined, `plan has no answer for node ${pos.node}`)
  switch (pos.kind) {
    case 'YES_NO': {
      const v = entry as string
      return v.startsWith('MAYBE_') ? { node: pos.node, value: v.slice(6), maybe: true } : { node: pos.node, value: v }
    }
    case 'EXAMPLE': {
      const { yes, otherText, maybe } = Array.isArray(entry)
        ? { yes: entry, otherText: undefined, maybe: undefined }
        : (entry as { yes: string[]; otherText?: string; maybe?: string[] })
      const value = yes.includes(pos.example) ? 'YES' : 'NO'
      return {
        node: pos.node,
        example: pos.example,
        value,
        ...(maybe?.includes(pos.example) ? { maybe: true } : {}),
        ...(pos.isOther && otherText ? { otherText } : {}),
      }
    }
    case 'MOST_OFTEN':
    case 'CHOICE':
      return { node: pos.node, value: entry as string }
  }
}

function drive(item: number, plan: Plan): Drive {
  let path: Step[] = []
  const visited: string[] = []
  const positions: StepPosition[] = []
  for (let i = 0; i < 100; i++) {
    const pos = currentStep(item, path)
    if (pos.done) return { result: pos, path, visited, positions }
    positions.push(pos)
    if (visited[visited.length - 1] !== pos.node) visited.push(pos.node)
    path = applyAnswer(item, path, answerFor(pos, plan))
  }
  throw new Error('did not terminate')
}

function score(item: number, plan: Plan): 0 | 1 {
  return drive(item, plan).result.score
}

/** Plan for prompt + checklist items. */
const cl = (yes: string[], extra: Plan = {}): Plan => ({ cl: yes, ...extra })

function assertScores(item: number, cases: Array<[Plan, 0 | 1]>) {
  for (const [plan, expected] of cases) assert.equal(score(item, plan), expected, `item ${item} ${JSON.stringify(plan)}`)
}

describe('Follow-Up routing per item (2025 graphs)', () => {
  it('standard split (items 1, 10, 11, 16): pass only → 0, fail only or none → 1, both → most often', () => {
    const shapes: Record<number, { p: number; f: number }> = { 1: { p: 4, f: 3 }, 10: { p: 3, f: 4 }, 11: { p: 3, f: 3 }, 16: { p: 3, f: 2 } }
    for (const [item, { p, f }] of Object.entries(shapes).map(([k, v]) => [Number(k), v] as const)) {
      assertScores(item, [
        [cl(['p1']), 0],
        [cl([`p${p}`, 'p1']), 0],
        [cl([`f${f}`]), 1],
        [cl([]), 1],
        [cl(['p1', 'f1'], { mo: 'p1' }), 0],
        [cl(['p1', 'f1'], { mo: 'f1' }), 1],
      ])
      const d = drive(item, cl(['p1', 'f1'], { mo: 'f1' }))
      assert.deepEqual(d.visited, ['prompt', 'cl', 'mo'])
    }
  })

  it('most often lists the endorsed examples of both groups in the original order, without Other', () => {
    const d = drive(1, cl(['f3', 'p2', 'f1', 'p4'], { mo: 'p4' }))
    const mo = d.positions.find((p) => p.kind === 'MOST_OFTEN')
    assert.ok(mo && mo.kind === 'MOST_OFTEN')
    assert.deepEqual(mo.options, ['p2', 'p4', 'f1', 'f3'])
    assert.equal(d.result.score, 0)
    // An example that was not endorsed cannot be chosen.
    const path = drive(1, cl(['p1', 'f1'], { mo: 'p1' })).path.slice(0, -1)
    assert.throws(() => applyAnswer(1, path, { node: 'mo', value: 'p2' }), StepMismatchError)
  })

  it('item 2: yes to either fail-type example → 1, none → 0; then the unscored supplementary', () => {
    assertScores(2, [
      [{ cl: ['f1'], s1: 'NO' }, 1],
      [{ cl: ['f2'], s1: 'NO' }, 1],
      [{ cl: ['f1', 'f2'], s1: 'NO' }, 1],
      [{ cl: [], s1: 'NO' }, 0],
    ])
    // Every supplementary answer leaves the score as it was.
    for (const yes of [[], ['f1']]) {
      for (const supp of [{ s1: 'NO' } as Plan, { s1: 'YES', s2: 'r1' }, { s1: 'YES', s2: 'r2' }, { s1: 'MAYBE_YES', s2: 'r3' }]) {
        const d = drive(2, { cl: yes, ...supp })
        assert.equal(d.result.score, yes.length > 0 ? 1 : 0)
      }
    }
    const d = drive(2, { cl: ['f1'], s1: 'YES', s2: 'r2' })
    assert.deepEqual(d.visited, ['cl', 's1', 's2'])
    const s1 = d.positions.find((p) => p.node === 's1')!
    assert.equal(s1.supplementary, true)
    assert.equal(s1.score, 1, 'the score is known before the supplementary questions')
    assert.equal(d.positions.find((p) => p.node === 'cl')!.score, null)
    const s2 = d.positions.find((p) => p.node === 's2')
    assert.ok(s2 && s2.kind === 'CHOICE')
    assert.deepEqual(s2.options, ['r1', 'r2', 'r3'])
  })

  it('items 3, 4, 17, 20: any example → 0, none → 1', () => {
    for (const [item, last] of [[3, 'p10'], [4, 'p4'], [17, 'p4'], [20, 'p3']] as const) {
      assertScores(item, [
        [cl(['p1']), 0],
        [cl([last]), 0],
        [cl([]), 1],
      ])
    }
  })

  it('item 5: no fail-type yes → 0 whatever the pass list; any fail-type → frequency (> 2/week): yes → 1, no → 0', () => {
    assertScores(5, [
      [cl([]), 0],
      [cl(['p1', 'p2']), 0],
      [cl(['f1'], { freq: 'YES' }), 1],
      [cl(['f4'], { freq: 'NO' }), 0],
      [cl(['p1', 'f2'], { freq: 'YES' }), 1],
      [cl(['p2', 'f3'], { freq: 'NO' }), 0],
    ])
    assert.deepEqual(drive(5, cl(['f1'], { freq: 'NO' })).visited, ['prompt', 'cl', 'freq'])
    assert.deepEqual(drive(5, cl(['p1'])).visited, ['prompt', 'cl'])
  })

  it('item 6: any → probe (yes → 0, no → 1); none → 1', () => {
    assertScores(6, [
      [cl(['n2'], { q1: 'YES' }), 0],
      [cl(['n1', 'n4'], { q1: 'NO' }), 1],
      [cl([]), 1],
    ])
  })

  it('item 7: none → 1; any → q1 (no → 1; yes → q2: optA → 0, optBoth → 0, optB → 1)', () => {
    assertScores(7, [
      [cl([]), 1],
      [cl(['n3'], { q1: 'NO' }), 1],
      [cl(['n1'], { q1: 'YES', q2: 'optA' }), 0],
      [cl(['n1'], { q1: 'YES', q2: 'optBoth' }), 0],
      [cl(['n4'], { q1: 'YES', q2: 'optB' }), 1],
    ])
    assert.deepEqual(drive(7, cl(['n1'], { q1: 'YES', q2: 'optB' })).visited, ['prompt', 'cl', 'q1', 'q2'])
  })

  it('item 8 chain: q1 yes → 0; q2 no → 1; checklist none → 1; any → frequency (> half): yes → 0, no → 1', () => {
    assertScores(8, [
      [{ q1: 'YES' }, 0],
      [{ q1: 'NO', q2: 'NO' }, 1],
      [{ q1: 'NO', q2: 'YES', cl: [] }, 1],
      [{ q1: 'NO', q2: 'YES', cl: ['p7'], freq: 'YES' }, 0],
      [{ q1: 'NO', q2: 'YES', cl: ['p1', 'p3'], freq: 'NO' }, 1],
    ])
    assert.deepEqual(drive(8, { q1: 'YES' }).visited, ['q1'])
    assert.deepEqual(drive(8, { q1: 'NO', q2: 'NO' }).visited, ['q1', 'q2'])
    assert.deepEqual(drive(8, { q1: 'NO', q2: 'YES', cl: ['p1'], freq: 'YES' }).visited, ['q1', 'q2', 'prompt', 'cl', 'freq'])
  })

  it('item 9: any → q1 (yes → 0, no → 1); none → 1', () => {
    assertScores(9, [
      [cl(['p5'], { q1: 'YES' }), 0],
      [cl(['p1'], { q1: 'NO' }), 1],
      [cl([]), 1],
    ])
  })

  it('item 12: count 0–1 → 0; 2 or more → prompt → split → most often', () => {
    assertScores(12, [
      [{ cnt: [] }, 0],
      [{ cnt: ['n9'] }, 0],
      [{ cnt: ['n1', 'n2'], cl: ['p1'] }, 0],
      [{ cnt: ['n1', 'n5', 'n9'], cl: ['f3'] }, 1],
      [{ cnt: ['n1', 'n2'], cl: [] }, 1],
      [{ cnt: ['n1', 'n2'], cl: ['p2', 'f1'], mo: 'p2' }, 0],
      [{ cnt: ['n1', 'n2'], cl: ['p2', 'f1'], mo: 'f1' }, 1],
    ])
    assert.deepEqual(drive(12, { cnt: ['n1'] }).visited, ['cnt'])
    assert.deepEqual(drive(12, { cnt: ['n1', 'n2'], cl: ['p1', 'f2'], mo: 'f2' }).visited, ['cnt', 'prompt', 'cl', 'mo'])
  })

  it('item 13: one probe, yes → 0, no → 1', () => {
    assertScores(13, [
      [{ q1: 'YES' }, 0],
      [{ q1: 'NO' }, 1],
    ])
  })

  it('item 14: count 0 → 1, 2+ → 0, exactly 1 → f1 (≥ 1/day; no → 1) → f2 (≥ 5/day; yes → 0, no → 1)', () => {
    assertScores(14, [
      [{ cnt: [] }, 1],
      [{ cnt: ['n1', 'n6'] }, 0],
      [{ cnt: ['n1', 'n2', 'n3', 'n4', 'n5', 'n6'] }, 0],
      [{ cnt: ['n3'], f1: 'NO' }, 1],
      [{ cnt: ['n3'], f1: 'YES', f2: 'YES' }, 0],
      [{ cnt: ['n6'], f1: 'YES', f2: 'NO' }, 1],
    ])
    assert.deepEqual(drive(14, { cnt: ['n3'], f1: 'YES', f2: 'NO' }).visited, ['prompt', 'cnt', 'f1', 'f2'])
    assert.deepEqual(drive(14, { cnt: ['n3'], f1: 'NO' }).visited, ['prompt', 'cnt', 'f1'])
  })

  it('item 15: count 0–1 → 1, 2+ → 0', () => {
    assertScores(15, [
      [{ cnt: [] }, 1],
      [{ cnt: ['n4'] }, 1],
      [{ cnt: ['n1', 'n6'] }, 0],
    ])
  })

  it('item 18: q1 yes → list; q1 no → q2 (no → 1, yes → list); list stops at the first yes', () => {
    assertScores(18, [
      [{ q1: 'NO', q2: 'NO' }, 1],
      [{ q1: 'YES', cl: ['n1'] }, 0],
      [{ q1: 'NO', q2: 'YES', cl: ['n3'] }, 0],
      [{ q1: 'YES', cl: [] }, 1],
    ])
    const examplesAsked = (yes: string[]) =>
      drive(18, { q1: 'YES', cl: yes }).positions.filter((p) => p.kind === 'EXAMPLE').map((p) => (p.kind === 'EXAMPLE' ? p.example : ''))
    assert.deepEqual(examplesAsked(['n1', 'n2', 'n3']), ['n1'])
    assert.deepEqual(examplesAsked(['n2', 'n3']), ['n1', 'n2'])
    assert.deepEqual(examplesAsked([]), ['n1', 'n2', 'n3'])
    // Nothing can be recorded after the first yes.
    const done = drive(18, { q1: 'YES', cl: ['n1'] }).path
    assert.throws(() => applyAnswer(18, done, { node: 'cl', example: 'n2', value: 'NO' }), StepMismatchError)
  })

  it('item 19: three questions, the first yes → 0; all no → 1', () => {
    assertScores(19, [
      [{ q1: 'YES' }, 0],
      [{ q1: 'NO', q2: 'YES' }, 0],
      [{ q1: 'NO', q2: 'NO', q3: 'YES' }, 0],
      [{ q1: 'NO', q2: 'NO', q3: 'NO' }, 1],
    ])
    assert.deepEqual(drive(19, { q1: 'NO', q2: 'YES' }).visited, ['q1', 'q2'])
  })
})

describe('"Other (describe)" rows', () => {
  const other = (yes: string[], otherText = 'mô tả thử nghiệm') => ({ yes, otherText })

  it('pass-leaning lists (3, 9, 15, 17, 20) do not count an endorsed Other; the item is flagged when counting it would change the route', () => {
    // item → [plan where the Other row decides the route, score]
    const onlyOther: Array<[number, Plan, 0 | 1]> = [
      [3, { cl: other(['p11o']) }, 1],
      [9, { cl: other(['p6o']) }, 1],
      [15, { cnt: other(['n1', 'n7o']) }, 1],
      [17, { cl: other(['p5o']) }, 1],
      [20, { cl: other(['p4o']) }, 1],
    ]
    for (const [item, plan, expected] of onlyOther) {
      const d = drive(item, plan)
      assert.equal(d.result.score, expected, `item ${item}`)
      assert.equal(d.result.needsReview, true, `item ${item}`)
    }
    // Item 9: not counting the Other row skips the probe that could end in 0.
    assert.deepEqual(drive(9, { cl: other(['p6o']) }).visited, ['prompt', 'cl'])
  })

  it('fail-leaning lists (item 5, item 12 count list) count an endorsed Other, so what can decide a 1 is still asked; flagged', () => {
    // Item 5: only the Other row of the fail-type list → the frequency question.
    let d = drive(5, { cl: other(['f5o']), freq: 'YES' })
    assert.deepEqual(d.visited, ['prompt', 'cl', 'freq'])
    assert.equal(d.result.score, 1)
    assert.equal(d.result.needsReview, true)
    d = drive(5, { cl: other(['p1', 'f5o']), freq: 'NO' })
    assert.equal(d.result.score, 0)
    assert.equal(d.result.needsReview, true, 'not counting it would have skipped the frequency question')
    // Item 12: one count + the Other row = 2 → the second list.
    d = drive(12, { cnt: other(['n1', 'n10o']), cl: ['f1'] })
    assert.deepEqual(d.visited, ['cnt', 'prompt', 'cl'])
    assert.equal(d.result.score, 1)
    assert.equal(d.result.needsReview, true)
    d = drive(12, { cnt: other(['n9', 'n10o']), cl: ['p1', 'f2'], mo: 'p1' })
    assert.equal(d.result.score, 0)
    assert.equal(d.result.needsReview, true)
    // The most-often options never include the count list's Other row (other list).
    const mo = d.positions.find((p) => p.kind === 'MOST_OFTEN')
    assert.ok(mo && mo.kind === 'MOST_OFTEN')
    assert.deepEqual(mo.options, ['p1', 'f2'])
  })

  it('no flag when the Other row does not change the route', () => {
    const cases: Array<[number, Plan, 0 | 1]> = [
      [3, { cl: other(['p1', 'p11o']) }, 0],
      [5, { cl: other(['f1', 'f5o']), freq: 'YES' }, 1],
      [5, { cl: other(['f1', 'f5o']), freq: 'NO' }, 0],
      [9, { cl: other(['p1', 'p6o']), q1: 'YES' }, 0],
      [12, { cnt: other(['n10o']) }, 0],
      [12, { cnt: other(['n1', 'n2', 'n10o']), cl: ['p1'] }, 0],
      [12, { cnt: other(['n1', 'n2', 'n10o']), cl: ['f3'] }, 1],
      [15, { cnt: other(['n7o']) }, 1],
      [15, { cnt: other(['n1', 'n2', 'n7o']) }, 0],
      [20, { cl: other(['p2', 'p4o']) }, 0],
    ]
    for (const [item, plan, expected] of cases) {
      const d = drive(item, plan)
      assert.equal(d.result.score, expected, `item ${item}`)
      assert.equal(d.result.needsReview, false, `item ${item}`)
    }
    assert.equal(drive(20, { cl: [] }).result.needsReview, false)
  })

  it('stores the trimmed description only for an endorsed Other row', () => {
    const yes = drive(20, { cl: { yes: ['p4o'], otherText: '  mô tả  ' } }).path.find((s) => s.example === 'p4o')
    assert.equal(yes?.otherText, 'mô tả')
    const no = drive(20, { cl: { yes: [], otherText: 'mô tả' } }).path.find((s) => s.example === 'p4o')
    assert.equal(no?.otherText, undefined)
  })

  it('rejects a description on a non-Other row or longer than the limit', () => {
    const atP1 = drive(20, { cl: [] }).path.slice(0, 1) // prompt acknowledged
    assert.throws(() => applyAnswer(20, atP1, { node: 'cl', example: 'p1', value: 'YES', otherText: 'x' }), StepMismatchError)
    // An empty description on a normal row is ignored.
    assert.equal(applyAnswer(20, atP1, { node: 'cl', example: 'p1', value: 'YES', otherText: '  ' })[1].otherText, undefined)
    const atOther = drive(20, { cl: [] }).path.slice(0, 4)
    assert.equal(currentStep(20, atOther).done, false)
    assert.throws(
      () => applyAnswer(20, atOther, { node: 'cl', example: 'p4o', value: 'YES', otherText: 'x'.repeat(OTHER_TEXT_MAX + 1) }),
      StepMismatchError,
    )
    assert.equal(
      applyAnswer(20, atOther, { node: 'cl', example: 'p4o', value: 'YES', otherText: 'x'.repeat(OTHER_TEXT_MAX) })[4].otherText?.length,
      OTHER_TEXT_MAX,
    )
  })

  it('positions mark the Other row', () => {
    const d = drive(3, { cl: [] })
    const examples = d.positions.filter((p) => p.kind === 'EXAMPLE')
    assert.equal(examples.length, 11)
    examples.forEach((p, i) => {
      assert.ok(p.kind === 'EXAMPLE')
      assert.equal(p.index, i)
      assert.equal(p.count, 11)
      assert.equal(p.isOther, i === 10)
    })
  })
})

describe('"Maybe"', () => {
  it('a resolved maybe follows the chosen branch and is recorded as such', () => {
    const d = drive(19, { q1: 'MAYBE_NO', q2: 'MAYBE_YES' })
    assert.equal(d.result.score, 0)
    assert.deepEqual(d.path, [
      { node: 'q1', value: 'NO', maybe: true },
      { node: 'q2', value: 'YES', maybe: true },
    ])
    assert.equal(score(13, { q1: 'MAYBE_NO' }), 1)
    assert.equal(score(8, { q1: 'NO', q2: 'YES', cl: ['p1'], freq: 'MAYBE_YES' }), 0)
  })

  it('example rows take a maybe too: recorded on the example step, routing follows the resolved answer', () => {
    const d = drive(1, { cl: { yes: ['p2', 'f1'], maybe: ['p2', 'f3'] }, mo: 'f1' })
    assert.equal(d.result.score, 1)
    const steps = d.path.filter((s) => s.node === 'cl')
    assert.deepEqual(steps.find((s) => s.example === 'p2'), { node: 'cl', example: 'p2', value: 'YES', maybe: true })
    assert.deepEqual(steps.find((s) => s.example === 'f3'), { node: 'cl', example: 'f3', value: 'NO', maybe: true })
    assert.deepEqual(steps.find((s) => s.example === 'f1'), { node: 'cl', example: 'f1', value: 'YES' })
    // A maybe-yes on an Other row keeps its description.
    const otherPath = drive(20, { cl: { yes: ['p4o'], maybe: ['p4o'], otherText: 'mô tả' } }).path
    const o = otherPath[otherPath.length - 1]
    assert.deepEqual(o, { node: 'cl', example: 'p4o', value: 'YES', maybe: true, otherText: 'mô tả' })
    // Item 18 (stop at the first yes) with a resolved maybe.
    assert.equal(score(18, { q1: 'YES', cl: { yes: ['n2'], maybe: ['n1', 'n2'] } }), 0)
  })

  it('only at yes/no points (questions and example rows); the unresolved MAYBE is never recorded', () => {
    assert.throws(() => applyAnswer(13, [], { node: 'q1', value: 'MAYBE' }), StepMismatchError)
    assert.throws(() => applyAnswer(3, [], { node: 'prompt', value: 'ACK', maybe: true }), StepMismatchError)
    const atExample = [{ node: 'prompt', value: 'ACK' }]
    assert.throws(() => applyAnswer(3, atExample, { node: 'cl', example: 'p1', value: 'MAYBE' }), StepMismatchError)
    assert.deepEqual(applyAnswer(3, atExample, { node: 'cl', example: 'p1', value: 'NO', maybe: true })[1], {
      node: 'cl',
      example: 'p1',
      value: 'NO',
      maybe: true,
    })
    assert.throws(() => applyAnswer(7, drive(7, cl(['n1'], { q1: 'YES', q2: 'optA' })).path.slice(0, -1), { node: 'q2', value: 'optA', maybe: true }), StepMismatchError)
    const atMo = drive(1, cl(['p1', 'f1'], { mo: 'p1' })).path.slice(0, -1)
    assert.throws(() => applyAnswer(1, atMo, { node: 'mo', value: 'p1', maybe: true }), StepMismatchError)

    const answers = initFollowUpAnswers([3, 13])
    assert.throws(() => assertMaybeAllowed(answers, 3, 'prompt'), StepMismatchError)
    assert.throws(() => assertMaybeAllowed(answers, 13, 'q1'), StepMismatchError, 'not the current item')
    const at3 = applyFollowUpAnswer(
      applyFollowUpAnswer(applyFollowUpAnswer(answers, { item: 3, node: 'prompt', value: 'ACK' }), { item: 3, node: 'cl', example: 'p1', value: 'YES' }),
      { item: 3, node: 'cl', example: 'p2', value: 'NO' },
    )
    // Item 3 is at example p3: maybe is allowed there, for that example only.
    const pos = assertMaybeAllowed(at3, 3, 'cl', 'p3')
    assert.ok(pos.kind === 'EXAMPLE' && pos.example === 'p3')
    assert.throws(() => assertMaybeAllowed(at3, 3, 'cl'), StepMismatchError, 'example missing')
    assert.throws(() => assertMaybeAllowed(at3, 3, 'cl', 'p4'), StepMismatchError, 'not the current example')
    assert.equal(assertMaybeAllowed(initFollowUpAnswers([13]), 13, 'q1').kind, 'YES_NO')
    assert.throws(() => assertMaybeAllowed(initFollowUpAnswers([13]), 13, 'q1', 'p1'), StepMismatchError, 'example on a question')
    assert.throws(() => assertMaybeAllowed(initFollowUpAnswers([13]), 13, 'q2'), StepMismatchError)
  })
})

describe('StepMismatch', () => {
  it('wrong node, example or value', () => {
    assert.throws(() => applyAnswer(1, [], { node: 'cl', example: 'p1', value: 'YES' }), StepMismatchError)
    assert.throws(() => applyAnswer(1, [], { node: 'prompt', value: 'YES' }), StepMismatchError)
    assert.throws(() => applyAnswer(1, [], { node: 'prompt', value: 'ACK', example: 'p1' }), StepMismatchError)
    const at = [{ node: 'prompt', value: 'ACK' }]
    assert.throws(() => applyAnswer(1, at, { node: 'cl', example: 'p2', value: 'YES' }), StepMismatchError)
    assert.throws(() => applyAnswer(1, at, { node: 'cl', value: 'YES' }), StepMismatchError)
    assert.throws(() => applyAnswer(1, at, { node: 'cl', example: 'p1', value: 'ACK' }), StepMismatchError)
    assert.throws(() => applyAnswer(13, [], { node: 'q1', value: 'yes' }), StepMismatchError)
    assert.throws(() => applyAnswer(7, drive(7, cl(['n1'], { q1: 'YES', q2: 'optA' })).path.slice(0, -1), { node: 'q2', value: 'optC' }), StepMismatchError)
  })

  it('an answer after the item ended, or a stored path that does not replay', () => {
    const done = drive(13, { q1: 'YES' }).path
    assert.throws(() => applyAnswer(13, done, { node: 'q1', value: 'YES' }), StepMismatchError)
    assert.throws(() => currentStep(13, [...done, { node: 'q1', value: 'NO' }]), StepMismatchError)
    assert.throws(() => currentStep(1, [{ node: 'cl', example: 'p1', value: 'YES' }]), StepMismatchError)
    assert.throws(() => currentStep(5, [{ node: 'prompt', value: 'ACK' }, { node: 'cl', example: 'p1', value: 'MAYBE' }]), StepMismatchError)
  })
})

describe('every path of every graph terminates with a score', () => {
  /** Depth-first over every possible answer (examples yes/no, every option). */
  function enumerate(item: number) {
    const leaves: ItemDone[] = []
    const nodesSeen = new Set<string>()
    const examplesSeen = new Set<string>()
    let maxLength = 0
    const walk = (path: Step[]) => {
      const pos = currentStep(item, path)
      if (pos.done) {
        leaves.push(pos)
        maxLength = Math.max(maxLength, path.length)
        return
      }
      nodesSeen.add(`${pos.supplementary ? 'supp:' : ''}${pos.node}`)
      assert.ok(path.length < 60, `item ${item}: path too long`)
      const answers: StepAnswer[] =
        pos.kind === 'PROMPT'
          ? [{ node: pos.node, value: 'ACK' }]
          : pos.kind === 'YES_NO'
            ? [{ node: pos.node, value: 'YES' }, { node: pos.node, value: 'NO' }]
            : pos.kind === 'EXAMPLE'
              ? [{ node: pos.node, example: pos.example, value: 'YES' }, { node: pos.node, example: pos.example, value: 'NO' }]
              : pos.options.map((o) => ({ node: pos.node, value: o }))
      if (pos.kind === 'EXAMPLE') examplesSeen.add(`${pos.node}.${pos.example}`)
      assert.ok(answers.length > 0, `item ${item}: no answer possible at ${pos.node}`)
      for (const a of answers) walk(applyAnswer(item, path, a))
    }
    walk([])
    return { leaves, nodesSeen, examplesSeen, maxLength }
  }

  for (const f of MCHAT_RF_STRUCTURE.followUp) {
    it(`item ${f.item}`, () => {
      const { leaves, nodesSeen, examplesSeen } = enumerate(f.item)
      assert.ok(leaves.length > 0)
      for (const leaf of leaves) assert.ok(leaf.score === 0 || leaf.score === 1)
      // Both outcomes are possible on every page.
      assert.deepEqual([...new Set(leaves.map((l) => l.score))].sort(), [0, 1], `item ${f.item}`)
      // Every node (and every example) is reached on some path.
      const allNodes = [...Object.keys(f.nodes), ...Object.keys(f.supplementary?.nodes ?? {}).map((n) => `supp:${n}`)]
      assert.deepEqual([...nodesSeen].sort(), allNodes.sort(), `item ${f.item}`)
      const allExamples = Object.entries(f.nodes).flatMap(([id, n]) => (n.type === 'CHECKLIST' ? n.examples.map((e) => `${id}.${e.id}`) : []))
      assert.deepEqual([...examplesSeen].sort(), allExamples.sort(), `item ${f.item}`)
      // Without an endorsed Other row there is never a review flag.
      const hasOther = Object.values(f.nodes).some((n) => n.type === 'CHECKLIST' && n.examples.some((e) => e.isOther))
      if (!hasOther) assert.ok(leaves.every((l) => !l.needsReview), `item ${f.item}`)
    })
  }
})

describe('whole Follow-Up (several items)', () => {
  /** Answers every question of `item` per `plan` through the multi-item API. */
  function answerItem(answers: FollowUpAnswers, item: number, plan: Plan): FollowUpAnswers {
    let a = answers
    for (let i = 0; i < 100; i++) {
      const progress = followUpProgress(a)
      const current = progress.currentIndex === null ? null : progress.items[progress.currentIndex]
      if (!current || current.item !== item) return a
      a = applyFollowUpAnswer(a, { item, ...answerFor(current.position!, plan) })
    }
    throw new Error('did not terminate')
  }

  it('initialises in ascending item order with this structure', () => {
    const a = initFollowUpAnswers([14, 3, 7, 3])
    assert.deepEqual(a.order, [3, 7, 14])
    assert.equal(a.structureHash, structureHash())
    assert.equal(a.engine, 'mchat-rf-2025-03')
    assert.deepEqual(a.items, {})
    const p = followUpProgress(a)
    assert.equal(p.currentIndex, 0)
    assert.equal(p.complete, false)
    assert.deepEqual(p.items.map((i) => i.state), ['TODO', 'TODO', 'TODO'])
  })

  it('walks the items in order and finalises with the items still scoring 1', () => {
    let a = initFollowUpAnswers([3, 13, 19])
    assert.throws(() => applyFollowUpAnswer(a, { item: 13, node: 'q1', value: 'YES' }), StepMismatchError, 'not the current item')
    a = applyFollowUpAnswer(a, { item: 3, node: 'prompt', value: 'ACK' })
    assert.deepEqual(followUpProgress(a).items.map((i) => i.state), ['IN_PROGRESS', 'TODO', 'TODO'])
    a = answerItem(a, 3, { cl: [] }) // → 1
    let p = followUpProgress(a)
    assert.deepEqual(p.items.map((i) => [i.state, i.score]), [['DONE', 1], ['TODO', null], ['TODO', null]])
    assert.equal(a.items['3'].score, 1, 'audit fields are written once an item is done')
    a = answerItem(a, 13, { q1: 'YES' }) // → 0
    a = answerItem(a, 19, { q1: 'NO', q2: 'NO', q3: 'NO' }) // → 1
    p = followUpProgress(a)
    assert.equal(p.complete, true)
    assert.equal(p.currentIndex, null)
    assert.deepEqual(p.stillFailing, [3, 19])
    assert.deepEqual(p.reviewItems, [])
    assert.throws(() => applyFollowUpAnswer(a, { item: 19, node: 'q1', value: 'YES' }), StepMismatchError)
  })

  it('collects review flags per item', () => {
    let a = initFollowUpAnswers([15, 20])
    a = answerItem(a, 15, { cnt: { yes: ['n1', 'n7o'], otherText: 'mô tả' } })
    a = answerItem(a, 20, { cl: ['p1'] })
    const p = followUpProgress(a)
    assert.deepEqual(p.reviewItems, [15])
    assert.deepEqual(p.stillFailing, [15])
    assert.equal(a.items['15'].needsReview, true)
  })

  it('back removes the last step, then re-opens the previous item; nothing to undo at the start', () => {
    const start = initFollowUpAnswers([13, 19])
    assert.throws(() => undoFollowUpStep(start), NothingToUndoError)
    let a = answerItem(start, 13, { q1: 'NO' })
    a = applyFollowUpAnswer(a, { item: 19, node: 'q1', value: 'NO' })
    a = undoFollowUpStep(a) // removes 19.q1
    assert.deepEqual(a.items['19'], undefined)
    assert.equal(followUpProgress(a).currentIndex, 1)
    a = undoFollowUpStep(a) // 19 has no steps → re-opens 13 and removes its answer
    let p = followUpProgress(a)
    assert.equal(p.currentIndex, 0)
    assert.equal(p.items[0].state, 'TODO')
    assert.equal(p.stepCount, 0)
    assert.throws(() => undoFollowUpStep(a), NothingToUndoError)

    // Undo after the last answer re-opens the last item.
    a = answerItem(answerItem(start, 13, { q1: 'YES' }), 19, { q1: 'YES' })
    assert.equal(followUpProgress(a).complete, true)
    a = undoFollowUpStep(a)
    p = followUpProgress(a)
    assert.equal(p.complete, false)
    assert.equal(p.items[1].item, 19)
    assert.equal(p.items[1].state, 'TODO')
    assert.equal(a.items['13'].score, 0)
  })

  it('item 7 shows its preamble only right after item 6', () => {
    assert.deepEqual(preamblesFor(initFollowUpAnswers([6, 7]), 1), ['after6'])
    assert.deepEqual(preamblesFor(initFollowUpAnswers([1, 6, 7, 9]), 2), ['after6'])
    assert.deepEqual(preamblesFor(initFollowUpAnswers([5, 7]), 1), [])
    assert.deepEqual(preamblesFor(initFollowUpAnswers([7]), 0), [])
    assert.deepEqual(preamblesFor(initFollowUpAnswers([6, 7]), 0), [])
  })

  it('parses stored JSON; anything unusable for this structure starts over', () => {
    let a = initFollowUpAnswers([2, 13])
    a = answerItem(a, 2, { cl: ['f1'], s1: 'YES', s2: 'r1' })
    const stored = JSON.parse(JSON.stringify(a))
    assert.deepEqual(parseFollowUpAnswers(stored, [13, 2]), a)
    assert.equal(parseFollowUpAnswers(null, [2, 13]), null)
    assert.equal(parseFollowUpAnswers('x', [2, 13]), null)
    assert.equal(parseFollowUpAnswers({ ...stored, structureHash: '0000000000000000' }, [2, 13]), null)
    assert.equal(parseFollowUpAnswers({ ...stored, engine: 'mchat-rf-2018' }, [2, 13]), null)
    assert.equal(parseFollowUpAnswers(stored, [2, 13, 19]), null, 'other item list')
    assert.equal(parseFollowUpAnswers({ ...stored, items: { '2': { path: [{ node: 'zz', value: 'YES' }] } } }, [2, 13]), null)
    assert.equal(parseFollowUpAnswers({ ...stored, items: { '13': { path: [{ node: 'q1', value: 'YES' }] } } }, [2, 13]), null, 'out of order')
    assert.equal(parseFollowUpAnswers({ ...stored, items: { '05': stored.items['2'] } }, [2, 13]), null)
    assert.equal(parseFollowUpAnswers({ ...stored, items: { '2': { path: [{ node: 1, value: 'YES' }] } } }, [2, 13]), null)
    // Audit fields are recomputed from the paths, never trusted.
    const tampered = JSON.parse(JSON.stringify(stored))
    tampered.items['2'].score = 0
    assert.equal(parseFollowUpAnswers(tampered, [2, 13])!.items['2'].score, 1)
  })
})
