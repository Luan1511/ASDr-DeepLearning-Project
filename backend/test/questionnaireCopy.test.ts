import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { QuestionnaireResponse } from '@prisma/client'
import * as copy from '../src/lib/questionnaires/copy'
import { mchatEligibility } from '../src/lib/questionnaires/age'
import { FOLLOW_UP_SOURCES, MCHAT_RF, RESPONDENTS } from '../src/lib/questionnaires/mchatRf'
import { buildQuestionnaireConsentStatement } from '../src/lib/consent'
import { serializeQuestionnaireResponse } from '../src/lib/questionnaireSerializers'

const BANNED_WORDS = ['chẩn đoán', 'mắc', 'bị tự kỷ', 'dương tính']

function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value)
  else if (Array.isArray(value)) value.forEach((v) => collectStrings(v, out))
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => collectStrings(v, out))
  return out
}

/** Every user-facing string the module can produce, except DISCLAIMER. */
function allCopy(): string[] {
  const { DISCLAIMER: _disclaimer, ...rest } = copy
  const strings = collectStrings(Object.values(rest).filter((v) => typeof v !== 'function'))
  const rescreenAfter = new Date('2027-01-20T00:00:00.000Z')
  for (const afterFollowUp of [false, true]) {
    for (const outcome of ['SCREEN_NEGATIVE', 'FOLLOW_UP_NEEDED', 'REFER'] as const) {
      for (const r of [null, rescreenAfter]) {
        for (const inAppAvailable of [false, true]) {
          collectStrings(copy.outcomeCopy(outcome, { afterFollowUp, rescreenAfter: r, followUpItems: [1, 3, 9], inAppAvailable }), strings)
        }
      }
    }
  }
  strings.push(copy.tooYoungMessage(12, '2026-06-28'), copy.tooYoungMessage(-1, '2026-06-28'), copy.tooOldMessage(34))
  const dob = new Date('2025-02-28T00:00:00.000Z')
  for (const at of ['2026-01-10', '2026-08-10', '2028-01-10']) {
    const message = copy.ageGateMessage(mchatEligibility(dob, new Date(`${at}T05:00:00.000Z`)))
    if (message) strings.push(message)
  }
  strings.push(copy.scoreLine(7), ...RESPONDENTS.map(copy.respondentLine))
  return strings
}

function containsWord(text: string, word: string): boolean {
  const escaped = word.normalize('NFC').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'iu').test(text.normalize('NFC'))
}

describe('questionnaire copy', () => {
  const strings = allCopy()

  it('covers the constants and every rendered variant', () => {
    assert.ok(strings.length > 30)
    assert.ok(strings.includes(copy.QUESTIONNAIRE_TITLE))
    assert.ok(strings.includes(copy.DISABLED_MESSAGE))
  })

  it('never frames items as passed/failed ("đạt" / "chưa đạt" / "không đạt")', () => {
    for (const text of strings) assert.ok(!containsWord(text, 'đạt'), text)
  })

  it('the word matcher is case-insensitive and respects word edges', () => {
    assert.ok(containsWord('Kết quả DƯƠNG TÍNH.', 'dương tính'))
    assert.ok(containsWord('không phải chẩn đoán', 'chẩn đoán'))
    assert.ok(!containsWord('mắcx', 'mắc'))
    assert.ok(!containsWord(copy.DASHBOARD_NOTE, 'mắc'))
  })

  it('has no diagnostic wording outside DISCLAIMER', () => {
    for (const text of strings) {
      for (const word of BANNED_WORDS) assert.ok(!containsWord(text, word), `"${word}" in: ${text}`)
    }
  })

  it('has no percentages', () => {
    for (const text of strings) {
      assert.ok(!text.includes('%'), text)
      assert.ok(!/\d\s*%/.test(text), text)
    }
  })

  it('has no long question-like string (guards against pasted item wording)', () => {
    for (const text of [...strings, copy.DISCLAIMER]) {
      assert.ok(!(text.trim().length > 40 && text.trim().endsWith('?')), text)
    }
  })

  it('DISCLAIMER negates diagnosis', () => {
    assert.ok(copy.DISCLAIMER.includes('không phải chẩn đoán'))
  })

  it('carries the copyright line and the official source', () => {
    assert.ok(copy.COPYRIGHT_NOTICE.startsWith(MCHAT_RF.copyright))
    assert.ok(copy.COPYRIGHT_NOTICE.includes('mchatscreen.com'))
    assert.match(MCHAT_RF.copyright, /© 2009 Diana Robins, Deborah Fein, & Marianne Barton/)
  })

  it('labels every respondent and follow-up source', () => {
    for (const r of RESPONDENTS) assert.ok(copy.RESPONDENT_LABEL[r])
    for (const s of FOLLOW_UP_SOURCES) assert.ok(copy.FOLLOW_UP_SOURCE_LABEL[s])
  })

  it('outcome copy follows the result', () => {
    const base = { afterFollowUp: false, rescreenAfter: null, followUpItems: [] }
    assert.equal(copy.outcomeCopy('REFER', base).title, 'Khả năng cao')
    assert.equal(copy.outcomeCopy('SCREEN_NEGATIVE', base).title, 'Khả năng thấp')
    assert.equal(copy.outcomeCopy('SCREEN_NEGATIVE', { ...base, afterFollowUp: true }).title, 'Sau phần hỏi thêm: khả năng thấp')
    const followUp = copy.outcomeCopy('FOLLOW_UP_NEEDED', { ...base, followUpItems: [3, 9, 14] })
    assert.ok(followUp.body.join(' ').includes('các câu số 3, 9, 14'))
    assert.ok(followUp.body.join(' ').includes('vẫn được tính điểm sau phần hỏi thêm'))
    const afterNegative = copy.outcomeCopy('SCREEN_NEGATIVE', {
      ...base,
      afterFollowUp: true,
      rescreenAfter: new Date('2027-03-05T00:00:00.000Z'),
    })
    assert.ok(afterNegative.body.join(' ').includes('05/03/2027'), 'Follow-Up negative before 24 months → rescreen date')
    const rescreen = copy.outcomeCopy('SCREEN_NEGATIVE', { ...base, rescreenAfter: new Date('2027-01-20T00:00:00.000Z') })
    assert.ok(rescreen.body.join(' ').includes('20/01/2027'))
    assert.ok(!copy.outcomeCopy('SCREEN_NEGATIVE', base).body.join(' ').includes('sinh nhật 2 tuổi'))
  })

  it('age gate messages', () => {
    assert.ok(copy.tooYoungMessage(12, '2026-06-28').includes('28/06/2026'))
    assert.ok(copy.tooOldMessage(34).includes('34 tháng'))
    const dob = new Date('2025-02-28T00:00:00.000Z')
    assert.equal(copy.ageGateMessage(mchatEligibility(dob, new Date('2026-08-10T05:00:00.000Z'))), null)
  })
})

describe('serializeQuestionnaireResponse', () => {
  const now = new Date('2026-10-06T03:00:00.000Z')
  const row: QuestionnaireResponse = {
    id: '00000000-0000-4000-8000-000000000001',
    userId: '00000000-0000-4000-8000-000000000002',
    childId: '00000000-0000-4000-8000-000000000003',
    instrument: 'MCHAT_RF',
    structureVersion: MCHAT_RF.structureVersion,
    scoringVersion: MCHAT_RF.scoringVersion,
    mode: 'OFFICIAL_FORM_ENTRY',
    contentVersion: null,
    respondent: 'MOTHER',
    childAgeMonths: 20,
    answers: { '1': false, '2': true },
    totalScore: 4,
    band: 'MODERATE',
    failedItems: [14, 1, 2, 3],
    followUpStatus: 'PENDING',
    followUpSource: null,
    followUpFailedItems: [],
    followUpFailCount: null,
    followUpAnswers: null,
    followUpCompletedAt: null,
    outcome: 'FOLLOW_UP_NEEDED',
    rescreenAfter: null,
    consentVersion: 'questionnaire-2026-10-07',
    consentStatement: buildQuestionnaireConsentStatement() as unknown as QuestionnaireResponse['consentStatement'],
    consentedAt: now,
    completedAt: now,
    createdAt: now,
    updatedAt: now,
  }

  it('never outputs answers, the owner or the consent snapshot', () => {
    const dto = serializeQuestionnaireResponse(row) as Record<string, unknown>
    for (const key of ['answers', 'userId', 'consentStatement', 'consentVersion', 'consentedAt']) {
      assert.ok(!(key in dto), key)
    }
    assert.ok(!JSON.stringify(dto).includes('"answers"'))
  })

  it('lists item numbers only while a MODERATE follow-up is pending', () => {
    const pending = serializeQuestionnaireResponse(row)
    assert.deepEqual(pending.failedItems, [1, 2, 3, 14])
    assert.equal(pending.actions.title, 'Khả năng trung bình — cần làm phần hỏi thêm')
    assert.equal(pending.disclaimer, copy.DISCLAIMER)
    assert.equal(pending.copyright, copy.COPYRIGHT_NOTICE)

    const done = serializeQuestionnaireResponse({
      ...row,
      followUpStatus: 'COMPLETED',
      followUpSource: 'HEALTH_WORKER',
      followUpFailedItems: [3, 1],
      followUpFailCount: 2,
      followUpCompletedAt: now,
      outcome: 'REFER',
    })
    assert.deepEqual(done.failedItems, [])
    assert.deepEqual(done.followUpFailedItems, [1, 3])
    assert.equal(done.actions.title, 'Khả năng cao')

    const high = serializeQuestionnaireResponse({
      ...row,
      band: 'HIGH',
      totalScore: 9,
      followUpStatus: 'NOT_APPLICABLE',
      outcome: 'REFER',
    })
    assert.deepEqual(high.failedItems, [])
  })

  it('dates are ISO strings', () => {
    const dto = serializeQuestionnaireResponse({
      ...row,
      band: 'LOW',
      followUpStatus: 'NOT_NEEDED',
      outcome: 'SCREEN_NEGATIVE',
      rescreenAfter: new Date('2027-01-20T00:00:00.000Z'),
    })
    assert.equal(dto.rescreenAfter, '2027-01-20T00:00:00.000Z')
    assert.equal(dto.completedAt, now.toISOString())
    assert.ok(dto.actions.body.join(' ').includes('20/01/2027'))
  })
})
