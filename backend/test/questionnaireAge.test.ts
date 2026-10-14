import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  addMonthsClamped,
  ageInCompletedMonths,
  mchatEligibility,
  secondBirthday,
  vnCalendarDate,
} from '../src/lib/questionnaires/age'
import { outcomeAfterStage1 } from '../src/lib/questionnaires/mchatRf'

const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
/** Midday in Vietnam on that calendar date. */
const vnNoon = (iso: string) => new Date(`${iso}T05:00:00.000Z`)

describe('vnCalendarDate', () => {
  it('uses UTC+7 without daylight saving', () => {
    assert.deepEqual(vnCalendarDate(new Date('2026-06-27T16:59:59.999Z')), { y: 2026, m: 6, d: 27 })
    assert.deepEqual(vnCalendarDate(new Date('2026-06-27T17:00:00.000Z')), { y: 2026, m: 6, d: 28 })
    assert.deepEqual(vnCalendarDate(new Date('2025-12-31T17:30:00.000Z')), { y: 2026, m: 1, d: 1 })
  })
})

describe('mchatEligibility', () => {
  const DOB = utc('2025-02-28')

  it('16 months on the month anniversary → eligible', () => {
    const e = mchatEligibility(DOB, new Date('2026-06-28T05:00:00.000Z'))
    assert.equal(e.ageMonths, 16)
    assert.equal(e.eligible, true)
    assert.equal(e.reason, null)
    assert.equal(e.eligibleFrom, '2026-06-28')
  })

  it('the day before → 15 months, TOO_YOUNG with eligibleFrom', () => {
    const e = mchatEligibility(DOB, vnNoon('2026-06-27'))
    assert.equal(e.ageMonths, 15)
    assert.equal(e.eligible, false)
    assert.equal(e.reason, 'TOO_YOUNG')
    assert.equal(e.eligibleFrom, '2026-06-28')
  })

  it('30 months 29 days → 30, still eligible', () => {
    const e = mchatEligibility(DOB, vnNoon('2027-09-26'))
    assert.equal(e.ageMonths, 30)
    assert.equal(e.eligible, true)
    assert.equal(e.eligibleUntil, '2027-09-27')
    assert.equal(mchatEligibility(DOB, vnNoon('2027-09-27')).eligible, true)
  })

  it('31 months → TOO_OLD', () => {
    const e = mchatEligibility(DOB, vnNoon('2027-09-28'))
    assert.equal(e.ageMonths, 31)
    assert.equal(e.eligible, false)
    assert.equal(e.reason, 'TOO_OLD')
  })

  it('00:30 in Vietnam already counts as the new day', () => {
    // 2026-06-27T17:30Z is 2026-06-28 00:30 in Vietnam.
    assert.equal(ageInCompletedMonths(DOB, new Date('2026-06-27T17:30:00.000Z')), 16)
    assert.equal(mchatEligibility(DOB, new Date('2026-06-27T17:30:00.000Z')).eligible, true)
    assert.equal(ageInCompletedMonths(DOB, new Date('2026-06-27T16:30:00.000Z')), 15)
  })

  it('a child born on 29 February', () => {
    const leap = utc('2024-02-29')
    assert.equal(mchatEligibility(leap, vnNoon('2025-01-01')).eligibleFrom, '2025-06-29')
    assert.equal(secondBirthday(leap).toISOString(), '2026-02-28T00:00:00.000Z')
    assert.equal(ageInCompletedMonths(leap, vnNoon('2026-02-27')), 23)
    assert.equal(ageInCompletedMonths(leap, vnNoon('2026-02-28')), 24)
  })
})

describe('ageInCompletedMonths / addMonthsClamped', () => {
  it('follows (y2−y1)·12 + (m2−m1) − (day not reached)', () => {
    const dob = utc('2024-05-10')
    assert.equal(ageInCompletedMonths(dob, vnNoon('2024-05-10')), 0)
    assert.equal(ageInCompletedMonths(dob, vnNoon('2025-05-09')), 11)
    assert.equal(ageInCompletedMonths(dob, vnNoon('2025-05-10')), 12)
    assert.equal(ageInCompletedMonths(dob, vnNoon('2026-01-31')), 20)
  })

  it('clamps the day to the target month', () => {
    assert.equal(addMonthsClamped(utc('2024-01-31'), 1), '2024-02-29')
    assert.equal(addMonthsClamped(utc('2023-01-31'), 1), '2023-02-28')
    assert.equal(addMonthsClamped(utc('2024-10-31'), 16), '2026-02-28')
    assert.equal(addMonthsClamped(utc('2024-12-15'), 14), '2026-02-15')
  })

  it('the age is exactly k on DOB + k months and k−1 the day before (month-end births too)', () => {
    for (const dobIso of ['2024-01-31', '2024-02-29', '2024-03-30', '2024-08-31', '2025-02-28', '2024-11-15']) {
      const dob = utc(dobIso)
      for (let k = 1; k <= 36; k++) {
        const anniversary = utc(addMonthsClamped(dob, k))
        assert.equal(ageInCompletedMonths(dob, new Date(anniversary.getTime() - 7 * 3600_000)), k, `${dobIso} +${k}`)
        assert.equal(ageInCompletedMonths(dob, new Date(anniversary.getTime() - 7 * 3600_000 - 1)), k - 1, `${dobIso} +${k} −1ms`)
      }
    }
  })

  it('eligibleFrom / eligibleUntil agree with the age on those days', () => {
    for (const dobIso of ['2024-01-31', '2024-02-29', '2024-07-31', '2025-02-28']) {
      const dob = utc(dobIso)
      const e = mchatEligibility(dob, vnNoon('2025-01-01'))
      assert.equal(mchatEligibility(dob, vnNoon(e.eligibleFrom)).ageMonths, 16, dobIso)
      assert.equal(mchatEligibility(dob, vnNoon(e.eligibleUntil)).ageMonths, 30, dobIso)
      const after = new Date(utc(e.eligibleUntil).getTime() + 24 * 3600_000)
      assert.equal(mchatEligibility(dob, vnNoon(after.toISOString().slice(0, 10))).reason, 'TOO_OLD', dobIso)
    }
  })
})

describe('rescreenAfter', () => {
  const dob = utc('2025-01-20')

  it('is the second birthday for a LOW result before 24 months', () => {
    const r = outcomeAfterStage1('LOW', 20, dob)
    assert.equal(r.rescreenAfter?.toISOString(), '2027-01-20T00:00:00.000Z')
    assert.equal(outcomeAfterStage1('LOW', 23, dob).rescreenAfter?.toISOString(), '2027-01-20T00:00:00.000Z')
  })

  it('is null from 24 months on, and for MODERATE or HIGH', () => {
    assert.equal(outcomeAfterStage1('LOW', 24, dob).rescreenAfter, null)
    assert.equal(outcomeAfterStage1('MODERATE', 18, dob).rescreenAfter, null)
    assert.equal(outcomeAfterStage1('HIGH', 18, dob).rescreenAfter, null)
  })
})
