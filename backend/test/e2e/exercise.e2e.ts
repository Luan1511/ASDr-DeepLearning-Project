/**
 * Exercise (Giai đoạn 4) end-to-end scenarios, spec §7.2 items 1–18.
 * Throwaway PostgreSQL + backend on :4100 + Node fake ML on :8100 (harness.ts).
 * Synthetic users, children and keypoints only.
 *
 * Run: npx tsx --test --test-concurrency=1 test/e2e/exercise.e2e.ts
 */
import { after, before, test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { CONSENT_VERSION, EXERCISE_CONSENT_VERSION, QUESTIONNAIRE_CONSENT_VERSION } from '../../src/lib/consent'
import { buildScenario, type ScenarioName } from '../syntheticImitation'
import { encodeClip } from './fakeMlServer'
import { BACKEND_DIR, E2eHarness, api, clipForm, sleep, waitFor, type SeededUser } from './harness'

const h = new E2eHarness('exercise')
const FINAL = ['SCORED', 'INSUFFICIENT', 'FAILED']

type Target = { exerciseId: string; templateId: string; durationSec: number }
const published: Record<string, Target> = {}
const ids: Record<string, string> = {} // slug → exercise id (all built-ins)

let admin: SeededUser
let parentA: SeededUser
let parentB: SeededUser

before(async () => {
  await h.setup({ premigrationDb: true })
  admin = h.users.admin
  parentA = h.users.parentA
  parentB = h.users.parentB
}, { timeout: 300_000 })

after(async () => {
  await h.teardown()
}, { timeout: 120_000 })

/** Runs a scenario; on failure the backend log tail is attached to the error. */
function scenario(name: string, fn: (t: TestContext) => Promise<void>, timeout = 120_000) {
  test(name, { timeout }, async (t) => {
    try {
      await fn(t)
    } catch (error) {
      const tail = h.backendLog.slice(-25).join('\n')
      if (error instanceof Error) error.message += `\n--- backend log tail ---\n${tail}`
      throw error
    } finally {
      h.ml.release()
    }
  })
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function grantExerciseConsent(user: SeededUser, childId: string) {
  const res = await api('POST', `/children/${childId}/exercise-consent`, {
    token: user.token,
    json: { accepted: true, version: EXERCISE_CONSENT_VERSION, scopes: ['EXERCISE_VIDEO'] },
  })
  assert.equal(res.status, 201, JSON.stringify(res.body))
  return res.body.consent as { id: string }
}

async function childWithConsent(user: SeededUser, label: string, ageMonths = 36) {
  const child = await h.createChild(user, label, ageMonths)
  await grantExerciseConsent(user, child.id)
  return child
}

function upload(
  user: SeededUser,
  childId: string,
  target: Target,
  clip: { slug: string; scenario: ScenarioName; seed?: number },
  opts: { fields?: Record<string, string | number | undefined>; file?: { name?: string; type?: string }; templateId?: string } = {},
) {
  const durationMs = buildScenario(clip.slug, clip.scenario, { seed: clip.seed }).durationMs
  const qs = new URLSearchParams({ childId, exerciseId: target.exerciseId, templateId: opts.templateId ?? target.templateId })
  return api('POST', `/exercise-sessions/upload?${qs}`, {
    token: user.token,
    form: clipForm(
      clip,
      {
        durationMs,
        recordedVia: 'UPLOAD',
        practiceMode: 'AFTER_DEMO',
        playbackRate: 1,
        videoWidth: 960,
        videoHeight: 540,
        ...(opts.fields ?? {}),
      },
      opts.file,
    ),
  })
}

/** Polls the parent API until the session is final; re-queued retries are fast-forwarded. */
async function waitSession(user: SeededUser, sessionId: string, opts: { timeoutMs?: number; statuses?: string[] } = {}) {
  const statuses = opts.statuses ?? FINAL
  return waitFor(
    async () => {
      // Backoff is 15 s·2^(n−1); skip the wait instead of sleeping through it.
      await h.prisma.exerciseSession.updateMany({
        where: { id: sessionId, status: 'QUEUED', attempts: { gt: 0 }, runAfter: { gt: new Date() } },
        data: { runAfter: new Date(Date.now() - 1000) },
      })
      const res = await api('GET', `/exercise-sessions/${sessionId}`, { token: user.token })
      return statuses.includes(res.body?.session?.status) ? res.body.session : null
    },
    { timeoutMs: opts.timeoutMs ?? 60_000, intervalMs: 300, what: `session ${sessionId} to reach ${statuses.join('/')}` },
  )
}

async function uploadAndWait(user: SeededUser, childId: string, target: Target, clip: { slug: string; scenario: ScenarioName; seed?: number }, opts: Parameters<typeof upload>[4] = {}) {
  const res = await upload(user, childId, target, clip, opts)
  assert.equal(res.status, 201, JSON.stringify(res.body))
  return waitSession(user, res.body.session.id)
}

function dbSession(id: string) {
  return h.prisma.exerciseSession.findUnique({ where: { id } })
}

async function refreshPublished() {
  const res = await api('GET', '/exercises', { token: parentA.token })
  assert.equal(res.status, 200, JSON.stringify(res.body))
  for (const e of res.body.exercises) {
    published[e.slug] = { exerciseId: e.id, templateId: e.template.id, durationSec: e.template.durationSec }
  }
  return res.body.exercises as Array<{ slug: string; title: string; template: Record<string, unknown> }>
}

async function publishLatest(exerciseId: string) {
  const list = await api('GET', '/admin/exercises', { token: admin.token })
  const exercise = list.body.exercises.find((e: { id: string }) => e.id === exerciseId)
  const res = await api('POST', `/admin/exercises/${exerciseId}/publish`, {
    token: admin.token,
    json: { templateId: exercise.templates[0].id },
  })
  assert.equal(res.status, 200, JSON.stringify(res.body))
  return res.body.exercise
}

async function waitMlBlocked(count = 1) {
  await waitFor(() => h.ml.heldCalls >= count, { timeoutMs: 20_000, what: `${count} heavy ML call(s) to be held` })
}

// ---------------------------------------------------------------------------
// 1. EXERCISE_MODE=admin_only
// ---------------------------------------------------------------------------

scenario('1. admin_only: parents get EXERCISES_DISABLED, capabilities works, admins use the routes', async () => {
  await h.startBackend({ env: { EXERCISE_MODE: 'admin_only', MCHAT_MODE: 'off' } })

  const list = await api('GET', '/exercises', { token: parentA.token })
  assert.equal(list.status, 403)
  assert.equal(list.body.error, 'EXERCISES_DISABLED')
  const statement = await api('GET', '/exercises/consent-statement', { token: parentA.token })
  assert.equal(statement.status, 403)

  const caps = await api('GET', '/exercises/capabilities', { token: parentA.token })
  assert.equal(caps.status, 200)
  assert.equal(caps.body.mode, 'admin_only')
  assert.equal(caps.body.available, false)

  const adminCaps = await api('GET', '/exercises/capabilities', { token: admin.token })
  assert.equal(adminCaps.body.available, true)
  assert.equal(adminCaps.body.mlReachable, true)
  assert.equal(adminCaps.body.mlLegacy, false)
  assert.equal((await api('GET', '/exercises', { token: admin.token })).status, 200)
  assert.equal((await api('GET', '/exercises/consent-statement', { token: admin.token })).status, 200)
  assert.equal((await api('GET', '/admin/exercises', { token: admin.token })).status, 200)
  assert.equal((await api('GET', '/admin/exercises/queue', { token: admin.token })).status, 200)
})

// ---------------------------------------------------------------------------
// 2–16 run with EXERCISE_MODE=on, MCHAT_MODE=entry, fake ML v2
// ---------------------------------------------------------------------------

scenario('2. built-ins sync as DRAFT, publish two, second sync unchanged', async () => {
  await h.startBackend()
  const sync = await api('POST', '/admin/exercises/builtins/sync', { token: admin.token })
  assert.equal(sync.status, 200, JSON.stringify(sync.body))
  assert.deepEqual({ ...sync.body, failed: sync.body.failed.length }, { created: 6, newVersions: 0, unchanged: 0, failed: 0 })

  const adminList = await api('GET', '/admin/exercises', { token: admin.token })
  assert.equal(adminList.body.exercises.length, 6)
  for (const e of adminList.body.exercises) {
    assert.equal(e.status, 'DRAFT')
    assert.equal(e.source, 'BUILTIN_SYNTHETIC')
    assert.ok(e.title.startsWith('[Mẫu tổng hợp]'), e.title)
    assert.equal(e.templates.length, 1)
    assert.ok(e.templates[0].quality.every((g: { ok: boolean }) => g.ok))
    ids[e.slug] = e.id
  }

  assert.deepEqual(await refreshPublished(), [])
  const draft = await api('GET', `/exercises/${ids['dang-tay']}`, { token: parentA.token })
  assert.equal(draft.status, 404)
  assert.equal(draft.body.error, 'EXERCISE_NOT_FOUND')

  await publishLatest(ids['dang-tay'])
  await publishLatest(ids['gio-tay-chao'])
  const visible = await refreshPublished()
  assert.deepEqual(visible.map((e) => e.slug).sort(), ['dang-tay', 'gio-tay-chao'])
  for (const e of visible) {
    assert.ok(!e.title.startsWith('[Mẫu tổng hợp]'))
    assert.ok(!('features' in e.template))
  }
  const detail = await api('GET', `/exercises/${ids['dang-tay']}`, { token: parentA.token })
  assert.equal(detail.status, 200)
  assert.ok(detail.headers.get('etag'))
  assert.ok(Array.isArray(detail.body.guide.frames) && detail.body.guide.frames.length > 0)

  const again = await api('POST', '/admin/exercises/builtins/sync', { token: admin.token })
  assert.deepEqual({ ...again.body, failed: again.body.failed.length }, { created: 0, newVersions: 0, unchanged: 6, failed: 0 })

  // Used by later scenarios.
  await publishLatest(ids['ngoi-xuong'])
  await refreshPublished()
})

let adminExerciseId = ''
let adminSourceSubject = ''

scenario('3. template upload → tpl_ subject → dryRun (no row) → compile v1 → publish; non-tpl source refused', async () => {
  const created = await api('POST', '/admin/exercises', {
    token: admin.token,
    json: {
      slug: 'e2e-dang-tay-nguoi-lon',
      title: 'Dang tay (mẫu người lớn E2E)',
      description: 'Bài tập tổng hợp cho kiểm thử tự động.',
      childPrompt: 'Mình cùng dang tay nhé!',
      difficulty: 1,
      bodyFocus: ['ARMS'],
      sortOrder: 50,
    },
  })
  assert.equal(created.status, 201, JSON.stringify(created.body))
  assert.equal(created.body.exercise.status, 'DRAFT')
  adminExerciseId = created.body.exercise.id
  const dup = await api('POST', '/admin/exercises', { token: admin.token, json: { ...created.body.exercise, slug: 'e2e-dang-tay-nguoi-lon', title: 'x', description: '', childPrompt: '', difficulty: 1, bodyFocus: ['ARMS'] } })
  assert.equal(dup.status, 409)
  assert.equal(dup.body.error, 'SLUG_TAKEN')

  const templatesDir = () => path.join(h.backendCwd, 'uploads', 'exercises', 'templates')
  const filesIn = (dir: string) => (fs.existsSync(dir) ? fs.readdirSync(dir) : [])

  const noAttest = new FormData()
  noAttest.append('durationMs', '10000')
  noAttest.append('video', new Blob([new Uint8Array(encodeClip({ template: 'dang-tay' }))], { type: 'video/mp4' }), 'mau.mp4')
  const refused = await api('POST', `/admin/exercises/${adminExerciseId}/template-sources`, { token: admin.token, form: noAttest })
  assert.equal(refused.status, 422)
  assert.equal(refused.body.error, 'ATTESTATION_REQUIRED')
  assert.deepEqual(filesIn(templatesDir()), [])

  const form = new FormData()
  form.append('durationMs', '10000')
  form.append('attestation', 'true')
  form.append('video', new Blob([new Uint8Array(encodeClip({ template: 'dang-tay' }))], { type: 'video/mp4' }), 'mau-nguoi-lon.mp4')
  const source = await api('POST', `/admin/exercises/${adminExerciseId}/template-sources`, { token: admin.token, form })
  assert.equal(source.status, 201, JSON.stringify(source.body))
  assert.match(source.body.sourceSubjectId, /^tpl_[0-9a-f-]{36}$/)
  assert.equal(source.body.fps, 25)
  assert.equal(source.body.fpsSource, 'ml')
  assert.ok(source.body.numFrames > 100)
  adminSourceSubject = source.body.sourceSubjectId
  assert.ok(h.ml.subjects.has(adminSourceSubject))
  assert.equal(h.ml.extractCallsFor(adminSourceSubject)[0].filename, 'session.mp4')
  assert.deepEqual(filesIn(templatesDir()), [], 'temporary template upload must be deleted')

  const base = { sourceSubjectId: adminSourceSubject, mirrorPolicy: 'EITHER', attestation: true }
  const dry = await api('POST', `/admin/exercises/${adminExerciseId}/templates`, { token: admin.token, json: { ...base, dryRun: true } })
  assert.equal(dry.status, 200, JSON.stringify(dry.body))
  assert.equal(dry.body.result.ok, true)
  assert.ok(dry.body.result.gates.length >= 5)
  assert.ok(dry.body.result.template.guideTrack)
  assert.ok(!('features' in dry.body.result.template))
  assert.equal(await h.prisma.exerciseTemplate.count({ where: { exerciseId: adminExerciseId } }), 0)

  for (const bad of [`ex_${randomUUID()}`, 'some-admin-skeleton-subject', `tpl_${randomUUID()}x`]) {
    const res = await api('POST', `/admin/exercises/${adminExerciseId}/templates`, { token: admin.token, json: { ...base, sourceSubjectId: bad } })
    assert.equal(res.status, 422, bad)
    assert.equal(res.body.error, 'SOURCE_SUBJECT_NOT_ALLOWED')
  }
  const noAttestCompile = await api('POST', `/admin/exercises/${adminExerciseId}/templates`, { token: admin.token, json: { ...base, attestation: false } })
  assert.equal(noAttestCompile.status, 422)

  const compiled = await api('POST', `/admin/exercises/${adminExerciseId}/templates`, { token: admin.token, json: base })
  assert.equal(compiled.status, 201, JSON.stringify(compiled.body))
  assert.equal(compiled.body.template.version, 1)
  assert.equal(compiled.body.template.sourceSubjectId, adminSourceSubject)
  assert.equal(compiled.body.template.fpsSource, 'ml')
  assert.ok(!('features' in compiled.body.template))

  const guide = await api('GET', `/admin/exercises/${adminExerciseId}/templates/${compiled.body.template.id}/guide`, { token: admin.token })
  assert.equal(guide.status, 200)
  assert.equal(guide.body.guide.version, 1)

  const pub = await api('POST', `/admin/exercises/${adminExerciseId}/publish`, { token: admin.token, json: { templateId: compiled.body.template.id } })
  assert.equal(pub.status, 200, JSON.stringify(pub.body))
  assert.equal(pub.body.exercise.status, 'PUBLISHED')
  const wrong = await api('POST', `/admin/exercises/${adminExerciseId}/publish`, {
    token: admin.token,
    json: { templateId: published['dang-tay'].templateId },
  })
  assert.equal(wrong.status, 409)
  assert.equal(wrong.body.error, 'TEMPLATE_NOT_FOR_EXERCISE')

  const slugs = (await refreshPublished()).map((e) => e.slug)
  assert.ok(slugs.includes('e2e-dang-tay-nguoi-lon'))
})

scenario('4. consent required, then identical attempt scored ≥ 90 with video and ML subject deleted, no skeleton stored', async (t) => {
  // The queue SQL must not depend on the DB session time zone (initdb takes the OS zone).
  const [tz] = await h.prisma.$queryRawUnsafe<Array<{ TimeZone: string }>>('SHOW timezone')
  t.diagnostic(`temp cluster time zone: ${tz?.TimeZone}`)
  const child = await h.createChild(parentA, 'S4')
  const before = h.exerciseFiles()
  const blocked = await upload(parentA, child.id, published['dang-tay'], { slug: 'dang-tay', scenario: 'identical' })
  assert.equal(blocked.status, 403)
  assert.equal(blocked.body.error, 'EXERCISE_CONSENT_REQUIRED')
  assert.deepEqual(h.exerciseFiles(), before, 'no file may be written without consent')

  await grantExerciseConsent(parentA, child.id)
  h.ml.resetCounters()
  const res = await upload(parentA, child.id, published['dang-tay'], { slug: 'dang-tay', scenario: 'identical' })
  assert.equal(res.status, 201, JSON.stringify(res.body))
  assert.ok(['QUEUED', 'PROCESSING'].includes(res.body.session.status))
  assert.equal(res.body.session.score, null)
  const sessionId = res.body.session.id

  const done = await waitSession(parentA, sessionId)
  assert.equal(done.status, 'SCORED', JSON.stringify(done))
  assert.ok(done.score.overall >= 90, `overall ${done.score.overall}`)
  assert.equal(done.score.stars, 3)
  assert.equal(done.rawVideoDeleted, true)
  for (const key of ['filePath', 'storedFilename', 'mlSubjectId', 'lastError', 'lockedBy', 'userId']) {
    assert.ok(!(key in done), `DTO leaks ${key}`)
  }

  const row = await waitFor(async () => {
    const r = await dbSession(sessionId)
    return r?.mlSubjectDeletedAt ? r : null
  }, { what: 'ML subject cleanup' })
  assert.ok(row.videoDeletedAt)
  assert.equal(row.mlSubjectId, `ex_${sessionId}`)
  assert.ok(!h.exerciseFileExists(row.filePath), 'raw video must be deleted')
  assert.ok(!row.storedFilename.includes('quay-thu'), 'original filename must not be stored')
  assert.deepEqual(h.ml.subjectIds('ex_'), [], 'fake ML must hold no ex_ subject')
  assert.equal(h.ml.pipelineCalls, 0, 'exercise videos never go to /pipeline/asd')
  assert.equal(h.ml.extractCallsFor(`ex_${sessionId}`)[0].filename, 'session.mp4')

  // No table or column holds keypoints.
  const columns = await h.prisma.$queryRaw<Array<{ table_name: string; column_name: string }>>`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name IN ('ExerciseSession', 'SessionScore', 'QuestionnaireResponse')`
  for (const c of columns) assert.ok(!/keypoint|frame|skeleton|pose|body25/i.test(c.column_name), `${c.table_name}.${c.column_name}`)
  const score = await h.prisma.sessionScore.findFirstOrThrow({ where: { sessionId } })
  const stored = JSON.stringify(score) + JSON.stringify(row)
  assert.ok(!/body25|frame_index|"frames"|keypoints/.test(stored), 'score/session rows must not contain keypoints')
  assert.ok(stored.length < 20_000, `score row unexpectedly large (${stored.length} chars)`)
})

scenario('5. half amplitude 30–65, still ≤ 20 with LOW_MOTION, legs-hidden squat INSUFFICIENT', async () => {
  const child = await childWithConsent(parentA, 'S5')
  const half = await uploadAndWait(parentA, child.id, published['dang-tay'], { slug: 'dang-tay', scenario: 'half_amplitude' })
  assert.equal(half.status, 'SCORED')
  assert.ok(half.score.overall >= 30 && half.score.overall <= 65, `half amplitude overall ${half.score.overall}`)

  const still = await uploadAndWait(parentA, child.id, published['dang-tay'], { slug: 'dang-tay', scenario: 'still' })
  assert.equal(still.status, 'SCORED')
  assert.ok(still.score.overall <= 20, `still overall ${still.score.overall}`)
  assert.ok(still.score.warnings.includes('LOW_MOTION'), JSON.stringify(still.score.warnings))

  const squat = await uploadAndWait(parentA, child.id, published['ngoi-xuong'], { slug: 'ngoi-xuong', scenario: 'legs_hidden' })
  assert.equal(squat.status, 'INSUFFICIENT', JSON.stringify(squat))
  assert.equal(squat.score.overall, null)
  assert.equal(squat.score.stars, null)
  assert.ok(squat.score.reasonCodes.includes('ACTIVE_PART_NOT_VISIBLE'), JSON.stringify(squat.score.reasonCodes))
})

scenario('6. mirrored gio-tay-chao ≥ 90 with mode mirror', async () => {
  const child = await childWithConsent(parentA, 'S6')
  const done = await uploadAndWait(parentA, child.id, published['gio-tay-chao'], { slug: 'gio-tay-chao', scenario: 'mirrored' })
  assert.equal(done.status, 'SCORED')
  assert.ok(done.score.overall >= 90, `overall ${done.score.overall}`)
  assert.equal(done.score.mode, 'mirror')
})

scenario('7c. v2 ML: .webm upload is sent as session.webm and scored', async () => {
  const child = await childWithConsent(parentA, 'S7c')
  h.ml.resetCounters()
  const done = await uploadAndWait(parentA, child.id, published['dang-tay'], { slug: 'dang-tay', scenario: 'identical' }, {
    file: { name: 'ghi-hinh.webm', type: 'video/webm' },
    fields: { recordedVia: 'WEBCAM' },
  })
  assert.equal(done.status, 'SCORED', JSON.stringify(done))
  assert.ok(done.score.overall >= 90)
  const call = h.ml.extractCallsFor(`ex_${done.id}`)[0]
  assert.equal(call.filename, 'session.webm')
  assert.equal(call.mimeType, 'video/webm')
})

scenario('8. ML ignores subject_id → mlSubjectId follows the returned id, scored and deleted', async () => {
  const child = await childWithConsent(parentA, 'S8')
  h.ml.switches.ignoreSubjectId = true
  const done = await uploadAndWait(parentA, child.id, published['dang-tay'], { slug: 'dang-tay', scenario: 'identical' })
  h.ml.switches.ignoreSubjectId = false
  assert.equal(done.status, 'SCORED')
  const row = await waitFor(async () => {
    const r = await dbSession(done.id)
    return r?.mlSubjectDeletedAt ? r : null
  }, { what: 'ML cleanup of the returned id' })
  assert.match(row.mlSubjectId ?? '', /^auto_/)
  assert.ok(!h.ml.subjects.has(row.mlSubjectId!))
  assert.ok(h.ml.deleteCalls.includes(row.mlSubjectId!))
})

scenario('9. 5xx twice then OK; permanent 422 → FAILED (file kept) → retry → scored; FAILED file older than 24 h purged', async () => {
  const child = await childWithConsent(parentA, 'S9')

  h.ml.switches.failExtractTimes = 2
  const res = await upload(parentA, child.id, published['dang-tay'], { slug: 'dang-tay', scenario: 'identical' })
  assert.equal(res.status, 201)
  // While waiting for the retry the parent sees a friendly "retrying" text.
  const retrying = await waitFor(async () => {
    const r = await dbSession(res.body.session.id)
    return r && r.status === 'QUEUED' && r.attempts === 1 ? r : null
  }, { what: 'first retry to be scheduled' })
  assert.match(retrying.errorMessage ?? '', /tự thử lại/)
  const flaky = await waitSession(parentA, res.body.session.id)
  assert.equal(flaky.status, 'SCORED', JSON.stringify(flaky))
  assert.equal((await dbSession(flaky.id))!.attempts, 3)
  assert.equal(h.ml.extractCallsFor(`ex_${flaky.id}`).length, 3)

  h.ml.switches.extract422 = true
  const failed = await uploadAndWait(parentA, child.id, published['dang-tay'], { slug: 'dang-tay', scenario: 'identical' })
  assert.equal(failed.status, 'FAILED')
  assert.ok(failed.errorMessage && /[ạảãáàâăđêôơư]/.test(failed.errorMessage), failed.errorMessage)
  assert.ok(!/OpenPose|http|422|subject/i.test(failed.errorMessage), `technical text leaked: ${failed.errorMessage}`)
  assert.equal(failed.retryable, true)
  const failedRow = (await dbSession(failed.id))!
  assert.equal(failedRow.videoDeletedAt, null)
  assert.ok(h.exerciseFileExists(failedRow.filePath), 'FAILED keeps the video for retry')
  assert.equal(failedRow.attempts, 1, '4xx is not retried automatically')

  h.ml.switches.extract422 = false
  const retry = await api('POST', `/exercise-sessions/${failed.id}/retry`, { token: parentA.token })
  assert.equal(retry.status, 202, JSON.stringify(retry.body))
  assert.ok(['QUEUED', 'PROCESSING'].includes(retry.body.session.status), retry.body.session.status)
  const rescored = await waitSession(parentA, failed.id)
  assert.equal(rescored.status, 'SCORED')
  assert.ok(!h.exerciseFileExists(failedRow.filePath))
  const notAgain = await api('POST', `/exercise-sessions/${failed.id}/retry`, { token: parentA.token })
  assert.equal(notAgain.status, 409)
  assert.equal(notAgain.body.error, 'RETRY_NOT_AVAILABLE')

  // FAILED video past the 24 h retention → reconcile deletes it.
  h.ml.switches.extract422 = true
  const old = await uploadAndWait(parentA, child.id, published['dang-tay'], { slug: 'dang-tay', scenario: 'identical' })
  h.ml.switches.extract422 = false
  assert.equal(old.status, 'FAILED')
  const oldRow = (await dbSession(old.id))!
  assert.ok(h.exerciseFileExists(oldRow.filePath))
  const past = new Date(Date.now() - 25 * 60 * 60_000).toISOString()
  await h.prisma.$executeRaw`UPDATE "ExerciseSession" SET "updatedAt" = (${past}::timestamptz AT TIME ZONE 'UTC') WHERE "id" = ${old.id}`
  const purged = await waitFor(async () => {
    const r = await dbSession(old.id)
    return r?.videoDeletedAt ? r : null
  }, { timeoutMs: 30_000, what: 'reconcile to purge the expired FAILED video' })
  assert.ok(!h.exerciseFileExists(purged.filePath))
  assert.equal(purged.status, 'FAILED')
})

scenario('10. consent revoked while QUEUED → FAILED with the revoke text, file deleted, no ML call', async () => {
  const busy = await childWithConsent(parentA, 'S10-busy')
  const child = await childWithConsent(parentA, 'S10')
  h.ml.resetCounters()
  h.ml.hold()
  const first = await upload(parentA, busy.id, published['dang-tay'], { slug: 'dang-tay', scenario: 'identical' })
  assert.equal(first.status, 201)
  await waitMlBlocked()
  const queued = await upload(parentA, child.id, published['dang-tay'], { slug: 'dang-tay', scenario: 'identical' })
  assert.equal(queued.status, 201)
  assert.equal(queued.body.session.status, 'QUEUED')
  assert.equal(queued.body.session.mlBusy, true)
  assert.ok(queued.body.session.queuePosition >= 2)
  const queuedRow = (await dbSession(queued.body.session.id))!
  assert.ok(h.exerciseFileExists(queuedRow.filePath))

  const revoke = await api('DELETE', `/children/${child.id}/exercise-consent`, { token: parentA.token })
  assert.equal(revoke.status, 200)
  assert.equal(revoke.body.revoked, 1)
  h.ml.release()

  assert.equal((await waitSession(parentA, first.body.session.id)).status, 'SCORED')
  const failed = await waitSession(parentA, queued.body.session.id)
  assert.equal(failed.status, 'FAILED')
  assert.match(failed.errorMessage, /thu hồi/)
  assert.equal(failed.retryable, false)
  const row = (await dbSession(failed.id))!
  assert.ok(row.videoDeletedAt)
  assert.ok(!h.exerciseFileExists(row.filePath))
  assert.equal(row.mlSubjectId, null)
  assert.equal(h.ml.extractCallsFor(`ex_${failed.id}`).length, 0)

  const blocked = await upload(parentA, child.id, published['dang-tay'], { slug: 'dang-tay', scenario: 'identical' })
  assert.equal(blocked.status, 403)
  const consent = await api('GET', `/children/${child.id}/exercise-consent`, { token: parentA.token })
  assert.equal(consent.body.consent, null)
  assert.ok(consent.body.lastRevokedAt)
})

let pendingChildId = ''
let pendingSessionId = ''

scenario('11. post-score DELETE answers HTML 404 → SCORED with mlSubjectDeletedAt null → ML back → reconcile deletes', async () => {
  const child = await childWithConsent(parentA, 'S11')
  pendingChildId = child.id
  h.ml.switches.offlineDeletes = true
  const done = await uploadAndWait(parentA, child.id, published['dang-tay'], { slug: 'dang-tay', scenario: 'identical' })
  assert.equal(done.status, 'SCORED')
  pendingSessionId = done.id
  await sleep(1000)
  const row = (await dbSession(done.id))!
  assert.equal(row.mlSubjectDeletedAt, null)
  assert.ok(row.videoDeletedAt)
  assert.ok(h.ml.subjects.has(`ex_${done.id}`))
  const queue = await api('GET', '/admin/exercises/queue', { token: admin.token })
  assert.ok(queue.body.mlCleanupPending >= 1)

  // 12b (here, while the subject is still pending): ML offline → 503 and nothing deleted.
  h.ml.switches.offline = true
  const del = await api('DELETE', `/children/${child.id}`, { token: parentA.token })
  assert.equal(del.status, 503, JSON.stringify(del.body))
  assert.equal(del.body.error, 'ML_UNAVAILABLE')
  assert.ok(await h.prisma.childProfile.findUnique({ where: { id: child.id } }))
  assert.ok(await dbSession(done.id))
  assert.equal(await h.prisma.sessionScore.count({ where: { sessionId: done.id } }), 1)
  const delSession = await api('DELETE', `/exercise-sessions/${done.id}`, { token: parentA.token })
  assert.equal(delSession.status, 503)
  assert.equal(delSession.body.error, 'ML_UNAVAILABLE')

  h.ml.switches.offline = false
  h.ml.switches.offlineDeletes = false
  const cleaned = await waitFor(async () => {
    const r = await dbSession(done.id)
    return r?.mlSubjectDeletedAt ? r : null
  }, { timeoutMs: 30_000, what: 'reconcile to delete the ML subject' })
  assert.equal(cleaned.status, 'SCORED')
  assert.ok(!h.ml.subjects.has(`ex_${done.id}`))
})

scenario('12. deletion: PROCESSING → 409; all scored + ML offline → 200; normal → everything removed', async () => {
  // a) PROCESSING blocks child and session deletion.
  const busy = await childWithConsent(parentA, 'S12a')
  h.ml.hold()
  const up = await upload(parentA, busy.id, published['dang-tay'], { slug: 'dang-tay', scenario: 'identical' })
  assert.equal(up.status, 201)
  await waitMlBlocked()
  assert.equal((await dbSession(up.body.session.id))!.status, 'PROCESSING')
  const childDel = await api('DELETE', `/children/${busy.id}`, { token: parentA.token })
  assert.equal(childDel.status, 409)
  assert.equal(childDel.body.error, 'EXERCISE_IN_PROGRESS')
  const sessDel = await api('DELETE', `/exercise-sessions/${up.body.session.id}`, { token: parentA.token })
  assert.equal(sessDel.status, 409)
  assert.equal(sessDel.body.error, 'EXERCISE_IN_PROGRESS')
  h.ml.release()
  assert.equal((await waitSession(parentA, up.body.session.id)).status, 'SCORED')

  // b) covered in scenario 11 (pending ML subject + ML offline → 503, nothing deleted).
  // c) all sessions scored and cleaned, ML offline → 200 (no ML call needed).
  assert.ok(pendingChildId, 'scenario 11 must have run')
  h.ml.switches.offline = true
  const offlineDel = await api('DELETE', `/children/${pendingChildId}`, { token: parentA.token })
  h.ml.switches.offline = false
  assert.equal(offlineDel.status, 200, JSON.stringify(offlineDel.body))
  assert.equal(offlineDel.body.deletedExerciseSessions, 1)
  assert.equal(offlineDel.body.mlSubjectsDeleted, 0)
  assert.equal(await dbSession(pendingSessionId), null)

  // d) normal deletion: scored + failed (file kept) sessions and a questionnaire.
  const child = await childWithConsent(parentA, 'S12d', 20)
  const scored = await uploadAndWait(parentA, child.id, published['dang-tay'], { slug: 'dang-tay', scenario: 'identical' })
  assert.equal(scored.status, 'SCORED')
  h.ml.switches.extract422 = true
  const failed = await uploadAndWait(parentA, child.id, published['dang-tay'], { slug: 'dang-tay', scenario: 'identical' })
  h.ml.switches.extract422 = false
  assert.equal(failed.status, 'FAILED')
  const failedRow = (await dbSession(failed.id))!
  assert.ok(h.exerciseFileExists(failedRow.filePath))
  const answers = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [String(i + 1), ![2, 5, 12].includes(i + 1)]))
  const q = await api('POST', `/children/${child.id}/questionnaires`, {
    token: parentA.token,
    json: { instrument: 'MCHAT_RF', respondent: 'MOTHER', answers, consentAccepted: true, consentVersion: QUESTIONNAIRE_CONSENT_VERSION },
  })
  assert.equal(q.status, 201, JSON.stringify(q.body))

  const ok = await api('DELETE', `/children/${child.id}`, { token: parentA.token })
  assert.equal(ok.status, 200, JSON.stringify(ok.body))
  assert.equal(ok.body.deleted, true)
  assert.equal(ok.body.deletedExerciseSessions, 2)
  assert.equal(ok.body.deletedQuestionnaires, 1)
  assert.equal(await h.prisma.childProfile.count({ where: { id: child.id } }), 0)
  assert.equal(await h.prisma.exerciseSession.count({ where: { childId: child.id } }), 0)
  assert.equal(await h.prisma.sessionScore.count({ where: { sessionId: { in: [scored.id, failed.id] } } }), 0)
  assert.equal(await h.prisma.questionnaireResponse.count({ where: { childId: child.id } }), 0)
  assert.equal(await h.prisma.consentRecord.count({ where: { childId: child.id } }), 0)
  assert.ok(!h.exerciseFileExists(failedRow.filePath), 'kept FAILED video must be deleted with the child')
  assert.ok(!h.ml.subjects.has(`ex_${scored.id}`) && !h.ml.subjects.has(`ex_${failed.id}`))
})

scenario('13. stale lock (lockedAt 3 min ago) → re-queued → scored', async () => {
  const child = await childWithConsent(parentA, 'S13')
  const consent = await h.prisma.consentRecord.findFirstOrThrow({ where: { childId: child.id, revokedAt: null } })
  const id = randomUUID()
  const clip = buildScenario('dang-tay', 'identical')
  const data = encodeClip({ slug: 'dang-tay', scenario: 'identical' })
  const dir = path.join(h.backendCwd, 'uploads', 'exercises')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, `${id}.mp4`), data)
  await h.prisma.exerciseSession.create({
    data: {
      id,
      userId: parentA.id,
      childId: child.id,
      exerciseId: published['dang-tay'].exerciseId,
      templateId: published['dang-tay'].templateId,
      consentId: consent.id,
      status: 'PROCESSING',
      recordedVia: 'UPLOAD',
      practiceMode: 'AFTER_DEMO',
      playbackRate: 1,
      storedFilename: `${id}.mp4`,
      filePath: `uploads/exercises/${id}.mp4`,
      mimeType: 'video/mp4',
      fileSize: data.length,
      durationMs: clip.durationMs,
      videoWidth: 960,
      videoHeight: 540,
      attempts: 1,
      maxAttempts: 3,
      lockedBy: 'crashed-worker:e2e',
      lockedAt: new Date(Date.now() - 3 * 60_000),
    },
  })
  const done = await waitSession(parentA, id, { timeoutMs: 45_000 })
  assert.equal(done.status, 'SCORED', JSON.stringify(done))
  assert.ok(done.score.overall >= 90)
  assert.ok(h.logContains(`recovered stale session ${id}`))
  assert.equal((await dbSession(id))!.attempts, 2)
})

scenario('14. GPU sharing: one screening + one exercise with ML_MAX_CONCURRENCY=1 → ≤ 1 concurrent heavy call', async () => {
  const child = await childWithConsent(parentA, 'S14')
  const consent = await api('POST', `/children/${child.id}/consent`, {
    token: parentA.token,
    json: { accepted: true, version: CONSENT_VERSION, scopes: ['VIDEO_PROCESSING'] },
  })
  assert.equal(consent.status, 201)
  h.ml.resetCounters()
  h.ml.switches.heavyDelayMs = 1500
  let bothSubmittedAt = 0
  try {
    const form = new FormData()
    form.append('childId', child.id)
    form.append('durationMs', '10000')
    form.append('video', new Blob([new Uint8Array(encodeClip({ screening: true }))], { type: 'video/mp4' }), 'di-bo.mp4')
    const screening = await api('POST', `/screenings/upload?childId=${child.id}`, { token: parentA.token, form })
    assert.equal(screening.status, 201, JSON.stringify(screening.body))
    const videoId = screening.body.video.id
    const proc = await api('POST', `/screenings/${videoId}/process`, { token: parentA.token })
    assert.equal(proc.status, 202, JSON.stringify(proc.body))
    const exercise = await upload(parentA, child.id, published['dang-tay'], { slug: 'dang-tay', scenario: 'identical' })
    assert.equal(exercise.status, 201)
    bothSubmittedAt = Date.now()

    const done = await waitSession(parentA, exercise.body.session.id)
    assert.equal(done.status, 'SCORED')
    await waitFor(async () => {
      const s = await api('GET', `/screenings/${videoId}`, { token: parentA.token })
      return s.body?.screening?.status === 'COMPLETED'
    }, { timeoutMs: 60_000, what: 'screening to complete' })
  } finally {
    h.ml.switches.heavyDelayMs = 0
  }
  assert.equal(h.ml.pipelineCalls, 1)
  assert.ok(h.ml.heavyLog.some((c) => c.kind === 'extract'))
  assert.equal(h.ml.heavyMaxConcurrent, 1, `max concurrent heavy calls ${h.ml.heavyMaxConcurrent}`)
  // Both jobs were waiting for the GPU at the same time (otherwise the check above proves nothing).
  const [first, second] = [...h.ml.heavyLog].sort((a, b) => a.start - b.start)
  assert.ok(first && second, JSON.stringify(h.ml.heavyLog))
  assert.ok(first.end > bothSubmittedAt, 'the second job was submitted while the first heavy call was running')
  assert.ok(second.start >= first.end, 'heavy calls must not overlap')
})

scenario('15. auth isolation, admin 403, TOO_MANY_PENDING, TEMPLATE_OUTDATED, v2 starts a new series', async () => {
  // Another parent sees nothing of parent A.
  const child = await childWithConsent(parentA, 'S15')
  const own = await uploadAndWait(parentA, child.id, published['dang-tay'], { slug: 'dang-tay', scenario: 'identical' })
  const asB = { token: parentB.token }
  const checks: Array<[string, string, number]> = [
    ['GET', `/exercise-sessions/${own.id}`, 404],
    ['POST', `/exercise-sessions/${own.id}/retry`, 404],
    ['DELETE', `/exercise-sessions/${own.id}`, 404],
    ['GET', `/exercise-sessions?childId=${child.id}`, 404],
    ['GET', `/children/${child.id}/exercise-progress`, 404],
    ['GET', `/children/${child.id}/exercise-consent`, 404],
    ['DELETE', `/children/${child.id}/exercise-consent`, 404],
    ['GET', `/exercises?childId=${child.id}`, 404],
  ]
  for (const [method, url, status] of checks) {
    const res = await api(method, url, asB)
    assert.equal(res.status, status, `${method} ${url} → ${res.status}`)
  }
  const grantB = await api('POST', `/children/${child.id}/exercise-consent`, {
    ...asB,
    json: { accepted: true, version: EXERCISE_CONSENT_VERSION, scopes: ['EXERCISE_VIDEO'] },
  })
  assert.equal(grantB.status, 404)
  const uploadB = await upload(parentB, child.id, published['dang-tay'], { slug: 'dang-tay', scenario: 'identical' })
  assert.equal(uploadB.status, 404)
  assert.equal(uploadB.body.error, 'CHILD_NOT_FOUND')
  assert.equal((await api('GET', `/exercise-sessions/${own.id}`, { token: parentA.token })).status, 200)

  for (const [method, url] of [['GET', '/admin/exercises'], ['POST', '/admin/exercises/builtins/sync'], ['GET', '/admin/exercises/queue']]) {
    const res = await api(method, url, { token: parentA.token })
    assert.equal(res.status, 403, `${method} ${url}`)
  }

  // TOO_MANY_PENDING on the 4th pending upload.
  const busy = await childWithConsent(parentA, 'S15-pending')
  h.ml.hold()
  const pending: string[] = []
  for (let i = 0; i < 3; i += 1) {
    const r = await upload(parentA, busy.id, published['dang-tay'], { slug: 'dang-tay', scenario: 'identical', seed: i + 2 })
    assert.equal(r.status, 201, JSON.stringify(r.body))
    pending.push(r.body.session.id)
    if (i === 0) await waitMlBlocked()
  }
  const filesBefore = h.exerciseFiles().length
  const fourth = await upload(parentA, busy.id, published['dang-tay'], { slug: 'dang-tay', scenario: 'identical' })
  assert.equal(fourth.status, 429)
  assert.equal(fourth.body.error, 'TOO_MANY_PENDING')
  assert.equal(fourth.body.limit, 3)
  assert.equal(h.exerciseFiles().length, filesBefore)
  h.ml.release()
  for (const id of pending) assert.equal((await waitSession(parentA, id)).status, 'SCORED')

  // Admin template v1 (scenario 3) scores a matching child; v2 → TEMPLATE_OUTDATED and a new series.
  const target = published['e2e-dang-tay-nguoi-lon']
  assert.ok(target, 'scenario 3 must have run')
  const v1 = await uploadAndWait(parentA, child.id, target, { slug: 'dang-tay', scenario: 'identical' })
  assert.equal(v1.status, 'SCORED')
  assert.ok(v1.score.overall >= 90, `admin template v1 overall ${v1.score.overall}`)

  const v2 = await api('POST', `/admin/exercises/${adminExerciseId}/templates`, {
    token: admin.token,
    json: { sourceSubjectId: adminSourceSubject, mirrorPolicy: 'ANATOMICAL_ONLY', attestation: true },
  })
  assert.equal(v2.status, 201, JSON.stringify(v2.body))
  assert.equal(v2.body.template.version, 2)
  assert.notEqual(v2.body.template.templateHash, undefined)
  const pub = await api('POST', `/admin/exercises/${adminExerciseId}/publish`, { token: admin.token, json: { templateId: v2.body.template.id } })
  assert.equal(pub.status, 200)

  const outdated = await upload(parentA, child.id, target, { slug: 'dang-tay', scenario: 'identical' })
  assert.equal(outdated.status, 409)
  assert.equal(outdated.body.error, 'TEMPLATE_OUTDATED')
  assert.equal(outdated.body.currentTemplateId, v2.body.template.id)

  await refreshPublished()
  const second = await uploadAndWait(parentA, child.id, published['e2e-dang-tay-nguoi-lon'], { slug: 'dang-tay', scenario: 'identical' })
  assert.equal(second.status, 'SCORED')
  assert.equal(second.templateVersion, 2)

  const progress = await api('GET', `/children/${child.id}/exercise-progress`, { token: parentA.token })
  assert.equal(progress.status, 200)
  const entry = progress.body.exercises.find((e: { exercise: { id: string } }) => e.exercise.id === adminExerciseId)
  assert.ok(entry, JSON.stringify(progress.body))
  assert.equal(entry.series.length, 2)
  assert.deepEqual(entry.series.map((s: { templateVersion: number }) => s.templateVersion).sort(), [1, 2])
  assert.notEqual(entry.series[0].key, entry.series[1].key)
})

scenario('16. consent isolation between screening and exercise namespaces', async () => {
  const child = await childWithConsent(parentA, 'S16')
  const screeningGrant = await api('POST', `/children/${child.id}/consent`, {
    token: parentA.token,
    json: { accepted: true, version: CONSENT_VERSION, scopes: ['VIDEO_PROCESSING'] },
  })
  assert.equal(screeningGrant.status, 201)
  let ex = await api('GET', `/children/${child.id}/exercise-consent`, { token: parentA.token })
  assert.ok(ex.body.consent, 'new-code screening grant must keep exercise consent')
  assert.equal(ex.body.consent.version, EXERCISE_CONSENT_VERSION)

  const screeningRevoke = await api('DELETE', `/children/${child.id}/consent`, { token: parentA.token })
  assert.equal(screeningRevoke.status, 200)
  assert.equal(screeningRevoke.body.revoked, 1)
  ex = await api('GET', `/children/${child.id}/exercise-consent`, { token: parentA.token })
  assert.ok(ex.body.consent, 'new-code screening revoke must keep exercise consent')

  // Old backend revision: revoke every active record of the child, no version filter.
  await h.prisma.consentRecord.updateMany({ where: { childId: child.id, revokedAt: null }, data: { revokedAt: new Date() } })
  ex = await api('GET', `/children/${child.id}/exercise-consent`, { token: parentA.token })
  assert.equal(ex.body.consent, null)
  assert.ok(ex.body.lastRevokedAt, JSON.stringify(ex.body))

  // An exercise consent never counts as a screening consent.
  const only = await childWithConsent(parentA, 'S16-only-exercise')
  const screeningConsent = await api('GET', `/children/${only.id}/consent`, { token: parentA.token })
  assert.equal(screeningConsent.body.consent, null)
  const detail = await api('GET', `/children/${only.id}`, { token: parentA.token })
  assert.equal(detail.body.child.summary.hasActiveConsent, false)
  const list = await api('GET', '/children', { token: parentA.token })
  const listed = list.body.children.find((c: { id: string }) => c.id === only.id)
  assert.equal(listed.summary.hasActiveConsent, false)
  const form = new FormData()
  form.append('childId', only.id)
  form.append('video', new Blob([new Uint8Array(encodeClip({ screening: true }))], { type: 'video/mp4' }), 'di-bo.mp4')
  const screening = await api('POST', `/screenings/upload?childId=${only.id}`, { token: parentA.token, form })
  assert.equal(screening.status, 403)
  assert.equal(screening.body.error, 'CONSENT_REQUIRED')
})

scenario('extra. single-session delete, admin stats/queue, skeleton guard, archive, admin delete, source-subject delete', async () => {
  // Parent deletes one scored attempt.
  const child = await childWithConsent(parentA, 'SX')
  const done = await uploadAndWait(parentA, child.id, published['dang-tay'], { slug: 'dang-tay', scenario: 'identical' })
  const del = await api('DELETE', `/exercise-sessions/${done.id}`, { token: parentA.token })
  assert.equal(del.status, 200, JSON.stringify(del.body))
  assert.equal(del.body.deleted, true)
  assert.equal(await dbSession(done.id), null)
  assert.equal(await h.prisma.sessionScore.count({ where: { sessionId: done.id } }), 0)
  assert.equal((await api('GET', `/exercise-sessions/${done.id}`, { token: parentA.token })).status, 404)

  // Admin statistics carry no child names.
  const stats = await api('GET', '/admin/stats', { token: admin.token })
  assert.equal(stats.status, 200)
  assert.equal(typeof stats.body.exerciseQueue?.queued, 'number', JSON.stringify(stats.body.exerciseQueue))
  assert.equal(typeof stats.body.questionnaires?.total, 'number')
  const exStats = await api('GET', `/admin/exercises/${published['dang-tay'].exerciseId}/stats`, { token: admin.token })
  assert.equal(exStats.status, 200)
  assert.ok(exStats.body.attempts > 0)
  assert.equal(exStats.body.histogram10.length, 10)
  const queue = await api('GET', '/admin/exercises/queue', { token: admin.token })
  for (const f of queue.body.recentFailures) assert.deepEqual(Object.keys(f).sort(), ['createdAt', 'id', 'lastError'])
  const queueText = JSON.stringify(queue.body) + JSON.stringify(exStats.body)
  assert.ok(!queueText.includes('(E2E)'), 'admin exercise views must not contain child names')

  // Admin Skeleton never exposes exercise/template subjects.
  assert.ok(h.ml.subjects.has(adminSourceSubject))
  const listSk = await api('GET', '/admin/skeleton/subjects/list', { token: admin.token })
  assert.equal(listSk.status, 200)
  assert.ok(!listSk.body.subjects.some((s: { subject_id: string }) => /^(ex|tpl)_/.test(s.subject_id)))
  for (const [method, url] of [
    ['GET', `/admin/skeleton/${adminSourceSubject}`],
    ['GET', `/admin/skeleton/${adminSourceSubject}/keypoints`],
    ['DELETE', `/admin/skeleton/${adminSourceSubject}`],
    ['GET', `/admin/skeleton/ex_${randomUUID()}/keypoints`],
  ]) {
    const res = await api(method, url, { token: admin.token })
    assert.equal(res.status, 403, `${method} ${url}`)
    assert.equal(res.body.error, 'EXERCISE_SUBJECT_PROTECTED')
  }

  // Archived exercises disappear for parents.
  const archived = await api('PATCH', `/admin/exercises/${published['gio-tay-chao'].exerciseId}`, { token: admin.token, json: { status: 'ARCHIVED' } })
  assert.equal(archived.status, 200)
  assert.ok(!(await refreshPublished()).some((e) => e.slug === 'gio-tay-chao'))
  assert.equal((await api('GET', `/exercises/${published['gio-tay-chao'].exerciseId}`, { token: parentA.token })).status, 404)

  // Exercises with attempts cannot be deleted; an unused one is deleted with its tpl_ subject.
  const busy = await api('DELETE', `/admin/exercises/${published['dang-tay'].exerciseId}`, { token: admin.token })
  assert.equal(busy.status, 409)
  assert.equal(busy.body.error, 'EXERCISE_HAS_SESSIONS')
  const spare = await api('POST', '/admin/exercises', {
    token: admin.token,
    json: { slug: 'e2e-xoa-thu', title: 'Bài xoá thử', description: '', childPrompt: '', difficulty: 2, bodyFocus: ['TRUNK'] },
  })
  assert.equal(spare.status, 201)
  const form = new FormData()
  form.append('attestation', 'true')
  form.append('video', new Blob([new Uint8Array(encodeClip({ template: 'nghieng-nguoi' }))], { type: 'video/mp4' }), 'mau.mp4')
  const src = await api('POST', `/admin/exercises/${spare.body.exercise.id}/template-sources`, { token: admin.token, form })
  assert.equal(src.status, 201, JSON.stringify(src.body))
  const comp = await api('POST', `/admin/exercises/${spare.body.exercise.id}/templates`, {
    token: admin.token,
    json: { sourceSubjectId: src.body.sourceSubjectId, mirrorPolicy: 'EITHER', attestation: true },
  })
  assert.equal(comp.status, 201, JSON.stringify(comp.body))
  const removed = await api('DELETE', `/admin/exercises/${spare.body.exercise.id}`, { token: admin.token })
  assert.equal(removed.status, 200, JSON.stringify(removed.body))
  assert.ok(!h.ml.subjects.has(src.body.sourceSubjectId), 'tpl_ subject must be deleted with the exercise')
  assert.equal(await h.prisma.exerciseTemplate.count({ where: { exerciseId: spare.body.exercise.id } }), 0)

  // The admin can drop the adult source recording; the compiled template stays.
  const tpl = await h.prisma.exerciseTemplate.findFirstOrThrow({ where: { exerciseId: adminExerciseId, version: 1 } })
  const dropSource = await api('DELETE', `/admin/exercises/${adminExerciseId}/templates/${tpl.id}/source-subject`, { token: admin.token })
  assert.equal(dropSource.status, 200, JSON.stringify(dropSource.body))
  assert.ok(!h.ml.subjects.has(adminSourceSubject))
  const adminList = await api('GET', '/admin/exercises', { token: admin.token })
  const mine = adminList.body.exercises.find((e: { id: string }) => e.id === adminExerciseId)
  assert.equal(mine.templates.find((t: { id: string }) => t.id === tpl.id).sourceMlSubjectDeleted, true)
})

scenario('extra. upload validation: too long / too short / out-of-range fields, file always unlinked', async () => {
  const child = await childWithConsent(parentA, 'SV')
  const target = published['dang-tay']
  const clip = { slug: 'dang-tay', scenario: 'identical' as ScenarioName }
  const before = h.exerciseFiles().length
  const tooLong = await upload(parentA, child.id, target, clip, { fields: { durationMs: 59_000 } })
  assert.equal(tooLong.status, 422, JSON.stringify(tooLong.body))
  assert.equal(tooLong.body.error, 'RECORDING_TOO_LONG')
  assert.ok(tooLong.body.maxMs < 59_000)
  const tooShort = await upload(parentA, child.id, target, clip, { fields: { durationMs: 1000 } })
  assert.equal(tooShort.status, 422)
  assert.equal(tooShort.body.error, 'RECORDING_TOO_SHORT')
  assert.ok(tooShort.body.minMs > 1000)
  for (const fields of [{ durationMs: 60_001 }, { durationMs: 999 }, { playbackRate: 0.5 }, { recordedVia: 'PHONE' }]) {
    const res = await upload(parentA, child.id, target, clip, { fields })
    assert.equal(res.status, 400, JSON.stringify(fields))
    assert.equal(res.body.error, 'VALIDATION_ERROR')
  }
  const wrongType = await upload(parentA, child.id, target, clip, { file: { name: 'anh.png', type: 'image/png' } })
  assert.equal(wrongType.status, 400)
  assert.equal(wrongType.body.error, 'UNSUPPORTED_FILE_TYPE')
  const missingIds = await api('POST', '/exercise-sessions/upload', { token: parentA.token, form: clipForm(clip, { durationMs: 9000 }) })
  assert.equal(missingIds.status, 400)
  assert.equal(missingIds.body.error, 'MISSING_CHILD_ID')
  await waitFor(() => h.exerciseFiles().length === before, { timeoutMs: 5000, what: 'rejected uploads to be unlinked' })
  assert.equal(await h.prisma.exerciseSession.count({ where: { childId: child.id } }), 0)
})

scenario('extra. row deleted by an older backend while scoring → worker discards the video and the ML subject', async () => {
  const child = await childWithConsent(parentA, 'S-vanish')
  h.ml.hold()
  const res = await upload(parentA, child.id, published['dang-tay'], { slug: 'dang-tay', scenario: 'identical' })
  assert.equal(res.status, 201)
  await waitMlBlocked()
  const row = (await dbSession(res.body.session.id))!
  // Old code: the child delete cascades at DB level without asking anyone.
  await h.prisma.childProfile.delete({ where: { id: child.id } })
  h.ml.release()
  await waitFor(() => h.logContains(`session ${row.id} was deleted during scoring`), { timeoutMs: 20_000, what: 'discard log line' })
  assert.ok(!h.exerciseFileExists(row.filePath), 'the orphaned video must be deleted')
  assert.ok(!h.ml.subjects.has(`ex_${row.id}`), 'the orphaned ML subject must be deleted')
})

// ---------------------------------------------------------------------------
// 7. .webm against ML 1.0
// ---------------------------------------------------------------------------

scenario('7a. legacy ML: .webm → 415 with no file left; .mp4 still scored (fps from duration)', async () => {
  h.ml.reset()
  h.ml.switches.mode = 'legacy'
  await h.startBackend()
  const caps = await api('GET', '/exercises/capabilities', { token: parentA.token })
  assert.equal(caps.body.mlLegacy, true)
  assert.equal(caps.body.acceptsWebm, false)
  assert.ok(!caps.body.acceptedExtensions.includes('.webm'))

  const child = await childWithConsent(parentA, 'S7a')
  const before = h.exerciseFiles()
  const webm = await upload(parentA, child.id, published['dang-tay'], { slug: 'dang-tay', scenario: 'identical' }, {
    file: { name: 'ghi-hinh.webm', type: 'video/webm' },
    fields: { recordedVia: 'WEBCAM' },
  })
  assert.equal(webm.status, 415, JSON.stringify(webm.body))
  assert.equal(webm.body.error, 'RECORDING_FORMAT_UNSUPPORTED')
  // The route unlinks without awaiting; give it a moment.
  await waitFor(() => h.exerciseFiles().length === before.length, { timeoutMs: 5000, what: 'rejected upload to be unlinked' })
  assert.deepEqual(h.exerciseFiles(), before)
  assert.equal(await h.prisma.exerciseSession.count({ where: { childId: child.id } }), 0)

  const mp4 = await uploadAndWait(parentA, child.id, published['dang-tay'], { slug: 'dang-tay', scenario: 'identical' })
  assert.equal(mp4.status, 'SCORED', JSON.stringify(mp4))
  assert.ok(mp4.score.overall >= 90)
})

scenario('7b. legacy ML + EXERCISE_WEBM_AS_MKV=true: .webm accepted and sent as session.mkv', async () => {
  h.ml.switches.mode = 'legacy'
  await h.startBackend({ env: { EXERCISE_WEBM_AS_MKV: 'true' } })
  const caps = await api('GET', '/exercises/capabilities', { token: parentA.token })
  assert.equal(caps.body.acceptsWebm, true)
  const child = await childWithConsent(parentA, 'S7b')
  h.ml.resetCounters()
  const done = await uploadAndWait(parentA, child.id, published['dang-tay'], { slug: 'dang-tay', scenario: 'identical' }, {
    file: { name: 'ghi-hinh.webm', type: 'video/webm' },
    fields: { recordedVia: 'WEBCAM' },
  })
  assert.equal(done.status, 'SCORED', JSON.stringify(done))
  const call = h.ml.extractCallsFor(`ex_${done.id}`)[0]
  assert.equal(call.filename, 'session.mkv')
  assert.equal(call.mimeType, 'video/x-matroska')
  h.ml.reset()
})

scenario('extra. ML unreachable at upload, back before the retry → the retry re-probes and scores', async () => {
  h.ml.reset()
  h.ml.switches.offline = true
  await h.startBackend() // fresh capability cache, first probe sees the offline tunnel
  const caps = await api('GET', '/exercises/capabilities', { token: parentA.token })
  assert.equal(caps.body.mlReachable, false)
  const child = await childWithConsent(parentA, 'S-offline')
  const res = await upload(parentA, child.id, published['dang-tay'], { slug: 'dang-tay', scenario: 'identical' })
  assert.equal(res.status, 201, JSON.stringify(res.body))
  await waitFor(async () => {
    const r = await dbSession(res.body.session.id)
    return r && r.status === 'QUEUED' && r.attempts === 1
  }, { what: 'first attempt to fail while ML is offline' })
  h.ml.switches.offline = false
  const done = await waitSession(parentA, res.body.session.id)
  assert.equal(done.status, 'SCORED', `ML came back before the retry but the session ended ${done.status}: ${done.errorMessage}`)
})

// ---------------------------------------------------------------------------
// 17. Unmigrated database
// ---------------------------------------------------------------------------

scenario('17. unmigrated DB: exercise routes 503, worker pauses, child deletion and screening still work', async () => {
  h.ml.reset()
  const old = h.client(h.oldUrl)
  const make = (key: string, role: 'ADMIN' | 'USER') =>
    old.user.create({ data: { name: `E2E cũ ${key}`, email: `${key}@e2e-old.test`, role, passwordHash: '!e2e-no-login' } })
  const oldAdminRow = await make('admin', 'ADMIN')
  const oldParentRow = await make('parent', 'USER')
  const oldAdmin = { token: h.tokenFor({ ...oldAdminRow, role: 'ADMIN' }) }
  const oldParent = { token: h.tokenFor({ ...oldParentRow, role: 'USER' }) }

  await h.startBackend({ db: 'old', cwdName: 'backend-cwd-premigration' })
  const caps = await api('GET', '/exercises/capabilities', oldParent)
  assert.equal(caps.status, 200)

  const created = await api('POST', '/children', {
    ...oldParent,
    json: { fullName: 'Bé cũ (E2E)', dateOfBirth: '2023-01-15', gender: 'FEMALE' },
  })
  assert.equal(created.status, 201, JSON.stringify(created.body))
  const childId = created.body.child.id

  for (const [method, url, auth] of [
    ['GET', '/exercises', oldParent],
    ['GET', `/exercises?childId=${childId}`, oldParent],
    ['GET', `/exercise-sessions?childId=${childId}`, oldParent],
    ['GET', `/children/${childId}/exercise-progress`, oldParent],
    ['GET', '/admin/exercises', oldAdmin],
    ['GET', `/children/${childId}/questionnaires`, oldParent],
  ] as Array<[string, string, { token: string }]>) {
    const res = await api(method, url, auth)
    assert.equal(res.status, 503, `${method} ${url} → ${res.status} ${JSON.stringify(res.body)}`)
    assert.equal(res.body.error, 'DATABASE_MIGRATION_REQUIRED')
  }
  const qs = new URLSearchParams({ childId, exerciseId: randomUUID(), templateId: randomUUID() })
  const up = await api('POST', `/exercise-sessions/upload?${qs}`, {
    ...oldParent,
    form: clipForm({ slug: 'dang-tay', scenario: 'identical' }, { durationMs: 10000, recordedVia: 'UPLOAD', practiceMode: 'AFTER_DEMO' }),
  })
  assert.equal(up.status, 503)
  assert.deepEqual(h.exerciseFiles(), [], 'no exercise file may be written on an unmigrated DB')

  await waitFor(() => h.logContains('[exercise-queue] paused'), { timeoutMs: 15_000, what: 'worker pause log line' })

  // Screening still works end to end.
  const consent = await api('POST', `/children/${childId}/consent`, {
    ...oldParent,
    json: { accepted: true, version: CONSENT_VERSION, scopes: ['VIDEO_PROCESSING'] },
  })
  assert.equal(consent.status, 201)
  const form = new FormData()
  form.append('childId', childId)
  form.append('video', new Blob([new Uint8Array(encodeClip({ screening: true }))], { type: 'video/mp4' }), 'di-bo.mp4')
  const screening = await api('POST', `/screenings/upload?childId=${childId}`, { ...oldParent, form })
  assert.equal(screening.status, 201, JSON.stringify(screening.body))
  const proc = await api('POST', `/screenings/${screening.body.video.id}/process`, oldParent)
  assert.equal(proc.status, 202)
  await waitFor(async () => {
    const s = await api('GET', `/screenings/${screening.body.video.id}`, oldParent)
    return s.body?.screening?.status === 'COMPLETED'
  }, { timeoutMs: 60_000, what: 'screening on the unmigrated DB' })

  // Child deletion works (exercise/questionnaire steps skipped).
  const del = await api('DELETE', `/children/${childId}`, oldParent)
  assert.equal(del.status, 200, JSON.stringify(del.body))
  assert.equal(del.body.deletedScreenings, 1)
  assert.equal(del.body.deletedExerciseSessions, 0)
  assert.equal(del.body.deletedQuestionnaires, 0)
  assert.equal(await old.childProfile.count({ where: { id: childId } }), 0)
  await h.stopBackend()
})

// ---------------------------------------------------------------------------
// 18. Old Prisma client on the migrated DB
// ---------------------------------------------------------------------------

scenario('18. old client (pre-change schema) on the migrated DB: no P2022/P2032, cascade removes new rows; migrate diff empty', async () => {
  await h.stopBackend()
  // Data an old revision must cope with: a child with an exercise session + score and a questionnaire.
  await h.startBackend()
  const child = await childWithConsent(parentA, 'S18', 20)
  const scored = await uploadAndWait(parentA, child.id, published['dang-tay'], { slug: 'dang-tay', scenario: 'identical' })
  assert.equal(scored.status, 'SCORED')
  const answers = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [String(i + 1), true]))
  const q = await api('POST', `/children/${child.id}/questionnaires`, {
    token: parentA.token,
    json: { instrument: 'MCHAT_RF', respondent: 'FATHER', answers, consentAccepted: true, consentVersion: QUESTIONNAIRE_CONSENT_VERSION },
  })
  assert.equal(q.status, 201)
  await h.stopBackend()

  // Pre-change schema = introspection of the DB that only has the old migrations.
  // Generated under backend/node_modules so it resolves @prisma/client/runtime;
  // the shared node_modules/.prisma/client is not touched.
  const dir = path.join(BACKEND_DIR, 'node_modules', `.aimbrace-e2e-oldclient-${process.pid}`)
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  try {
    const out = path.join(dir, 'client').replace(/\\/g, '/')
    fs.writeFileSync(
      path.join(dir, 'schema.prisma'),
      `generator client {\n  provider = "prisma-client-js"\n  output   = "${out}"\n}\n\ndatasource db {\n  provider = "postgresql"\n  url      = env("DATABASE_URL")\n}\n`,
    )
    const cwd = path.join(h.root, 'oldclient-cwd')
    fs.mkdirSync(cwd, { recursive: true })
    const pull = await h.prismaCli(['db', 'pull', '--schema', path.join(dir, 'schema.prisma')], h.oldUrl, cwd)
    assert.equal(pull.code, 0, pull.stdout + pull.stderr)
    const pulled = fs.readFileSync(path.join(dir, 'schema.prisma'), 'utf8')
    assert.ok(pulled.includes('model ChildProfile') && !pulled.includes('ExerciseSession'), 'introspected schema is pre-change')
    const gen = await h.prismaCli(['generate', '--schema', path.join(dir, 'schema.prisma')], h.oldUrl, cwd)
    assert.equal(gen.code, 0, gen.stdout + gen.stderr)

    const script = path.join(dir, 'oldcode.cjs')
    fs.writeFileSync(
      script,
      [
        "const { randomUUID } = require('node:crypto')",
        "const { PrismaClient } = require('./client')",
        'const prisma = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL })',
        'const [userId, childId] = process.argv.slice(2)',
        'async function main() {',
        '  const out = {}',
        '  // Introspected client: no client-side @default(uuid()), relation fields named by introspection.',
        '  const children = await prisma.childProfile.findMany({ where: { userId } })',
        '  out.children = children.length',
        '  out.consentsSeen = (await prisma.consentRecord.findMany({ where: { userId } })).length',
        '  out.users = (await prisma.user.findMany()).length',
        '  // Old grant: revokes every active record of the child (no version filter).',
        '  await prisma.$transaction([',
        '    prisma.consentRecord.updateMany({ where: { childId, revokedAt: null }, data: { revokedAt: new Date() } }),',
        "    prisma.consentRecord.create({ data: { id: randomUUID(), userId, childId, version: '2026-10-05', scopes: ['VIDEO_PROCESSING'], statement: { old: true } } }),",
        '  ])',
        "  const upload = await prisma.videoUpload.create({ data: { id: randomUUID(), userId, childId, originalFilename: 'cu.mp4', storedFilename: 'x.mp4', filePath: 'uploads/x.mp4', mimeType: 'video/mp4', fileSize: 1 } })",
        '  out.upload = Boolean(upload.id)',
        '  out.uploadsAfter = (await prisma.videoUpload.findMany({ where: { childId } })).length',
        '  await prisma.childProfile.delete({ where: { id: childId } })',
        '  out.deleted = true',
        '  console.log(JSON.stringify(out))',
        '}',
        'main().catch((e) => { console.error(e && e.code, e && e.message); process.exitCode = 1 }).finally(() => prisma.$disconnect())',
      ].join('\n'),
    )
    const { spawn } = await import('node:child_process')
    const result = await new Promise<{ code: number | null; out: string }>((resolve) => {
      const child2 = spawn(process.execPath, [script, parentA.id, child.id], {
        cwd,
        env: { ...minimalEnv(), DATABASE_URL: h.mainUrl },
        windowsHide: true,
      })
      let text = ''
      child2.stdout.on('data', (d) => (text += d.toString()))
      child2.stderr.on('data', (d) => (text += d.toString()))
      child2.on('close', (code) => resolve({ code, out: text }))
    })
    assert.equal(result.code, 0, result.out)
    assert.ok(!/P2022|P2032/.test(result.out), result.out)
    const report = JSON.parse(result.out.trim().split(/\r?\n/).pop()!)
    assert.equal(report.deleted, true)
    assert.ok(report.children >= 1)

    assert.equal(await h.prisma.childProfile.count({ where: { id: child.id } }), 0)
    assert.equal(await h.prisma.exerciseSession.count({ where: { childId: child.id } }), 0)
    assert.equal(await h.prisma.sessionScore.count({ where: { sessionId: scored.id } }), 0)
    assert.equal(await h.prisma.questionnaireResponse.count({ where: { childId: child.id } }), 0)

    const diffCwd = path.join(h.root, 'prisma-main')
    const diff = await h.prismaCli(
      ['migrate', 'diff', '--from-url', h.mainUrl, '--to-schema-datamodel', path.join(diffCwd, 'schema.prisma'), '--exit-code'],
      h.mainUrl,
      diffCwd,
    )
    assert.equal(diff.code, 0, `migrate diff is not empty:\n${diff.stdout}\n${diff.stderr}`)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}, 240_000)

scenario('logs: no 500 responses, crashed ticks or unhandled rejections in any backend run', async () => {
  const bad = h.allBackendLogs.filter((l) =>
    /-> 5\d\d$|tick crashed|session .* crashed|UnhandledPromiseRejection|INTERNAL_SERVER_ERROR|could not record the failure/.test(l),
  )
  // 503s are expected where the scenario asked for them (ML offline, unmigrated DB).
  const unexpected = bad.filter((l) => !/-> 503$/.test(l))
  assert.deepEqual(unexpected, [])
  assert.ok(!h.allBackendLogs.some((l) => l.includes('quay-thu') || l.includes('ghi-hinh') || l.includes('(E2E)')), 'logs must not contain file or child names')
})

function minimalEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const key of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'TEMP', 'TMP', 'USERPROFILE', 'windir', 'ComSpec']) {
    if (process.env[key] !== undefined) env[key] = process.env[key]
  }
  return env
}
