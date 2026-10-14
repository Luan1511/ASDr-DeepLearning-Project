import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  AnswersInvalidError,
  FollowUpError,
  ITEM_NUMBERS,
  MCHAT_RF,
  answersToJson,
  applyFollowUp,
  bandForTotal,
  outcomeAfterStage1,
  parseAnswers,
  rescreenAfterFollowUp,
  scoreStage1,
  type Answers,
} from '../src/lib/questionnaires/mchatRf'

// Synthetic vectors keyed by item number only (true = "Có").
function vector(no: number[] = [], yes: number[] = []): Answers {
  const answers: Answers = {}
  for (const n of ITEM_NUMBERS) answers[n] = !no.includes(n)
  for (const n of yes) answers[n] = true
  return answers
}

/** "Có" everywhere except items 2, 5, 12: the vector that scores 0. */
const TYPICAL = vector([2, 5, 12])
const ALL_NO = vector([...ITEM_NUMBERS])
const ALL_YES = vector()
const NOT_ELEVATED_ON_YES = ITEM_NUMBERS.filter((n) => ![2, 5, 12].includes(n))

function typicalPlus(failing: number[]): Answers {
  const answers = { ...TYPICAL }
  for (const n of failing) answers[n] = [2, 5, 12].includes(n)
  return answers
}

function toRaw(answers: Answers): Record<string, unknown> {
  return Object.fromEntries(Object.entries(answers).map(([k, v]) => [k, v]))
}

const DOB = new Date('2025-01-15T00:00:00.000Z')

describe('MCHAT_RF structure', () => {
  it('is frozen and holds item numbers, scoring rules and links only', () => {
    assert.ok(Object.isFrozen(MCHAT_RF))
    assert.ok(Object.isFrozen(MCHAT_RF.bands))
    assert.ok(Object.isFrozen(MCHAT_RF.ageMonths))
    assert.equal(MCHAT_RF.itemCount, 20)
    assert.deepEqual([...MCHAT_RF.elevatedOnYes], [2, 5, 12])
    assert.deepEqual(ITEM_NUMBERS, Array.from({ length: 20 }, (_, i) => i + 1))
  })

  it('bands cover 0..20 without gaps', () => {
    for (let total = 0; total <= 20; total++) assert.ok(bandForTotal(total))
    assert.throws(() => bandForTotal(21), RangeError)
    assert.throws(() => bandForTotal(-1), RangeError)
  })
})

describe('scoreStage1', () => {
  it('scores the typical vector 0, LOW', () => {
    const r = scoreStage1(TYPICAL)
    assert.equal(r.total, 0)
    assert.equal(r.band, 'LOW')
    assert.deepEqual(r.failedItems, [])
    assert.ok(Object.values(r.itemScores).every((s) => s === 0))
  })

  it('"Có" on items 2, 5 and 12 each adds one point', () => {
    for (const n of [2, 5, 12]) {
      const r = scoreStage1(vector([2, 5, 12].filter((m) => m !== n)))
      assert.equal(r.total, 1, `item ${n}`)
      assert.deepEqual(r.failedItems, [n])
      assert.equal(r.itemScores[n], 1)
    }
  })

  it('"Không" on any other item adds one point', () => {
    for (const n of NOT_ELEVATED_ON_YES) {
      const r = scoreStage1(typicalPlus([n]))
      assert.equal(r.total, 1, `item ${n}`)
      assert.deepEqual(r.failedItems, [n])
    }
  })

  it('all "Không" → 17, HIGH', () => {
    const r = scoreStage1(ALL_NO)
    assert.equal(r.total, 17)
    assert.equal(r.band, 'HIGH')
    assert.deepEqual(r.failedItems, NOT_ELEVATED_ON_YES)
  })

  it('all "Có" → 3, MODERATE', () => {
    const r = scoreStage1(ALL_YES)
    assert.equal(r.total, 3)
    assert.equal(r.band, 'MODERATE')
    assert.deepEqual(r.failedItems, [2, 5, 12])
  })

  it('band boundaries: 2 LOW, 3 MODERATE, 7 MODERATE, 8 HIGH', () => {
    const cases: Array<[number[], string]> = [
      [[1, 3], 'LOW'],
      [[1, 2, 3], 'MODERATE'],
      [[1, 2, 3, 4, 5, 6, 7], 'MODERATE'],
      [[1, 2, 3, 4, 5, 6, 7, 8], 'HIGH'],
    ]
    for (const [failing, band] of cases) {
      const r = scoreStage1(typicalPlus(failing))
      assert.equal(r.total, failing.length)
      assert.equal(r.band, band)
      assert.deepEqual(r.failedItems, failing)
    }
  })

  it('rejects an incomplete answer set', () => {
    const answers = { ...TYPICAL }
    delete answers[20]
    assert.throws(() => scoreStage1(answers), AnswersInvalidError)
  })
})

describe('parseAnswers', () => {
  it('accepts exactly "1".."20" with boolean values', () => {
    const parsed = parseAnswers(toRaw(TYPICAL))
    assert.deepEqual(parsed, TYPICAL)
    assert.deepEqual(Object.keys(answersToJson(parsed)), ITEM_NUMBERS.map(String))
  })

  it('reports a missing item by number', () => {
    const raw = toRaw(TYPICAL)
    delete raw['7']
    assert.throws(
      () => parseAnswers(raw),
      (err: unknown) => err instanceof AnswersInvalidError && err.invalid.length === 0 && err.missing.join() === '7',
    )
  })

  it('reports several missing items in order', () => {
    const raw = toRaw(TYPICAL)
    delete raw['20']
    delete raw['3']
    assert.throws(
      () => parseAnswers(raw),
      (err: unknown) => err instanceof AnswersInvalidError && err.missing.join() === '3,20',
    )
  })

  it('rejects unknown keys', () => {
    for (const key of ['21', '0', '01', 'x', '1.0']) {
      assert.throws(
        () => parseAnswers({ ...toRaw(TYPICAL), [key]: true }),
        (err: unknown) => err instanceof AnswersInvalidError && err.invalid.includes(key),
        key,
      )
    }
  })

  it('rejects non-boolean values without reporting the item as missing', () => {
    for (const value of ['MAYBE', 'true', 1, null]) {
      assert.throws(
        () => parseAnswers({ ...toRaw(TYPICAL), '4': value }),
        (err: unknown) => err instanceof AnswersInvalidError && err.invalid.join() === '4' && err.missing.length === 0,
        String(value),
      )
    }
  })

  it('rejects non-objects', () => {
    for (const raw of [null, undefined, 'x', 3, [true, false]]) {
      assert.throws(() => parseAnswers(raw), AnswersInvalidError)
    }
  })
})

describe('outcomeAfterStage1', () => {
  it('LOW → SCREEN_NEGATIVE / NOT_NEEDED', () => {
    const r = outcomeAfterStage1('LOW', 26, DOB)
    assert.equal(r.outcome, 'SCREEN_NEGATIVE')
    assert.equal(r.followUpStatus, 'NOT_NEEDED')
    assert.equal(r.rescreenAfter, null)
  })

  it('MODERATE → FOLLOW_UP_NEEDED / PENDING', () => {
    const r = outcomeAfterStage1('MODERATE', 20, DOB)
    assert.equal(r.outcome, 'FOLLOW_UP_NEEDED')
    assert.equal(r.followUpStatus, 'PENDING')
    assert.equal(r.rescreenAfter, null)
  })

  it('HIGH → REFER / NOT_APPLICABLE', () => {
    const r = outcomeAfterStage1('HIGH', 20, DOB)
    assert.equal(r.outcome, 'REFER')
    assert.equal(r.followUpStatus, 'NOT_APPLICABLE')
    assert.equal(r.rescreenAfter, null)
  })
})

describe('rescreenAfterFollowUp', () => {
  it('a negative Follow-Up before 24 months → after the second birthday; otherwise none', () => {
    const dob = new Date('2025-03-15T00:00:00.000Z')
    assert.equal(rescreenAfterFollowUp('SCREEN_NEGATIVE', 20, dob)?.toISOString(), '2027-03-15T00:00:00.000Z')
    assert.equal(rescreenAfterFollowUp('SCREEN_NEGATIVE', 23, dob)?.toISOString(), '2027-03-15T00:00:00.000Z')
    assert.equal(rescreenAfterFollowUp('SCREEN_NEGATIVE', 24, dob), null)
    assert.equal(rescreenAfterFollowUp('SCREEN_NEGATIVE', 28, dob), null)
    assert.equal(rescreenAfterFollowUp('REFER', 20, dob), null)
    assert.equal(rescreenAfterFollowUp('FOLLOW_UP_NEEDED', 20, dob), null)
    // Same date as a LOW result at stage 1.
    assert.equal(
      rescreenAfterFollowUp('SCREEN_NEGATIVE', 18, dob)?.toISOString(),
      outcomeAfterStage1('LOW', 18, dob).rescreenAfter?.toISOString(),
    )
  })
})

describe('applyFollowUp', () => {
  const pending = { band: 'MODERATE' as const, followUpStatus: 'PENDING' as const, failedItems: [1, 3, 9, 14] }

  it('0 or 1 item still failing → SCREEN_NEGATIVE', () => {
    assert.deepEqual(applyFollowUp(pending, []), { followUpFailedItems: [], followUpFailCount: 0, outcome: 'SCREEN_NEGATIVE' })
    assert.deepEqual(applyFollowUp(pending, [9]), {
      followUpFailedItems: [9],
      followUpFailCount: 1,
      outcome: 'SCREEN_NEGATIVE',
    })
  })

  it('2 or more items still failing → REFER (sorted)', () => {
    assert.deepEqual(applyFollowUp(pending, [14, 3]), {
      followUpFailedItems: [3, 14],
      followUpFailCount: 2,
      outcome: 'REFER',
    })
    assert.equal(applyFollowUp(pending, [1, 3, 9, 14]).outcome, 'REFER')
  })

  it('rejects items outside failedItems, duplicates and non-integers', () => {
    for (const items of [[2], [3, 3], [21], [1.5], [Number.NaN]]) {
      assert.throws(
        () => applyFollowUp(pending, items),
        (err: unknown) => err instanceof FollowUpError && err.code === 'FOLLOW_UP_ITEMS_INVALID',
        JSON.stringify(items),
      )
    }
  })

  it('only applies to a pending MODERATE result', () => {
    const cases = [
      { band: 'LOW' as const, followUpStatus: 'NOT_NEEDED' as const, failedItems: [1] },
      { band: 'HIGH' as const, followUpStatus: 'NOT_APPLICABLE' as const, failedItems: [1, 2, 3, 4, 5, 6, 7, 8] },
      { band: 'MODERATE' as const, followUpStatus: 'COMPLETED' as const, failedItems: [1, 3, 9] },
    ]
    for (const r of cases) {
      assert.throws(
        () => applyFollowUp(r, []),
        (err: unknown) => err instanceof FollowUpError && err.code === 'FOLLOW_UP_NOT_APPLICABLE',
        `${r.band}/${r.followUpStatus}`,
      )
    }
  })
})
