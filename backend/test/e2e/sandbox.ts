/**
 * Throwaway environment for trying the app by hand, with the same safety as
 * the e2e suites (harness.ts): a temporary PostgreSQL on :55432, the Node fake
 * ML server on :8100 and the backend on :4100 — never the shared database.
 *
 *   npm run sandbox
 *   (other terminal)  cd frontend && npm run dev:sandbox      → http://localhost:5175
 *
 * It fills the temp database with demo data: an admin, a parent with one
 * child (a second parent has another; personalisation, practice attempts, a questionnaire, screening
 * results), the sample doctors, and one record already shared with a doctor.
 * Stop it with Ctrl+C, or by creating the file named in SANDBOX_STOP_FILE;
 * everything it created is then deleted.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import bcrypt from 'bcrypt'
import { EXERCISE_CONSENT_VERSION, QUESTIONNAIRE_CONSENT_VERSION } from '../../src/lib/consent'
import { DOCTOR_SHARE_VERSION } from '../../src/lib/doctorShare'
import { MOCK_DOCTORS, seedMockDoctors } from '../../src/lib/mockDoctors'
import { MOVEMENT_VERSION } from '../../src/services/exerciseMovement/types'
import { buildScenario, type ScenarioName } from '../syntheticImitation'
import { BACKEND_PORT, E2eHarness, api, clipForm, sleep, waitFor, type SeededUser } from './harness'

/** Password of every sandbox account (the database is deleted when the sandbox stops). */
const PASSWORD = process.env.SANDBOX_PASSWORD || 'sandbox123'
const FRONTEND_ORIGINS = 'http://localhost:5175,http://127.0.0.1:5175'
const STOP_FILE = process.env.SANDBOX_STOP_FILE

const h = new E2eHarness('sandbox')

async function ok<T>(promise: Promise<{ status: number; body: T }>, expected: number, what: string): Promise<T> {
  const res = await promise
  assert.equal(res.status, expected, `${what}: ${JSON.stringify(res.body)}`)
  return res.body
}

async function practise(user: SeededUser, childId: string, target: { id: string; templateId: string }, slug: string, scenario: ScenarioName) {
  const clip = buildScenario(slug, scenario, { seed: 3 })
  const qs = new URLSearchParams({ childId, exerciseId: target.id, templateId: target.templateId })
  const created = await ok(
    api('POST', `/exercise-sessions/upload?${qs}`, {
      token: user.token,
      form: clipForm({ slug, scenario, seed: 3 }, { durationMs: clip.durationMs, recordedVia: 'UPLOAD', practiceMode: 'AFTER_DEMO', playbackRate: 1, videoWidth: 960, videoHeight: 540 }),
    }),
    201,
    `upload ${slug}/${scenario}`,
  )
  const sessionId = (created as { session: { id: string } }).session.id
  await waitFor(
    async () => {
      const res = await api('GET', `/exercise-sessions/${sessionId}`, { token: user.token })
      return ['SCORED', 'INSUFFICIENT', 'FAILED'].includes(res.body?.session?.status)
    },
    { timeoutMs: 90_000, intervalMs: 400, what: `session ${slug}/${scenario} to be scored` },
  )
  return sessionId
}

async function main() {
  await h.setup()
  const hash = await bcrypt.hash(PASSWORD, 8)
  await h.prisma.user.updateMany({ data: { passwordHash: hash } })
  await seedMockDoctors(h.prisma, hash)
  const { admin, parentA: parent } = h.users

  await h.startBackend({ env: { CORS_ORIGIN: FRONTEND_ORIGINS, EXERCISE_MODE: 'on', MCHAT_MODE: 'entry', DOCTOR_MODE: 'demo', VIDEO_SCREENING: 'admin_only' } })

  // ---- exercise library: every built-in, published
  await ok(api('POST', '/admin/exercises/builtins/sync', { token: admin.token }), 200, 'sync built-ins')
  const drafts = (await api('GET', '/admin/exercises', { token: admin.token })).body.exercises as Array<{
    id: string
    slug: string
    templates: Array<{ id: string }>
  }>
  for (const e of drafts) {
    await ok(api('POST', `/admin/exercises/${e.id}/publish`, { token: admin.token, json: { templateId: e.templates[0].id } }), 200, `publish ${e.slug}`)
  }
  const target = (slug: string) => {
    const e = drafts.find((d) => d.slug === slug)!
    return { id: e.id, templateId: e.templates[0].id }
  }

  // ---- one child per parent account
  const na = await h.createChild(parent, 'Na', 24)
  const bo = await h.createChild(h.users.parentB, 'Bo', 50)
  await h.prisma.childProfile.update({ where: { id: na.id }, data: { fullName: 'Nguyễn Hà Na', note: 'Dữ liệu thử trong sandbox.' } })
  await h.prisma.childProfile.update({ where: { id: bo.id }, data: { fullName: 'Nguyễn Gia Bo' } })

  await ok(
    api('PUT', `/children/${na.id}/personalization`, {
      token: parent.token,
      json: {
        nickname: 'Na',
        interests: ['Khủng long', 'Xe buýt', 'Âm nhạc'],
        communication: 'SINGLE_WORDS',
        sensory: ['SOUND'],
        calming: 'Ôm gấu bông, nghe bài hát quen',
        goals: 'Con bắt chước được động tác tay và tập đều mỗi tuần',
        focusAreas: ['ARMS'],
        weeklyGoal: 3,
      },
    }),
    200,
    'personalisation',
  )

  // ---- practice attempts (scored through the fake ML and the real worker)
  await ok(
    api('POST', `/children/${na.id}/exercise-consent`, {
      token: parent.token,
      json: { accepted: true, version: EXERCISE_CONSENT_VERSION, scopes: ['EXERCISE_VIDEO'] },
    }),
    201,
    'exercise consent',
  )
  const dangTay: string[] = []
  for (const scenario of ['half_amplitude', 'different', 'half_amplitude', 'identical', 'mirrored'] as ScenarioName[]) {
    dangTay.push(await practise(parent, na.id, target('dang-tay'), 'dang-tay', scenario))
  }
  await practise(parent, na.id, target('vuon-cao'), 'vuon-cao', 'identical')

  // Movement feedback as a compiled movement profile would produce it, so the
  // second progress panel has something to show (the built-ins have no profile).
  const flaggedPerAttempt = [3, 2, 2, 1, 0]
  const evaluatedPerAttempt = [4, 3, 4, 4, 4]
  const codes = ['JACKS_ARM_FOOT_OUT_OF_PHASE', 'JACKS_MISSING_FOOT_OPEN', 'JACKS_MISSING_FOOT_CLOSE', 'JACKS_ONE_ARM_IDLE']
  const labels = ['Nâng tay cùng lúc mở chân', 'Pha mở chân', 'Pha khép chân', 'Nâng và hạ cả hai tay']
  for (const [i, sessionId] of dangTay.entries()) {
    const score = await h.prisma.sessionScore.findFirstOrThrow({ where: { sessionId } })
    const movement = {
      version: MOVEMENT_VERSION,
      profile: 'jumping-jacks',
      checks: codes.map((code, k) => ({ code, label: labels[k], status: k < evaluatedPerAttempt[i] ? 'evaluated' : 'unmeasurable' })),
      events: codes.slice(0, flaggedPerAttempt[i]).map((code, k) => ({
        code,
        label: labels[k],
        feedback: 'Con thử nâng tay cùng lúc mở chân nhé.',
        startSec: 1 + k,
        endSec: 3 + k,
        repetitions: 2,
      })),
    }
    await h.prisma.sessionScore.update({ where: { id: score.id }, data: { detail: { ...(score.detail as object), movement } } })
  }
  // Spread the attempts over the last days so the trend and the weekly goal read naturally.
  const all = await h.prisma.exerciseSession.findMany({ where: { childId: na.id }, orderBy: { createdAt: 'asc' } })
  for (const [i, s] of all.entries()) {
    const at = new Date(Date.now() - (all.length - 1 - i) * 26 * 60 * 60 * 1000)
    await h.prisma.exerciseSession.update({ where: { id: s.id }, data: { createdAt: at, completedAt: at } })
  }

  // ---- screening results and a questionnaire
  for (const [i, level] of (['MEDIUM', 'LOW'] as const).entries()) {
    const video = await h.prisma.videoUpload.create({
      data: {
        userId: parent.id,
        childId: na.id,
        originalFilename: `sandbox-${i}.mp4`,
        storedFilename: `sandbox-${i}.mp4`,
        filePath: `uploads/sandbox-${i}.mp4`,
        mimeType: 'video/mp4',
        fileSize: 1000,
        status: 'COMPLETED',
        videoDeletedAt: new Date(),
        createdAt: new Date(Date.now() - (9 - i * 6) * 24 * 60 * 60 * 1000),
      },
    })
    await h.prisma.screeningResult.create({
      data: {
        videoId: video.id,
        riskLevel: level,
        confidenceScore: level === 'LOW' ? 0.82 : 0.6,
        asdProbability: level === 'LOW' ? 0.18 : 0.4,
        decisionThreshold: 0.223,
        highRiskThreshold: 0.454,
        calibrated: true,
        modelVersion: 'sandbox-fake',
        recommendation: 'Kết quả mô phỏng trong sandbox, chỉ để xem giao diện.',
        rawAiResponse: { provider: 'mock' },
      },
    })
  }
  const answers: Record<string, boolean> = {}
  for (let item = 1; item <= 20; item += 1) answers[String(item)] = ![2, 5, 12].includes(item)
  await ok(
    api('POST', `/children/${na.id}/questionnaires`, {
      token: parent.token,
      json: { instrument: 'MCHAT_RF', respondent: 'MOTHER', answers, consentAccepted: true, consentVersion: QUESTIONNAIRE_CONSENT_VERSION },
    }),
    201,
    'questionnaire',
  )

  // ---- one record already shared with the first sample doctor
  const doctors = (await api('GET', '/doctors', { token: parent.token })).body.doctors as Array<{ id: string; displayName: string }>
  const first = doctors.find((d) => d.displayName === MOCK_DOCTORS[0].displayName)!
  await ok(
    api('POST', `/children/${na.id}/doctor-links`, {
      token: parent.token,
      json: {
        doctorId: first.id,
        scopes: ['PROFILE', 'PERSONALIZATION', 'SCREENING', 'QUESTIONNAIRE', 'EXERCISE'],
        accepted: true,
        version: DOCTOR_SHARE_VERSION,
        message: 'Nhờ bác sĩ xem giúp tiến độ tập của bé Na.',
      },
    }),
    201,
    'share with a doctor',
  )

  /* eslint-disable no-console */
  console.log('\nSANDBOX READY')
  console.log(`  backend   http://127.0.0.1:${BACKEND_PORT}/api   (temporary database, fake ML)`)
  console.log('  frontend  cd frontend && npm run dev:sandbox   → http://localhost:5175')
  console.log(`  accounts  ${admin.email} (admin), ${parent.email} (parent), ${h.users.parentB.email} (second parent), ${MOCK_DOCTORS[0].email} (sample doctor with a shared record)`)
  console.log(`  password  ${process.env.SANDBOX_PASSWORD ? 'the value of SANDBOX_PASSWORD' : 'the default in test/e2e/sandbox.ts'}`)
  console.log(STOP_FILE ? `  stop      create ${STOP_FILE}` : '  stop      Ctrl+C')
  /* eslint-enable no-console */

  let stopping = false
  const stop = async () => {
    if (stopping) return
    stopping = true
    await h.teardown()
    process.exit(0)
  }
  process.on('SIGINT', () => void stop())
  process.on('SIGTERM', () => void stop())
  for (;;) {
    if (STOP_FILE && fs.existsSync(STOP_FILE)) await stop()
    await sleep(1000)
  }
}

main().catch(async (error) => {
  // eslint-disable-next-line no-console
  console.error(error instanceof Error ? error.message : error)
  await h.teardown().catch(() => {})
  process.exit(1)
})
