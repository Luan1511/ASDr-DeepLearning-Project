/**
 * Personalisation (Giai đoạn 6) and sharing a child's record with a doctor
 * (Giai đoạn 7), end to end. Throwaway PostgreSQL + backend on :4100 + Node
 * fake ML on :8100 (harness.ts). Synthetic users, children and results only.
 *
 * Run: npx tsx --test --test-concurrency=1 test/e2e/doctor.e2e.ts
 */
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import bcrypt from 'bcrypt'
import { QUESTIONNAIRE_CONSENT_VERSION } from '../../src/lib/consent'
import { DOCTOR_SHARE_VERSION } from '../../src/lib/doctorShare'
import { MOCK_DOCTORS, seedMockDoctors } from '../../src/lib/mockDoctors'
import { E2eHarness, api, type SeededUser } from './harness'

const h = new E2eHarness('doctor')
/** Test-only password of the sample doctor accounts in the throwaway database. */
const SAMPLE_PASSWORD = 'e2e-sample-doctor-password'

let admin: SeededUser
let parentA: SeededUser
let parentB: SeededUser
/** Two sample doctors that accept new records, and one that does not. */
let doctor1: { id: string; token: string; email: string }
let doctor2: { id: string; token: string; email: string }
let closedDoctor: { id: string }

let childA: { id: string; fullName: string }
let childB: { id: string }
let linkId = ''

before(async () => {
  await h.setup({ premigrationDb: true })
  admin = h.users.admin
  parentA = h.users.parentA
  parentB = h.users.parentB

  const seeded = await seedMockDoctors(h.prisma, await bcrypt.hash(SAMPLE_PASSWORD, 4))
  assert.equal(seeded.created, MOCK_DOCTORS.length)
  const doctorOf = async (email: string) => {
    const user = await h.prisma.user.findUniqueOrThrow({ where: { email }, include: { doctorProfile: true } })
    return {
      id: user.doctorProfile!.id,
      email,
      token: h.tokenFor({ id: user.id, email: user.email, name: user.name, role: user.role }),
    }
  }
  const open = MOCK_DOCTORS.filter((d) => d.acceptingNew)
  doctor1 = await doctorOf(open[0].email)
  doctor2 = await doctorOf(open[1].email)
  closedDoctor = await doctorOf(MOCK_DOCTORS.find((d) => !d.acceptingNew)!.email)

  childA = await h.createChild(parentA, 'Na', 24)
  childB = await h.createChild(parentB, 'Bo', 40)
}, { timeout: 300_000 })

after(async () => {
  await h.teardown()
}, { timeout: 120_000 })

function scenario(name: string, fn: () => Promise<void>, timeout = 120_000) {
  test(name, { timeout }, async () => {
    try {
      await fn()
    } catch (error) {
      if (error instanceof Error) error.message += `\n--- backend log tail ---\n${h.backendLog.slice(-20).join('\n')}`
      throw error
    }
  })
}

const grant = (user: SeededUser, childId: string, body: Record<string, unknown>) =>
  api('POST', `/children/${childId}/doctor-links`, {
    token: user.token,
    json: { accepted: true, version: DOCTOR_SHARE_VERSION, ...body },
  })

/** What must never reach a doctor (or anyone) through these routes. */
function assertNoInternals(payload: unknown) {
  const text = JSON.stringify(payload)
  for (const key of ['originalFilename', 'storedFilename', 'filePath', 'rawAiResponse', 'userId', 'grantedById', 'passwordHash', '"answers"', 'consentStatement', '"statement"']) {
    assert.ok(!text.includes(key), `response contains ${key}`)
  }
}

// ---------------------------------------------------------------------------
// Personalisation
// ---------------------------------------------------------------------------

scenario('1. personalisation: defaults, save, read back, ownership and validation', async () => {
  await h.startBackend()

  const empty = await api('GET', `/children/${childA.id}/personalization`, { token: parentA.token })
  assert.equal(empty.status, 200, JSON.stringify(empty.body))
  assert.equal(empty.body.empty, true)
  assert.equal(empty.body.personalization.guideSpeed, 'AUTO')
  assert.equal(empty.body.personalization.updatedAt, null)

  const saved = await api('PUT', `/children/${childA.id}/personalization`, {
    token: parentA.token,
    json: {
      nickname: ' Na ',
      interests: ['khủng long', 'khủng long', 'xe buýt'],
      communication: 'SINGLE_WORDS',
      sensory: ['SOUND'],
      goals: 'Con bắt chước được động tác tay',
      focusAreas: ['ARMS'],
      weeklyGoal: 3,
    },
  })
  assert.equal(saved.status, 200, JSON.stringify(saved.body))
  assert.equal(saved.body.empty, false)
  assert.equal(saved.body.personalization.nickname, 'Na')
  assert.deepEqual(saved.body.personalization.interests, ['khủng long', 'xe buýt'])

  const again = await api('GET', `/children/${childA.id}/personalization`, { token: parentA.token })
  assert.deepEqual(again.body.personalization.sensory, ['SOUND'])
  assert.equal(again.body.personalization.weeklyGoal, 3)
  assert.ok(again.body.personalization.updatedAt)

  // The whole form is replaced: a field left out goes back to its default.
  const replaced = await api('PUT', `/children/${childA.id}/personalization`, {
    token: parentA.token,
    json: { nickname: 'Na', sensory: ['SOUND'], focusAreas: ['ARMS'], weeklyGoal: 3 },
  })
  assert.deepEqual(replaced.body.personalization.interests, [])
  assert.equal(replaced.body.personalization.goals, null)

  for (const [method, json] of [['GET', undefined], ['PUT', { nickname: 'x' }]] as const) {
    const foreign = await api(method, `/children/${childA.id}/personalization`, { token: parentB.token, json })
    assert.equal(foreign.status, 404)
    assert.equal(foreign.body.error, 'CHILD_NOT_FOUND')
  }
  const invalid = await api('PUT', `/children/${childA.id}/personalization`, { token: parentA.token, json: { sensory: ['SMELL'] } })
  assert.equal(invalid.status, 400)
  const unknown = await api('PUT', `/children/${childA.id}/personalization`, { token: parentA.token, json: { diagnosis: 'x' } })
  assert.equal(unknown.status, 400)
  assert.equal((await api('GET', `/children/${childA.id}/personalization`)).status, 401)
})

scenario('2. exercise plan: a new child starts with easy exercises; settings follow the profile', async () => {
  const sync = await api('POST', '/admin/exercises/builtins/sync', { token: admin.token })
  assert.equal(sync.status, 200, JSON.stringify(sync.body))
  const drafts = (await api('GET', '/admin/exercises', { token: admin.token })).body.exercises as Array<{
    id: string
    slug: string
    difficulty: number
    templates: Array<{ id: string }>
  }>
  for (const slug of ['dang-tay', 'vuon-cao', 'nghieng-nguoi']) {
    const exercise = drafts.find((e) => e.slug === slug)!
    const pub = await api('POST', `/admin/exercises/${exercise.id}/publish`, { token: admin.token, json: { templateId: exercise.templates[0].id } })
    assert.equal(pub.status, 200, JSON.stringify(pub.body))
  }

  const plan = await api('GET', `/children/${childA.id}/exercise-plan`, { token: parentA.token })
  assert.equal(plan.status, 200, JSON.stringify(plan.body))
  assert.equal(plan.body.plan.nickname, 'Na')
  assert.equal(plan.body.plan.level, 1)
  assert.deepEqual(plan.body.plan.weekly.goal, 3)
  assert.equal(plan.body.plan.weekly.daysPractised, 0)
  const recs = plan.body.plan.recommendations as Array<{ kind: string; reason: string; exercise: { slug: string; child: { attempts: number } }; settings: { coachVoice: boolean } }>
  assert.ok(recs.length >= 2 && recs.length <= 3)
  assert.ok(recs.every((r) => r.kind === 'START' && r.reason && r.exercise.child.attempts === 0))
  // Easy exercises first.
  assert.deepEqual(recs.slice(0, 2).map((r) => r.exercise.slug), ['dang-tay', 'vuon-cao'])
  // The child is sensitive to sound: Bin reminds in writing only.
  assert.ok(recs.every((r) => r.settings.coachVoice === false))
  assert.equal(JSON.stringify(plan.body).includes('features'), false)

  const harder = drafts.find((e) => e.slug === 'nghieng-nguoi')!
  const one = await api('GET', `/children/${childA.id}/exercise-plan?exerciseId=${harder.id}`, { token: parentA.token })
  assert.equal(one.status, 200)
  assert.equal(one.body.settings.playbackRate, 0.75)
  assert.equal(one.body.settings.liveCoach, true)
  assert.deepEqual(one.body.settings.reasons.map((r: { topic: string }) => r.topic), ['speed', 'coach'])

  const unpublished = drafts.find((e) => e.slug === 'buoc-deu')!
  assert.equal((await api('GET', `/children/${childA.id}/exercise-plan?exerciseId=${unpublished.id}`, { token: parentA.token })).status, 404)
  assert.equal((await api('GET', `/children/${childA.id}/exercise-plan`, { token: parentB.token })).status, 404)
})

// ---------------------------------------------------------------------------
// Doctors (DOCTOR_MODE=demo, the default)
// ---------------------------------------------------------------------------

scenario('3. demo mode: directory of sample doctors, statement, and who counts as a doctor', async () => {
  const caps = await api('GET', '/doctors/capabilities', { token: parentA.token })
  assert.deepEqual(caps.body, { mode: 'demo', available: true, demo: true })

  const list = await api('GET', '/doctors', { token: parentA.token })
  assert.equal(list.status, 200, JSON.stringify(list.body))
  assert.equal(list.body.demo, true)
  assert.equal(list.body.doctors.length, MOCK_DOCTORS.length)
  assert.ok(list.body.doctors.every((d: { isMock: boolean; links: unknown[] }) => d.isMock && d.links.length === 0))
  assert.ok(list.body.cities.includes('Đà Nẵng'))
  assertNoInternals(list.body)
  assert.equal(JSON.stringify(list.body).includes('@asdr.local'), false, 'directory must not expose account e-mails')

  const city = await api('GET', `/doctors?city=${encodeURIComponent('Đà Nẵng')}`, { token: parentA.token })
  assert.ok(city.body.doctors.length >= 1)
  assert.ok(city.body.doctors.every((d: { city: string }) => d.city === 'Đà Nẵng'))
  const search = await api('GET', `/doctors?q=${encodeURIComponent('âm ngữ')}`, { token: parentA.token })
  assert.equal(search.body.doctors.length, 1)

  const one = await api('GET', `/doctors/${doctor1.id}`, { token: parentA.token })
  assert.equal(one.status, 200)
  assert.equal((await api('GET', '/doctors/not-a-uuid', { token: parentA.token })).status, 404)

  const statement = await api('GET', '/doctors/share-statement', { token: parentA.token })
  assert.equal(statement.body.statement.version, DOCTOR_SHARE_VERSION)
  assert.equal(statement.body.statement.scopes.length, 5)

  // A parent is not a doctor; a doctor is.
  const asParent = await api('GET', '/doctor/patients', { token: parentA.token })
  assert.equal(asParent.status, 403)
  assert.equal(asParent.body.error, 'DOCTOR_ONLY')
  const me = await api('GET', '/doctor/me', { token: doctor1.token })
  assert.equal(me.status, 200, JSON.stringify(me.body))
  assert.equal(me.body.stats.activePatients, 0)
  assert.equal((await api('GET', '/doctors', {})).status, 401)
  assert.equal((await api('GET', '/doctor/patients', {})).status, 401)
})

scenario('4. sign-in tells the app which account is a doctor', async () => {
  const login = await api('POST', '/auth/login', { json: { email: doctor1.email, password: SAMPLE_PASSWORD } })
  assert.equal(login.status, 200, JSON.stringify(login.body))
  assert.equal(login.body.user.doctor.isMock, true)
  assert.equal(login.body.user.doctor.id, doctor1.id)
  const me = await api('GET', '/auth/me', { token: login.body.token })
  assert.equal(me.body.user.doctor.id, doctor1.id)
  const parentMe = await api('GET', '/auth/me', { token: parentA.token })
  assert.equal(parentMe.body.user.doctor, null)
})

scenario('5. a parent shares a record: validation, ownership, and what the doctor then sees', async () => {
  // Data the doctor may or may not see.
  const video = await h.prisma.videoUpload.create({
    data: {
      userId: parentA.id,
      childId: childA.id,
      originalFilename: 'be-na-di-bo.mp4',
      storedFilename: 'stored-na.mp4',
      filePath: 'uploads/stored-na.mp4',
      mimeType: 'video/mp4',
      fileSize: 1234,
      status: 'COMPLETED',
    },
  })
  await h.prisma.screeningResult.create({
    data: {
      videoId: video.id,
      riskLevel: 'LOW',
      confidenceScore: 0.8,
      asdProbability: 0.2,
      recommendation: 'Tiếp tục theo dõi.',
      rawAiResponse: { upstream: 'http://ml.internal/secret' },
    },
  })
  const answers: Record<string, boolean> = {}
  for (let i = 1; i <= 20; i += 1) answers[String(i)] = ![2, 5, 12].includes(i)
  const questionnaire = await api('POST', `/children/${childA.id}/questionnaires`, {
    token: parentA.token,
    json: { instrument: 'MCHAT_RF', respondent: 'MOTHER', answers, consentAccepted: true, consentVersion: QUESTIONNAIRE_CONSENT_VERSION },
  })
  assert.equal(questionnaire.status, 201, JSON.stringify(questionnaire.body))

  // ---- refused grants
  const noProfile = await grant(parentA, childA.id, { doctorId: doctor1.id, scopes: ['SCREENING'] })
  assert.equal(noProfile.status, 400)
  assert.equal(noProfile.body.error, 'SHARE_SCOPE_REQUIRED')
  const outdated = await grant(parentA, childA.id, { doctorId: doctor1.id, scopes: ['PROFILE'], version: 'doctor-share-2020-01-01' })
  assert.equal(outdated.status, 409)
  assert.equal(outdated.body.currentVersion, DOCTOR_SHARE_VERSION)
  const notAccepted = await api('POST', `/children/${childA.id}/doctor-links`, {
    token: parentA.token,
    json: { doctorId: doctor1.id, scopes: ['PROFILE'], accepted: false, version: DOCTOR_SHARE_VERSION },
  })
  assert.equal(notAccepted.status, 400)
  const noDoctor = await grant(parentA, childA.id, { doctorId: '123e4567-e89b-42d3-a456-426614174000', scopes: ['PROFILE'] })
  assert.equal(noDoctor.status, 404)
  assert.equal(noDoctor.body.error, 'DOCTOR_NOT_FOUND')
  const foreignChild = await grant(parentB, childA.id, { doctorId: doctor1.id, scopes: ['PROFILE'] })
  assert.equal(foreignChild.status, 404)
  assert.equal(foreignChild.body.error, 'CHILD_NOT_FOUND')
  const closed = await grant(parentA, childA.id, { doctorId: closedDoctor.id, scopes: ['PROFILE'] })
  assert.equal(closed.status, 409)
  assert.equal(closed.body.error, 'DOCTOR_NOT_ACCEPTING')
  assert.equal(await h.prisma.doctorChildLink.count(), 0)

  // ---- the grant
  const created = await grant(parentA, childA.id, {
    doctorId: doctor1.id,
    scopes: ['SCREENING', 'PROFILE'],
    message: '  Nhờ bác sĩ xem giúp kết quả của bé.  ',
  })
  assert.equal(created.status, 201, JSON.stringify(created.body))
  linkId = created.body.link.id
  assert.deepEqual(created.body.link.scopes, ['PROFILE', 'SCREENING'])
  assert.equal(created.body.link.message, 'Nhờ bác sĩ xem giúp kết quả của bé.')
  assert.equal(created.body.link.active, true)
  assert.equal(created.body.link.viewCount, 0)
  assertNoInternals(created.body)
  // The agreed text is kept with the grant.
  const stored = await h.prisma.doctorChildLink.findUniqueOrThrow({ where: { id: linkId } })
  assert.equal((stored.statement as { version: string }).version, DOCTOR_SHARE_VERSION)
  assert.equal(stored.grantedById, parentA.id)

  const directory = await api('GET', '/doctors', { token: parentA.token })
  const listed = directory.body.doctors.find((d: { id: string }) => d.id === doctor1.id)
  assert.deepEqual(listed.links, [{ id: linkId, childId: childA.id }])
  // Another parent does not see that grant.
  const otherView = await api('GET', '/doctors', { token: parentB.token })
  assert.deepEqual(otherView.body.doctors.find((d: { id: string }) => d.id === doctor1.id).links, [])

  // ---- the doctor's side
  const patients = await api('GET', '/doctor/patients', { token: doctor1.token })
  assert.equal(patients.status, 200, JSON.stringify(patients.body))
  assert.equal(patients.body.patients.length, 1)
  const patient = patients.body.patients[0]
  assert.equal(patient.linkId, linkId)
  assert.equal(patient.child.fullName, childA.fullName)
  assert.equal(patient.child.ageMonths, 24)
  assert.equal(patient.parent.name, parentA.name)
  assertNoInternals(patients.body)
  assert.equal(JSON.stringify(patients.body).includes(childA.id), false, 'the child id is not needed by the doctor')

  const detail = await api('GET', `/doctor/patients/${linkId}`, { token: doctor1.token })
  assert.equal(detail.status, 200, JSON.stringify(detail.body))
  assert.equal(detail.body.screenings.length, 1)
  assert.equal(detail.body.screenings[0].result.riskLevel, 'LOW')
  assert.equal(detail.body.screenings[0].result.asdProbability, 0.2)
  // Only the granted parts.
  assert.equal('questionnaires' in detail.body, false)
  assert.equal('exercises' in detail.body, false)
  assert.equal('personalization' in detail.body, false)
  assertNoInternals(detail.body)
  assert.equal(JSON.stringify(detail.body).includes('be-na-di-bo'), false)

  // Nobody else gets in.
  assert.equal((await api('GET', `/doctor/patients/${linkId}`, { token: doctor2.token })).status, 404)
  assert.equal((await api('GET', '/doctor/patients', { token: doctor2.token })).body.patients.length, 0)
  assert.equal((await api('GET', `/doctor/patients/${linkId}`, { token: parentA.token })).status, 403)
  // A doctor account has no parent access to the child either.
  assert.equal((await api('GET', `/children/${childA.id}`, { token: doctor1.token })).status, 404)
  assert.equal((await api('GET', `/children/${childA.id}/personalization`, { token: doctor1.token })).status, 404)

  // The parent sees that the record was opened.
  const links = await api('GET', `/children/${childA.id}/doctor-links`, { token: parentA.token })
  assert.equal(links.status, 200)
  assert.equal(links.body.links.length, 1)
  assert.equal(links.body.links[0].viewCount, 1)
  assert.ok(links.body.links[0].lastViewedAt)
  assert.equal((await api('GET', `/children/${childA.id}/doctor-links`, { token: parentB.token })).status, 404)
})

scenario('6. granting again changes the shared parts; each scope opens exactly its own data', async () => {
  const wider = await grant(parentA, childA.id, {
    doctorId: doctor1.id,
    scopes: ['PROFILE', 'PERSONALIZATION', 'SCREENING', 'QUESTIONNAIRE', 'EXERCISE'],
  })
  assert.equal(wider.status, 201, JSON.stringify(wider.body))
  const newLinkId = wider.body.link.id
  assert.notEqual(newLinkId, linkId)

  // The earlier grant ended; the doctor has one record, under the new grant.
  assert.equal((await api('GET', `/doctor/patients/${linkId}`, { token: doctor1.token })).status, 404)
  const patients = await api('GET', '/doctor/patients', { token: doctor1.token })
  assert.deepEqual(patients.body.patients.map((p: { linkId: string }) => p.linkId), [newLinkId])
  linkId = newLinkId

  const detail = await api('GET', `/doctor/patients/${linkId}`, { token: doctor1.token })
  assert.equal(detail.status, 200, JSON.stringify(detail.body))
  assert.equal(detail.body.personalization.nickname, 'Na')
  assert.deepEqual(detail.body.personalization.sensory, ['SOUND'])
  assert.equal(detail.body.questionnaires.length, 1)
  assert.equal(detail.body.questionnaires[0].band, 'LOW')
  assert.deepEqual(detail.body.exercises, [])
  assert.equal(detail.body.screenings.length, 1)
  assertNoInternals(detail.body)

  const history = await api('GET', `/children/${childA.id}/doctor-links`, { token: parentA.token })
  assert.deepEqual(
    history.body.links.map((l: { active: boolean }) => l.active),
    [true, false],
  )

  // The same child may be shared with a second doctor at the same time.
  const second = await grant(parentA, childA.id, { doctorId: doctor2.id, scopes: ['PROFILE'] })
  assert.equal(second.status, 201)
  const other = await api('GET', `/doctor/patients/${second.body.link.id}`, { token: doctor2.token })
  assert.equal(other.status, 200)
  assert.equal('screenings' in other.body, false)
  assert.equal((await api('GET', '/doctor/me', { token: doctor1.token })).body.stats.activePatients, 1)
})

scenario('7. ending a grant closes the record at once', async () => {
  const foreign = await api('DELETE', `/children/${childA.id}/doctor-links/${linkId}`, { token: parentB.token })
  assert.equal(foreign.status, 404)
  assert.equal((await api('GET', `/doctor/patients/${linkId}`, { token: doctor1.token })).status, 200)

  const revoked = await api('DELETE', `/children/${childA.id}/doctor-links/${linkId}`, { token: parentA.token })
  assert.equal(revoked.status, 200)
  assert.equal(revoked.body.revoked, 1)
  assert.equal((await api('GET', `/doctor/patients/${linkId}`, { token: doctor1.token })).status, 404)
  assert.equal((await api('GET', '/doctor/patients', { token: doctor1.token })).body.patients.length, 0)

  // Idempotent, and an unknown grant is a 404.
  const again = await api('DELETE', `/children/${childA.id}/doctor-links/${linkId}`, { token: parentA.token })
  assert.equal(again.body.revoked, 0)
  const missing = await api('DELETE', `/children/${childA.id}/doctor-links/123e4567-e89b-42d3-a456-426614174000`, { token: parentA.token })
  assert.equal(missing.status, 404)
})

scenario('8. deleting a child removes every grant and the personalisation', async () => {
  const shared = await grant(parentB, childB.id, { doctorId: doctor1.id, scopes: ['PROFILE', 'PERSONALIZATION'] })
  assert.equal(shared.status, 201)
  await api('PUT', `/children/${childB.id}/personalization`, { token: parentB.token, json: { nickname: 'Bo' } })
  assert.equal((await api('GET', '/doctor/patients', { token: doctor1.token })).body.patients.length, 1)

  const deleted = await api('DELETE', `/children/${childB.id}`, { token: parentB.token })
  assert.equal(deleted.status, 200, JSON.stringify(deleted.body))
  assert.equal(await h.prisma.doctorChildLink.count({ where: { childId: childB.id } }), 0)
  assert.equal(await h.prisma.childPersonalization.count({ where: { childId: childB.id } }), 0)
  assert.equal((await api('GET', '/doctor/patients', { token: doctor1.token })).body.patients.length, 0)
  assert.equal((await api('GET', `/doctor/patients/${shared.body.link.id}`, { token: doctor1.token })).status, 404)
})

// ---------------------------------------------------------------------------
// Other modes and an unmigrated database
// ---------------------------------------------------------------------------

scenario('9. DOCTOR_MODE=off: nothing can be shared or read, but a parent can still see and end grants', async () => {
  // doctor2 still holds the PROFILE grant of childA from scenario 6.
  const active = await h.prisma.doctorChildLink.findFirstOrThrow({ where: { childId: childA.id, revokedAt: null } })
  await h.startBackend({ env: { DOCTOR_MODE: 'off' } })

  assert.deepEqual((await api('GET', '/doctors/capabilities', { token: parentA.token })).body, { mode: 'off', available: false, demo: false })
  for (const res of [
    await api('GET', '/doctors', { token: parentA.token }),
    await api('GET', '/doctors/share-statement', { token: parentA.token }),
    await grant(parentA, childA.id, { doctorId: doctor1.id, scopes: ['PROFILE'] }),
    await api('GET', '/doctor/patients', { token: doctor2.token }),
    await api('GET', `/doctor/patients/${active.id}`, { token: doctor2.token }),
  ]) {
    assert.equal(res.status, 403)
    assert.equal(res.body.error, 'DOCTORS_DISABLED')
  }
  const login = await api('POST', '/auth/login', { json: { email: doctor1.email, password: SAMPLE_PASSWORD } })
  assert.equal(login.body.user.doctor, null)

  const links = await api('GET', `/children/${childA.id}/doctor-links`, { token: parentA.token })
  assert.equal(links.status, 200)
  assert.equal(links.body.available, false)
  assert.equal(links.body.links.filter((l: { active: boolean }) => l.active).length, 1)
  const revoked = await api('DELETE', `/children/${childA.id}/doctor-links/${active.id}`, { token: parentA.token })
  assert.equal(revoked.body.revoked, 1)
})

scenario('10. DOCTOR_MODE=on: sample doctors are neither listed nor able to read', async () => {
  const regranted = await h.prisma.doctorChildLink.create({
    data: { doctorId: doctor1.id, childId: childA.id, grantedById: parentA.id, scopes: ['PROFILE'], version: DOCTOR_SHARE_VERSION, statement: {} },
  })
  await h.startBackend({ env: { DOCTOR_MODE: 'on' } })

  const list = await api('GET', '/doctors', { token: parentA.token })
  assert.equal(list.status, 200)
  assert.equal(list.body.demo, false)
  assert.deepEqual(list.body.doctors, [])
  assert.equal((await api('GET', `/doctors/${doctor1.id}`, { token: parentA.token })).status, 404)
  assert.equal((await grant(parentA, childA.id, { doctorId: doctor1.id, scopes: ['PROFILE'] })).status, 404)

  const blocked = await api('GET', `/doctor/patients/${regranted.id}`, { token: doctor1.token })
  assert.equal(blocked.status, 403)
  assert.equal(blocked.body.error, 'DOCTORS_DISABLED')
  assert.equal((await api('GET', '/auth/me', { token: doctor1.token })).body.user.doctor, null)

  // A real (non-sample) doctor works in this mode.
  const real = await h.prisma.user.create({ data: { name: 'BS. Thật (E2E)', email: 'real-doctor@e2e.test', passwordHash: '!e2e-no-login' } })
  const profile = await h.prisma.doctorProfile.create({
    data: { userId: real.id, displayName: 'Thật (E2E)', title: 'BS.', specialty: 'Nhi khoa', workplace: 'E2E', city: 'Đà Nẵng', bio: 'E2E', languages: [] },
  })
  const realToken = h.tokenFor({ id: real.id, email: real.email, name: real.name, role: 'USER' })
  assert.deepEqual((await api('GET', '/doctors', { token: parentA.token })).body.doctors.map((d: { id: string }) => d.id), [profile.id])
  const shared = await grant(parentA, childA.id, { doctorId: profile.id, scopes: ['PROFILE'] })
  assert.equal(shared.status, 201, JSON.stringify(shared.body))
  assert.equal((await api('GET', `/doctor/patients/${shared.body.link.id}`, { token: realToken })).status, 200)
  // The statement stored with this grant does not talk about sample doctors.
  const stored = await h.prisma.doctorChildLink.findUniqueOrThrow({ where: { id: shared.body.link.id } })
  assert.equal(JSON.stringify(stored.statement).includes('bác sĩ mẫu'), false)
})

scenario('11. a database without the new tables: the app keeps working, the new parts say "migration required"', async () => {
  const old = h.client(h.oldUrl)
  const user = await old.user.create({ data: { name: 'Phụ huynh cũ (E2E)', email: 'old-parent@e2e.test', passwordHash: await bcrypt.hash(SAMPLE_PASSWORD, 4) } })
  const child = await old.childProfile.create({
    data: { userId: user.id, fullName: 'Bé Cũ (E2E)', dateOfBirth: new Date('2023-01-10'), gender: 'UNSPECIFIED' },
  })
  const token = h.tokenFor({ id: user.id, email: user.email, name: user.name, role: 'USER' })
  await h.startBackend({ db: 'old', cwdName: 'backend-old-db' })

  // Signing in and the existing pages are untouched.
  const login = await api('POST', '/auth/login', { json: { email: user.email, password: SAMPLE_PASSWORD } })
  assert.equal(login.status, 200, JSON.stringify(login.body))
  assert.equal(login.body.user.doctor, null)
  assert.equal((await api('GET', '/auth/me', { token })).body.user.doctor, null)
  const children = await api('GET', '/children', { token })
  assert.equal(children.status, 200, JSON.stringify(children.body))
  assert.equal(children.body.children.length, 1)
  assert.equal((await api('GET', `/children/${child.id}`, { token })).status, 200)

  // New parts.
  const links = await api('GET', `/children/${child.id}/doctor-links`, { token })
  assert.equal(links.status, 200)
  assert.deepEqual(links.body, { available: false, links: [] })
  for (const res of [
    await api('GET', `/children/${child.id}/personalization`, { token }),
    await api('PUT', `/children/${child.id}/personalization`, { token, json: { nickname: 'x' } }),
    await api('GET', '/doctors', { token }),
  ]) {
    assert.equal(res.status, 503)
    assert.equal(res.body.error, 'DATABASE_MIGRATION_REQUIRED')
  }
})
