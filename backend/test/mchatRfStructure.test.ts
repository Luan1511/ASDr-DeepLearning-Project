import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'crypto'
import { MCHAT_RF, scoreStage1, type Answers } from '../src/lib/questionnaires/mchatRf'
import {
  MCHAT_RF_STRUCTURE,
  STRUCTURE_VERSION,
  canonicalJson,
  followUpItem,
  structureHash,
  type ChecklistNode,
  type FollowUpItemStructure,
  type FollowUpNode,
  type Target,
} from '../src/lib/questionnaires/mchatRfStructure'

/** Snapshot: changes when the routing or the item layout changes (then every content file must be regenerated). */
const EXPECTED_HASH = 'ee0604d6660a38d0'

const range = (prefix: string, n: number, other = false) => [
  ...Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`),
  ...(other ? [`${prefix}${n + 1}o`] : []),
]

/** Example ids per checklist node, per mchat_structure.md §2/§4 (2025 form). */
const EXPECTED_EXAMPLES: Record<number, Record<string, string[]>> = {
  1: { cl: [...range('p', 4), ...range('f', 3)] },
  2: { cl: range('f', 2) },
  3: { cl: range('p', 10, true) },
  4: { cl: range('p', 4) },
  5: { cl: [...range('p', 2), ...range('f', 4, true)] },
  6: { cl: range('n', 4) },
  7: { cl: range('n', 4) },
  8: { cl: range('p', 7) },
  9: { cl: range('p', 5, true) },
  10: { cl: [...range('p', 3), ...range('f', 4)] },
  11: { cl: [...range('p', 3), ...range('f', 3)] },
  12: { cnt: range('n', 9, true), cl: [...range('p', 2), ...range('f', 3)] },
  13: {},
  14: { cnt: range('n', 6) },
  15: { cnt: range('n', 6, true) },
  16: { cl: [...range('p', 3), ...range('f', 2)] },
  17: { cl: range('p', 4, true) },
  18: { cl: range('n', 3) },
  19: {},
  20: { cl: range('p', 3, true) },
}

/** Node ids and types per item (entry first). */
const EXPECTED_NODES: Record<number, string> = {
  1: 'prompt:PROMPT cl:CHECKLIST mo:MOST_OFTEN',
  2: 'cl:CHECKLIST',
  3: 'prompt:PROMPT cl:CHECKLIST',
  4: 'prompt:PROMPT cl:CHECKLIST',
  5: 'prompt:PROMPT cl:CHECKLIST freq:YES_NO',
  6: 'prompt:PROMPT cl:CHECKLIST q1:YES_NO',
  7: 'prompt:PROMPT cl:CHECKLIST q1:YES_NO q2:CHOICE',
  8: 'q1:YES_NO q2:YES_NO prompt:PROMPT cl:CHECKLIST freq:YES_NO',
  9: 'prompt:PROMPT cl:CHECKLIST q1:YES_NO',
  10: 'prompt:PROMPT cl:CHECKLIST mo:MOST_OFTEN',
  11: 'prompt:PROMPT cl:CHECKLIST mo:MOST_OFTEN',
  12: 'cnt:CHECKLIST prompt:PROMPT cl:CHECKLIST mo:MOST_OFTEN',
  13: 'q1:YES_NO',
  14: 'prompt:PROMPT cnt:CHECKLIST f1:YES_NO f2:YES_NO',
  15: 'prompt:PROMPT cnt:CHECKLIST',
  16: 'prompt:PROMPT cl:CHECKLIST mo:MOST_OFTEN',
  17: 'prompt:PROMPT cl:CHECKLIST',
  18: 'q1:YES_NO q2:YES_NO cl:CHECKLIST',
  19: 'q1:YES_NO q2:YES_NO q3:YES_NO',
  20: 'prompt:PROMPT cl:CHECKLIST',
}

function targetsOf(node: FollowUpNode): Target[] {
  switch (node.type) {
    case 'PROMPT':
      return [{ goto: node.next }]
    case 'YES_NO':
      return [node.yes, node.no]
    case 'CHOICE':
      return node.options.map((o) => o.to)
    case 'MOST_OFTEN':
      return [node.pass, node.fail]
    case 'CHECKLIST': {
      const r = node.route
      if (r.kind === 'ANY_YES') return [r.anyYes, r.noneYes]
      if (r.kind === 'COUNT_YES') return r.bands.map((b) => b.to)
      if (r.kind === 'PASS_FAIL_SPLIT') return [r.passOnly, r.failOnlyOrNone, { goto: r.both }]
      return [r.anyFail, r.noFail]
    }
  }
}

/** Reachable node ids from `entry`; throws on a cycle. */
function reachable(nodes: Record<string, FollowUpNode>, entry: string): Set<string> {
  const seen = new Set<string>()
  const visit = (id: string, stack: string[]) => {
    assert.ok(nodes[id], `unknown node ${id}`)
    assert.ok(!stack.includes(id), `cycle through ${[...stack, id].join(' → ')}`)
    seen.add(id)
    for (const t of targetsOf(nodes[id])) if ('goto' in t) visit(t.goto, [...stack, id])
  }
  visit(entry, [])
  return seen
}

function checklist(item: number, node: string): ChecklistNode {
  const n = followUpItem(item).nodes[node]
  assert.equal(n.type, 'CHECKLIST')
  return n as ChecklistNode
}

describe('M-CHAT-R/F structure: stage 1', () => {
  it('has 20 items; only 2, 5 and 12 are elevated on YES; 2, 11, 13, 14, 16 have no examples', () => {
    assert.equal(MCHAT_RF_STRUCTURE.stage1.length, 20)
    MCHAT_RF_STRUCTURE.stage1.forEach((s, i) => assert.equal(s.number, i + 1))
    const onYes = MCHAT_RF_STRUCTURE.stage1.filter((s) => s.elevatedOn === 'YES').map((s) => s.number)
    assert.deepEqual(onYes, [2, 5, 12])
    assert.deepEqual(onYes, [...MCHAT_RF.elevatedOnYes])
    const withoutExamples = MCHAT_RF_STRUCTURE.stage1.filter((s) => !s.hasExamples).map((s) => s.number)
    assert.deepEqual(withoutExamples, [2, 11, 13, 14, 16])
  })

  it('agrees with the stage-1 scoring: the elevated answer scores 1', () => {
    for (const s of MCHAT_RF_STRUCTURE.stage1) {
      const answers: Answers = {}
      for (const t of MCHAT_RF_STRUCTURE.stage1) answers[t.number] = t.elevatedOn === 'NO' // all passing
      answers[s.number] = s.elevatedOn === 'YES'
      assert.deepEqual(scoreStage1(answers).failedItems, [s.number])
    }
  })
})

describe('M-CHAT-R/F structure: Follow-Up graphs (2025)', () => {
  it('has one page per item, in order, version mchat-rf-2025-03', () => {
    assert.equal(STRUCTURE_VERSION, 'mchat-rf-2025-03')
    assert.equal(MCHAT_RF_STRUCTURE.structureVersion, MCHAT_RF.structureVersion)
    assert.deepEqual(MCHAT_RF_STRUCTURE.followUp.map((f) => f.item), MCHAT_RF_STRUCTURE.stage1.map((s) => s.number))
    assert.throws(() => followUpItem(21), RangeError)
  })

  it('node ids, types and entry match §4 for every item', () => {
    for (const f of MCHAT_RF_STRUCTURE.followUp) {
      const actual = Object.entries(f.nodes).map(([id, n]) => `${id}:${n.type}`).join(' ')
      assert.equal(actual, EXPECTED_NODES[f.item], `item ${f.item}`)
      assert.equal(f.entry, EXPECTED_NODES[f.item].split(':')[0], `item ${f.item} entry`)
    }
  })

  it('example ids, order, groups and "Other" rows match §2/§4', () => {
    for (const f of MCHAT_RF_STRUCTURE.followUp) {
      const lists = Object.entries(f.nodes).filter(([, n]) => n.type === 'CHECKLIST') as Array<[string, ChecklistNode]>
      assert.deepEqual(lists.map(([id]) => id).sort(), Object.keys(EXPECTED_EXAMPLES[f.item]).sort(), `item ${f.item}`)
      for (const [id, list] of lists) {
        assert.deepEqual(list.examples.map((e) => e.id), EXPECTED_EXAMPLES[f.item][id], `item ${f.item} ${id}`)
        for (const e of list.examples) {
          const group = { p: 'PASS', f: 'FAIL', n: 'NEUTRAL' }[e.id[0]]
          assert.equal(e.group, group, `item ${f.item} ${e.id}`)
          assert.equal(e.isOther, e.id.endsWith('o'), `item ${f.item} ${e.id}`)
        }
        // Fail-leaning lists count the Other row (item 5 cl, item 12 cnt); pass-leaning lists do not.
        const counted = (f.item === 5 && id === 'cl') || (f.item === 12 && id === 'cnt')
        const policy = counted ? 'COUNTED_REVIEW' : 'NOT_COUNTED_REVIEW'
        assert.equal(list.otherPolicy, list.examples.some((e) => e.isOther) ? policy : null, `item ${f.item} ${id}`)
      }
    }
    assert.equal(checklist(5, 'cl').otherPolicy, 'COUNTED_REVIEW')
    assert.equal(checklist(12, 'cnt').otherPolicy, 'COUNTED_REVIEW')
    for (const [item, id] of [[3, 'cl'], [9, 'cl'], [15, 'cnt'], [17, 'cl'], [20, 'cl']] as const) {
      assert.equal(checklist(item, id).otherPolicy, 'NOT_COUNTED_REVIEW', `item ${item}`)
    }
    const withOther = MCHAT_RF_STRUCTURE.followUp
      .filter((f) => Object.values(f.nodes).some((n) => n.type === 'CHECKLIST' && n.examples.some((e) => e.isOther)))
      .map((f) => f.item)
    assert.deepEqual(withOther, [3, 5, 9, 12, 15, 17, 20])
    // Item 5: the Other row sits in the FAIL list.
    assert.equal(checklist(5, 'cl').examples.find((e) => e.isOther)?.group, 'FAIL')
  })

  it('routes match §4', () => {
    const S0 = { score: 0 }
    const S1 = { score: 1 }
    const split = { kind: 'PASS_FAIL_SPLIT', passOnly: S0, failOnlyOrNone: S1, both: 'mo' }
    for (const item of [1, 10, 11, 16]) {
      assert.deepEqual(checklist(item, 'cl').route, split)
      assert.deepEqual(followUpItem(item).nodes.mo, { type: 'MOST_OFTEN', source: 'cl', pass: S0, fail: S1 })
    }
    assert.deepEqual(checklist(2, 'cl').route, { kind: 'ANY_YES', anyYes: S1, noneYes: S0 })
    for (const item of [3, 4, 17, 20]) assert.deepEqual(checklist(item, 'cl').route, { kind: 'ANY_YES', anyYes: S0, noneYes: S1 })
    assert.deepEqual(checklist(5, 'cl').route, { kind: 'FAIL_GROUP_ANY', anyFail: { goto: 'freq' }, noFail: S0 })
    for (const item of [6, 9]) assert.deepEqual(checklist(item, 'cl').route, { kind: 'ANY_YES', anyYes: { goto: 'q1' }, noneYes: S1 })
    assert.deepEqual(checklist(7, 'cl').route, { kind: 'ANY_YES', anyYes: { goto: 'q1' }, noneYes: S1 })
    assert.deepEqual(checklist(8, 'cl').route, { kind: 'ANY_YES', anyYes: { goto: 'freq' }, noneYes: S1 })
    assert.deepEqual(checklist(12, 'cnt').route, {
      kind: 'COUNT_YES',
      bands: [
        { min: 0, max: 1, to: S0 },
        { min: 2, max: null, to: { goto: 'prompt' } },
      ],
    })
    assert.deepEqual(checklist(12, 'cl').route, split)
    assert.deepEqual(checklist(14, 'cnt').route, {
      kind: 'COUNT_YES',
      bands: [
        { min: 0, max: 0, to: S1 },
        { min: 1, max: 1, to: { goto: 'f1' } },
        { min: 2, max: null, to: S0 },
      ],
    })
    assert.deepEqual(checklist(15, 'cnt').route, {
      kind: 'COUNT_YES',
      bands: [
        { min: 0, max: 1, to: S1 },
        { min: 2, max: null, to: S0 },
      ],
    })
    assert.deepEqual(checklist(18, 'cl').route, { kind: 'ANY_YES', anyYes: S0, noneYes: S1 })

    const yn = (item: number, node: string) => {
      const n = followUpItem(item).nodes[node]
      assert.equal(n.type, 'YES_NO')
      return n.type === 'YES_NO' ? { yes: n.yes, no: n.no } : null
    }
    assert.deepEqual(yn(5, 'freq'), { yes: S1, no: S0 })
    assert.deepEqual(yn(6, 'q1'), { yes: S0, no: S1 })
    assert.deepEqual(yn(7, 'q1'), { yes: { goto: 'q2' }, no: S1 })
    assert.deepEqual(yn(8, 'q1'), { yes: S0, no: { goto: 'q2' } })
    assert.deepEqual(yn(8, 'q2'), { yes: { goto: 'prompt' }, no: S1 })
    assert.deepEqual(yn(8, 'freq'), { yes: S0, no: S1 })
    assert.deepEqual(yn(9, 'q1'), { yes: S0, no: S1 })
    assert.deepEqual(yn(13, 'q1'), { yes: S0, no: S1 })
    assert.deepEqual(yn(14, 'f1'), { yes: { goto: 'f2' }, no: S1 })
    assert.deepEqual(yn(14, 'f2'), { yes: S0, no: S1 })
    assert.deepEqual(yn(18, 'q1'), { yes: { goto: 'cl' }, no: { goto: 'q2' } })
    assert.deepEqual(yn(18, 'q2'), { yes: { goto: 'cl' }, no: S1 })
    assert.deepEqual(yn(19, 'q1'), { yes: S0, no: { goto: 'q2' } })
    assert.deepEqual(yn(19, 'q2'), { yes: S0, no: { goto: 'q3' } })
    assert.deepEqual(yn(19, 'q3'), { yes: S0, no: S1 })
    for (const [item, node, next] of [[1, 'prompt', 'cl'], [8, 'prompt', 'cl'], [12, 'prompt', 'cl'], [14, 'prompt', 'cnt'], [15, 'prompt', 'cnt']] as const) {
      assert.deepEqual(followUpItem(item).nodes[node], { type: 'PROMPT', next })
    }
  })

  it('item 7: q2 choice optA → 0, optBoth → 0, optB → 1', () => {
    assert.deepEqual(followUpItem(7).nodes.q2, {
      type: 'CHOICE',
      options: [
        { id: 'optA', to: { score: 0 } },
        { id: 'optBoth', to: { score: 0 } },
        { id: 'optB', to: { score: 1 } },
      ],
    })
  })

  it('frequency thresholds carry `inclusive` (5: > 2/week, 8: > half, 14: ≥ 1/day, ≥ 5/day)', () => {
    const t = (item: number, node: string) => {
      const n = followUpItem(item).nodes[node]
      return n.type === 'YES_NO' ? { role: n.role, threshold: n.threshold } : null
    }
    assert.deepEqual(t(5, 'freq'), { role: 'FREQUENCY', threshold: { count: 2, per: 'WEEK', inclusive: false } })
    assert.deepEqual(t(8, 'freq'), { role: 'FREQUENCY', threshold: { count: 1, per: 'HALF_OF_OCCASIONS', inclusive: false } })
    assert.deepEqual(t(14, 'f1'), { role: 'FREQUENCY', threshold: { count: 1, per: 'DAY', inclusive: true } })
    assert.deepEqual(t(14, 'f2'), { role: 'FREQUENCY', threshold: { count: 5, per: 'DAY', inclusive: true } })
  })

  it('every yes/no question allows "maybe"; only item 18 stops at the first yes', () => {
    for (const f of MCHAT_RF_STRUCTURE.followUp) {
      for (const n of [...Object.values(f.nodes), ...Object.values(f.supplementary?.nodes ?? {})]) {
        if (n.type === 'YES_NO') assert.equal(n.allowMaybe, true)
        if (n.type === 'CHECKLIST') assert.equal(n.askMode, f.item === 18 ? 'UNTIL_FIRST_YES' : 'EACH', `item ${f.item}`)
      }
    }
  })

  it('item 2 has the only supplementary graph: s1 yes → s2 (3 options) → end, no → end; unscored', () => {
    const withSupp = MCHAT_RF_STRUCTURE.followUp.filter((f) => f.supplementary).map((f) => f.item)
    assert.deepEqual(withSupp, [2])
    const supp = followUpItem(2).supplementary!
    assert.equal(supp.entry, 's1')
    assert.equal(supp.scored, false)
    const s1 = supp.nodes.s1
    assert.ok(s1.type === 'YES_NO')
    assert.deepEqual([s1.yes, s1.no], [{ goto: 's2' }, { end: true }])
    const s2 = supp.nodes.s2
    assert.ok(s2.type === 'CHOICE')
    assert.deepEqual(s2.options, [
      { id: 'r1', to: { end: true } },
      { id: 'r2', to: { end: true } },
      { id: 'r3', to: { end: true } },
    ])
  })

  it('item 7 alone has the preamble after item 6', () => {
    for (const f of MCHAT_RF_STRUCTURE.followUp) {
      assert.deepEqual(f.preambles, f.item === 7 ? [{ id: 'after6', whenFollowUpJustAdministered: 6 }] : [])
    }
  })

  it('every node is reachable, graphs are acyclic, scores only in the main graph, end only in supplementary', () => {
    const check = (f: FollowUpItemStructure) => {
      assert.deepEqual([...reachable(f.nodes, f.entry)].sort(), Object.keys(f.nodes).sort(), `item ${f.item}`)
      for (const n of Object.values(f.nodes)) {
        for (const t of targetsOf(n)) assert.ok(!('end' in t), `item ${f.item}: end in main graph`)
        if (n.type === 'MOST_OFTEN') {
          const source = f.nodes[n.source]
          assert.ok(source.type === 'CHECKLIST' && source.route.kind === 'PASS_FAIL_SPLIT')
        }
      }
      const scores = Object.values(f.nodes).flatMap(targetsOf).filter((t) => 'score' in t)
      assert.ok(scores.length > 0)
      if (f.supplementary) {
        const supp = f.supplementary.nodes
        assert.deepEqual([...reachable(supp, f.supplementary.entry)].sort(), Object.keys(supp).sort())
        for (const t of Object.values(supp).flatMap(targetsOf)) assert.ok(!('score' in t), `item ${f.item}: score in supplementary`)
      }
    }
    MCHAT_RF_STRUCTURE.followUp.forEach(check)
  })

  it('holds ids and enums only (no wording)', () => {
    const strings: string[] = []
    const collect = (v: unknown) => {
      if (typeof v === 'string') strings.push(v)
      else if (v && typeof v === 'object') Object.values(v).forEach(collect)
    }
    collect(MCHAT_RF_STRUCTURE)
    for (const s of strings) assert.match(s, /^[A-Za-z0-9_.-]{1,32}$/, s)
    const keys: string[] = canonicalJson(MCHAT_RF_STRUCTURE).match(/"(\w+)":/g) ?? []
    for (const banned of ['"text":', '"label":', '"wording":', '"question":']) assert.ok(!keys.includes(banned), banned)
  })

  it('is deeply frozen', () => {
    assert.ok(Object.isFrozen(MCHAT_RF_STRUCTURE))
    assert.ok(Object.isFrozen(MCHAT_RF_STRUCTURE.followUp[0].nodes))
    assert.ok(Object.isFrozen(checklist(1, 'cl').examples[0]))
  })
})

describe('structureHash', () => {
  it('is a stable 16-hex snapshot', () => {
    assert.match(structureHash(), /^[0-9a-f]{16}$/)
    assert.equal(structureHash(), structureHash())
    assert.equal(structureHash(), EXPECTED_HASH)
  })

  it('canonical JSON sorts object keys but keeps array order', () => {
    assert.equal(canonicalJson({ b: 1, a: [2, 1], c: { y: null, x: 'v' } }), '{"a":[2,1],"b":1,"c":{"x":"v","y":null}}')
    assert.equal(canonicalJson({ a: 1, b: 2 }), canonicalJson({ b: 2, a: 1 }))
  })

  it('changes when any routing detail changes', () => {
    const hash = (v: unknown) => createHash('sha256').update(canonicalJson(v)).digest('hex').slice(0, 16)
    assert.equal(hash(MCHAT_RF_STRUCTURE), EXPECTED_HASH)
    const clone = JSON.parse(JSON.stringify(MCHAT_RF_STRUCTURE))
    clone.followUp[4].nodes.freq.threshold.inclusive = true
    assert.notEqual(hash(clone), EXPECTED_HASH)
    const reordered = JSON.parse(JSON.stringify(MCHAT_RF_STRUCTURE))
    reordered.followUp[0].nodes.cl.examples.reverse()
    assert.notEqual(hash(reordered), EXPECTED_HASH)
  })
})
