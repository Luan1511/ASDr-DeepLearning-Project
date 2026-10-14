/**
 * M-CHAT-R/F entry-mode end-to-end scenarios, spec §7.2 "Questionnaire scenarios" 1–5.
 * Answers are synthetic vectors keyed by item number only (no item wording anywhere).
 *
 * Run: npx tsx --test --test-concurrency=1 test/e2e/questionnaire.e2e.ts
 */
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { QUESTIONNAIRE_CONSENT_VERSION } from '../../src/lib/consent'
import { secondBirthday } from '../../src/lib/questionnaires/age'
import { E2eHarness, api, type SeededUser } from './harness'

const h = new E2eHarness('questionnaire')
let parentA: SeededUser
let parentB: SeededUser
let admin: SeededUser

before(async () => {
  await h.setup()
  parentA = h.users.parentA
  parentB = h.users.parentB
  admin = h.users.admin
}, { timeout: 300_000 })

after(async () => {
  await h.teardown()
}, { timeout: 120_000 })

function scenario(name: string, fn: () => Promise<void>) {
  test(name, { timeout: 120_000 }, async () => {
    try {
      await fn()
    } catch (error) {
      if (error instanceof Error) error.message += `\n--- backend log tail ---\n${h.backendLog.slice(-20).join('\n')}`
      throw error
    }
  })
}

/** true = "Có". `atRisk` lists the items answered the at-risk way (Có on 2/5/12, Không elsewhere). */
function answers(atRisk: number[] = []): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  for (let i = 1; i <= 20; i += 1) {
    const typical = ![2, 5, 12].includes(i)
    out[String(i)] = atRisk.includes(i) ? !typical : typical
  }
  return out
}

const ALL_ITEMS = Array.from({ length: 20 }, (_, i) => i + 1)

function submit(user: SeededUser, childId: string, body: Record<string, unknown> = {}) {
  return api('POST', `/children/${childId}/questionnaires`, {
    token: user.token,
    json: {
      instrument: 'MCHAT_RF',
      respondent: 'MOTHER',
      answers: answers(),
      consentAccepted: true,
      consentVersion: QUESTIONNAIRE_CONSENT_VERSION,
      ...body,
    },
  })
}

/** The parent-facing JSON must never carry the stored answers, the consent snapshot or owner ids. */
function assertNoAnswers(payload: unknown) {
  const text = JSON.stringify(payload)
  assert.ok(!text.includes('"answers"'), 'response JSON contains answers')
  assert.ok(!text.includes('"consentStatement"'), 'response JSON contains the consent snapshot')
  assert.ok(!text.includes('"userId"'), 'response JSON contains userId')
}

scenario('1. MCHAT_MODE=off → 503 on POST/statement/follow-up; stored responses stay readable and deletable', async () => {
  await h.startBackend({ env: { MCHAT_MODE: 'off' } })
  const child = await h.createChild(parentA, 'Q1', 20)

  const list = await api('GET', '/questionnaires', { token: parentA.token })
  assert.equal(list.status, 200)
  assert.equal(list.body.enabled, false)
  assert.equal(list.body.instruments[0].code, 'MCHAT_RF')
  assert.equal(list.body.instruments[0].mode, 'OFFICIAL_FORM_ENTRY')
  assert.match(list.body.instruments[0].copyright, /Robins/)

  const post = await submit(parentA, child.id)
  assert.equal(post.status, 503)
  assert.equal(post.body.error, 'QUESTIONNAIRE_DISABLED')
  assert.ok(post.body.message)
  const statement = await api('GET', '/questionnaires/consent-statement', { token: parentA.token })
  assert.equal(statement.status, 503)
  assert.equal(statement.body.error, 'QUESTIONNAIRE_DISABLED')
  // The child's list stays readable (read-only access to the parent's own data).
  const childList = await api('GET', `/children/${child.id}/questionnaires`, { token: parentA.token })
  assert.equal(childList.status, 200)
  assert.deepEqual(childList.body.responses, [])
  assert.equal(await h.prisma.questionnaireResponse.count(), 0)

  // A response stored while the mode was on can still be deleted by its parent.
  const stored = await h.prisma.questionnaireResponse.create({
    data: {
      userId: parentA.id,
      childId: child.id,
      instrument: 'MCHAT_RF',
      structureVersion: 'mchat-rf-2025-03',
      scoringVersion: 'mchat-rf-scoring-v1',
      mode: 'OFFICIAL_FORM_ENTRY',
      respondent: 'MOTHER',
      childAgeMonths: 20,
      answers: answers(),
      totalScore: 0,
      band: 'LOW',
      failedItems: [],
      followUpStatus: 'NOT_NEEDED',
      followUpFailedItems: [],
      outcome: 'SCREEN_NEGATIVE',
      consentVersion: QUESTIONNAIRE_CONSENT_VERSION,
      consentStatement: { e2e: true },
      consentedAt: new Date(),
    },
  })
  // A response stored while the mode was on stays readable but cannot be changed.
  const read = await api('GET', `/questionnaire-responses/${stored.id}`, { token: parentA.token })
  assert.equal(read.status, 200)
  assert.equal(read.body.response.id, stored.id)
  assert.equal(read.body.response.answers, undefined)
  const listed = await api('GET', `/children/${child.id}/questionnaires`, { token: parentA.token })
  assert.deepEqual(listed.body.responses.map((r: { id: string }) => r.id), [stored.id])
  const followUp = await api('POST', `/questionnaire-responses/${stored.id}/follow-up`, {
    token: parentA.token,
    json: { source: 'HEALTH_WORKER', stillFailingItems: [] },
  })
  assert.equal(followUp.status, 503)
  // Another parent still gets 404 while the feature is off.
  assert.equal((await api('GET', `/questionnaire-responses/${stored.id}`, { token: parentB.token })).status, 404)
  const del = await api('DELETE', `/questionnaire-responses/${stored.id}`, { token: parentA.token })
  assert.equal(del.status, 200)
  assert.equal(await h.prisma.questionnaireResponse.count({ where: { id: stored.id } }), 0)
})

let moderateId = ''
let lowId = ''
let highId = ''
let child20 = ''

scenario('2. entry: 12-month child → 422 with eligibleFrom; 20-month child LOW (+rescreenAfter), MODERATE PENDING, HIGH REFER', async () => {
  await h.startBackend({ env: { MCHAT_MODE: 'entry' } })
  const enabled = await api('GET', '/questionnaires', { token: parentA.token })
  assert.equal(enabled.body.enabled, true)
  const statement = await api('GET', '/questionnaires/consent-statement', { token: parentA.token })
  assert.equal(statement.status, 200)
  assert.equal(statement.body.statement.version, QUESTIONNAIRE_CONSENT_VERSION)

  const young = await h.createChild(parentA, 'Q2-12m', 12)
  const tooYoung = await submit(parentA, young.id)
  assert.equal(tooYoung.status, 422, JSON.stringify(tooYoung.body))
  assert.equal(tooYoung.body.error, 'AGE_OUT_OF_RANGE')
  assert.equal(tooYoung.body.reason, 'TOO_YOUNG')
  assert.equal(tooYoung.body.ageMonths, 12)
  assert.equal(tooYoung.body.min, 16)
  assert.equal(tooYoung.body.max, 30)
  assert.match(tooYoung.body.eligibleFrom, /^\d{4}-\d{2}-\d{2}$/)
  const eligibility = await api('GET', `/children/${young.id}/questionnaires`, { token: parentA.token })
  assert.equal(eligibility.status, 200)
  assert.equal(eligibility.body.eligibility.MCHAT_RF.eligible, false)
  assert.equal(eligibility.body.eligibility.MCHAT_RF.eligibleFrom, tooYoung.body.eligibleFrom)

  const old = await h.createChild(parentA, 'Q2-32m', 32)
  const tooOld = await submit(parentA, old.id)
  assert.equal(tooOld.status, 422)
  assert.equal(tooOld.body.reason, 'TOO_OLD')

  const child = await h.createChild(parentA, 'Q2-20m', 20)
  child20 = child.id
  const low = await submit(parentA, child.id)
  assert.equal(low.status, 201, JSON.stringify(low.body))
  assert.equal(low.body.response.band, 'LOW')
  assert.equal(low.body.response.totalScore, 0)
  assert.equal(low.body.response.outcome, 'SCREEN_NEGATIVE')
  assert.equal(low.body.response.followUpStatus, 'NOT_NEEDED')
  assert.equal(low.body.response.childAgeMonths, 20)
  assert.ok(low.body.response.rescreenAfter, 'LOW under 24 months → rescreenAfter')
  assert.ok(low.body.response.actions.title)
  assert.ok(low.body.response.disclaimer)
  assert.match(low.body.response.copyright, /Robins/)
  lowId = low.body.response.id

  const moderate = await submit(parentA, child.id, { answers: answers([1, 3, 4]), respondent: 'FATHER' })
  assert.equal(moderate.status, 201)
  assert.equal(moderate.body.response.band, 'MODERATE')
  assert.equal(moderate.body.response.totalScore, 3)
  assert.equal(moderate.body.response.outcome, 'FOLLOW_UP_NEEDED')
  assert.equal(moderate.body.response.followUpStatus, 'PENDING')
  assert.deepEqual(moderate.body.response.failedItems, [1, 3, 4])
  assert.equal(moderate.body.response.rescreenAfter, null)
  moderateId = moderate.body.response.id

  const high = await submit(parentA, child.id, { answers: answers(ALL_ITEMS), respondent: 'GUARDIAN' })
  assert.equal(high.status, 201)
  assert.equal(high.body.response.band, 'HIGH')
  assert.equal(high.body.response.totalScore, 20)
  assert.equal(high.body.response.outcome, 'REFER')
  assert.equal(high.body.response.followUpStatus, 'NOT_APPLICABLE')
  assert.deepEqual(high.body.response.failedItems, [])
  highId = high.body.response.id

  const older = await h.createChild(parentA, 'Q2-26m', 26)
  const lowOlder = await submit(parentA, older.id)
  assert.equal(lowOlder.status, 201)
  assert.equal(lowOlder.body.response.rescreenAfter, null, 'no rescreen date at ≥ 24 months')

  for (const r of [low, moderate, high, lowOlder]) assertNoAnswers(r.body)
  const listed = await api('GET', `/children/${child.id}/questionnaires`, { token: parentA.token })
  assert.equal(listed.body.responses.length, 3)
  assert.equal(listed.body.eligibility.MCHAT_RF.eligible, true)
  assertNoAnswers(listed.body)

  // The DB keeps answers (item numbers only) and the consent snapshot on the row.
  const row = await h.prisma.questionnaireResponse.findUniqueOrThrow({ where: { id: moderateId } })
  assert.deepEqual(Object.keys(row.answers as object).sort((a, b) => Number(a) - Number(b)), ALL_ITEMS.map(String))
  assert.equal(row.consentVersion, QUESTIONNAIRE_CONSENT_VERSION)
  assert.equal((row.consentStatement as { version?: string }).version, QUESTIONNAIRE_CONSENT_VERSION)
})

scenario('3. follow-up: 2 items → REFER; on LOW/HIGH/completed → 409; invalid items → 400', async () => {
  assert.ok(moderateId, 'scenario 2 must have run')
  const invalid = await api('POST', `/questionnaire-responses/${moderateId}/follow-up`, {
    token: parentA.token,
    json: { source: 'HEALTH_WORKER', stillFailingItems: [7] },
  })
  assert.equal(invalid.status, 400)
  assert.equal(invalid.body.error, 'FOLLOW_UP_ITEMS_INVALID')
  const dup = await api('POST', `/questionnaire-responses/${moderateId}/follow-up`, {
    token: parentA.token,
    json: { source: 'HEALTH_WORKER', stillFailingItems: [1, 1] },
  })
  assert.equal(dup.status, 400)
  assert.equal(dup.body.error, 'FOLLOW_UP_ITEMS_INVALID')
  const badSource = await api('POST', `/questionnaire-responses/${moderateId}/follow-up`, {
    token: parentA.token,
    json: { source: 'NEIGHBOUR', stillFailingItems: [1] },
  })
  assert.equal(badSource.status, 400)

  const refer = await api('POST', `/questionnaire-responses/${moderateId}/follow-up`, {
    token: parentA.token,
    json: { source: 'HEALTH_WORKER', stillFailingItems: [1, 3] },
  })
  assert.equal(refer.status, 200, JSON.stringify(refer.body))
  assert.equal(refer.body.response.outcome, 'REFER')
  assert.equal(refer.body.response.followUpStatus, 'COMPLETED')
  assert.equal(refer.body.response.followUpSource, 'HEALTH_WORKER')
  assert.equal(refer.body.response.followUpFailCount, 2)
  assert.deepEqual(refer.body.response.followUpFailedItems, [1, 3])
  assert.deepEqual(refer.body.response.failedItems, [], 'item numbers are no longer listed once follow-up is done')
  assertNoAnswers(refer.body)

  for (const id of [moderateId, lowId, highId]) {
    const res = await api('POST', `/questionnaire-responses/${id}/follow-up`, {
      token: parentA.token,
      json: { source: 'A365', stillFailingItems: [] },
    })
    assert.equal(res.status, 409, id)
    assert.equal(res.body.error, 'FOLLOW_UP_NOT_APPLICABLE')
  }

  const another = await submit(parentA, child20, { answers: answers([6, 7, 9, 13]) })
  assert.equal(another.body.response.band, 'MODERATE')
  const negative = await api('POST', `/questionnaire-responses/${another.body.response.id}/follow-up`, {
    token: parentA.token,
    json: { source: 'OTHER', stillFailingItems: [9] },
  })
  assert.equal(negative.status, 200)
  assert.equal(negative.body.response.outcome, 'SCREEN_NEGATIVE')
  assert.equal(negative.body.response.followUpFailCount, 1)
  // A negative Follow-Up before 24 months is repeated after the second birthday (as for LOW).
  const dob = (await h.prisma.childProfile.findUniqueOrThrow({ where: { id: child20 } })).dateOfBirth
  assert.equal(negative.body.response.rescreenAfter, secondBirthday(dob).toISOString())
  assert.ok(negative.body.response.actions.body.join(' ').includes('sinh nhật 2 tuổi'))
  assert.equal(refer.body.response.rescreenAfter, null, 'no rescreen date for a positive Follow-Up')
})

scenario('4. consent missing → 400 CONSENT_REQUIRED; outdated version → 409; answer validation', async () => {
  const child = await h.createChild(parentA, 'Q4', 22)
  for (const body of [{ consentAccepted: false }, { consentAccepted: undefined }]) {
    const res = await submit(parentA, child.id, body)
    assert.equal(res.status, 400, JSON.stringify(body))
    assert.equal(res.body.error, 'CONSENT_REQUIRED')
  }
  const outdated = await submit(parentA, child.id, { consentVersion: 'questionnaire-2025-01-01' })
  assert.equal(outdated.status, 409)
  assert.equal(outdated.body.error, 'CONSENT_VERSION_OUTDATED')
  assert.equal(outdated.body.currentVersion, QUESTIONNAIRE_CONSENT_VERSION)

  const missing = answers()
  delete missing['7']
  const incomplete = await submit(parentA, child.id, { answers: missing })
  assert.equal(incomplete.status, 400)
  assert.equal(incomplete.body.error, 'INCOMPLETE_ANSWERS')
  assert.deepEqual(incomplete.body.missing, [7])
  const extra = await submit(parentA, child.id, { answers: { ...answers(), 21: true } })
  assert.equal(extra.status, 400)
  assert.equal(extra.body.error, 'VALIDATION_ERROR')
  const maybe = await submit(parentA, child.id, { answers: { ...answers(), 3: 'MAYBE' } })
  assert.equal(maybe.status, 400)
  assert.equal(maybe.body.error, 'VALIDATION_ERROR')
  const teacher = await submit(parentA, child.id, { respondent: 'TEACHER' })
  assert.equal(teacher.status, 400)
  assert.equal(await h.prisma.questionnaireResponse.count({ where: { childId: child.id } }), 0)
})

scenario('5. another user → 404; DELETE → gone; JSON never contains answers; admins never see answers', async () => {
  assert.ok(lowId && child20, 'scenario 2 must have run')
  const asB = { token: parentB.token }
  assert.equal((await api('GET', `/questionnaire-responses/${lowId}`, asB)).status, 404)
  assert.equal((await api('DELETE', `/questionnaire-responses/${lowId}`, asB)).status, 404)
  assert.equal((await api('GET', `/children/${child20}/questionnaires`, asB)).status, 404)
  const postB = await submit(parentB, child20)
  assert.equal(postB.status, 404)
  assert.equal(postB.body.error, 'CHILD_NOT_FOUND')
  const followB = await api('POST', `/questionnaire-responses/${lowId}/follow-up`, {
    ...asB,
    json: { source: 'OTHER', stillFailingItems: [] },
  })
  assert.equal(followB.status, 404)
  assert.ok(await h.prisma.questionnaireResponse.findUnique({ where: { id: lowId } }), 'B must not have deleted it')

  const own = await api('GET', `/questionnaire-responses/${lowId}`, { token: parentA.token })
  assert.equal(own.status, 200)
  assertNoAnswers(own.body)

  const stats = await api('GET', '/admin/stats', { token: admin.token })
  assert.equal(stats.status, 200)
  assert.equal(typeof stats.body.questionnaires.total, 'number')
  assertNoAnswers(stats.body.questionnaires)

  const del = await api('DELETE', `/questionnaire-responses/${lowId}`, { token: parentA.token })
  assert.equal(del.status, 200)
  assert.equal(del.body.deleted, true)
  assert.equal((await api('GET', `/questionnaire-responses/${lowId}`, { token: parentA.token })).status, 404)
  assert.equal((await api('DELETE', `/questionnaire-responses/${lowId}`, { token: parentA.token })).status, 404)
  assert.equal(await h.prisma.questionnaireResponse.count({ where: { id: lowId } }), 0)

  // Deleting the child removes its remaining responses and reports the count.
  const remaining = await h.prisma.questionnaireResponse.count({ where: { childId: child20 } })
  assert.ok(remaining > 0)
  const delChild = await api('DELETE', `/children/${child20}`, { token: parentA.token })
  assert.equal(delChild.status, 200, JSON.stringify(delChild.body))
  assert.equal(delChild.body.deletedQuestionnaires, remaining)
  assert.equal(await h.prisma.questionnaireResponse.count({ where: { childId: child20 } }), 0)
})
