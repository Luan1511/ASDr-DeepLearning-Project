import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  serializeAdminExercise,
  serializeBuildTemplateResult,
  serializeExercise,
  serializeExerciseSession,
  serializeGuideTemplate,
  serializeSessionScore,
} from '../src/lib/exerciseSerializers'

const FORBIDDEN = ['filePath', 'storedFilename', 'mlSubjectId', 'lastError', 'lockedBy', 'userId', 'features']

/** Every key anywhere in the JSON output. */
function allKeys(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => allKeys(v, out))
  else if (value && typeof value === 'object' && !(value instanceof Date)) {
    for (const [k, v] of Object.entries(value)) {
      out.add(k)
      allKeys(v, out)
    }
  }
  return out
}

function assertNoForbiddenKeys(value: unknown) {
  const keys = allKeys(JSON.parse(JSON.stringify(value)))
  for (const key of FORBIDDEN) assert.equal(keys.has(key), false, `output must not contain "${key}"`)
}

const at = new Date('2026-10-07T03:00:00.000Z')

const detail = {
  algorithmVersion: 'imitation-v1',
  templateId: 'tpl-1',
  templateHash: 'hash',
  status: 'SCORED',
  reasonCodes: [],
  overall: 84,
  stars: 3,
  band: 'VERY_CLOSE',
  mode: null,
  lowMotion: false,
  tempo: { ratio: 1.1, lagSec: 0.4, score: 1, aheadShare: 0.2, behindShare: 0.1, inPhaseShare: 0.7 },
  parts: {
    leftArm: { status: 'ok', active: true, score: 88, spatialErrorDeg: 9, amplitudeRatio: 0.95, visibility: 1, worstWindowSec: [1, 2.5] },
    rightArm: { status: 'ok', active: true, score: 80, spatialErrorDeg: 12, amplitudeRatio: 0.9, visibility: 1, worstWindowSec: null },
    leftLeg: { status: 'ok', active: false, score: 95, spatialErrorDeg: 3, amplitudeRatio: null, visibility: 0.9, worstWindowSec: null },
    rightLeg: { status: 'not_visible', active: false, score: null, spatialErrorDeg: null, amplitudeRatio: null, visibility: 0.2, worstWindowSec: null },
    trunk: { status: 'ok', active: false, score: 97, spatialErrorDeg: 2, amplitudeRatio: null, visibility: 1, worstWindowSec: null },
  },
  quality: { trackCoverage: 0.98, fpsEff: 15, fpsSource: 'duration', warnings: ['MULTI_PERSON'], scoringMs: 42 },
  feedback: { child: ['a', 'b', 'c', 'd'], parent: ['p'] },
}

const scoreRow = {
  algorithmVersion: 'imitation-v1',
  status: 'SCORED',
  overall: 84,
  stars: 3,
  band: 'VERY_CLOSE',
  mode: null,
  reasonCodes: [] as string[],
  detail,
  createdAt: at,
}

const sessionRow = {
  id: 'session-1',
  userId: 'user-1',
  childId: 'child-1',
  exerciseId: 'ex-1',
  templateId: 'tpl-1',
  consentId: 'consent-1',
  status: 'SCORED' as const,
  recordedVia: 'WEBCAM',
  practiceMode: 'FOLLOW_ALONG',
  playbackRate: 1,
  guideOffsetMs: 1500,
  storedFilename: 'session-1.mp4',
  filePath: 'uploads/exercises/session-1.mp4',
  mimeType: 'video/mp4',
  fileSize: 1234,
  durationMs: 9000,
  videoWidth: 960,
  videoHeight: 540,
  videoDeletedAt: at,
  mlSubjectId: 'ex_session-1',
  mlSubjectDeletedAt: at,
  attempts: 1,
  maxAttempts: 2,
  runAfter: at,
  lockedBy: 'host:1',
  lockedAt: at,
  lastError: 'OpenPose API failed: 500 at http://ml.internal',
  errorMessage: null,
  completedAt: at,
  createdAt: at,
  updatedAt: at,
  exercise: { id: 'ex-1', slug: 'dang-tay', title: 'Dang tay' },
  template: { version: 2, features: { secret: true } },
  scores: [scoreRow],
}

const templateRow = {
  id: 'tpl-1',
  exerciseId: 'ex-1',
  version: 2,
  source: 'ML_SUBJECT',
  sourceSubjectId: 'tpl_123e4567-e89b-12d3-a456-426614174000',
  sourceAttestation: { text: 'x', adminId: 'admin', at: at.toISOString() },
  sourceMlSubjectDeletedAt: null,
  sourceFps: 30,
  fpsSource: 'ml',
  mirrorPolicy: 'EITHER' as const,
  algorithmVersion: 'imitation-v1',
  templateHash: 'hash',
  activeStartSec: 0.5,
  activeEndSec: 6.5,
  durationSec: 6,
  lateralized: false,
  activeParts: ['leftArm', 'rightArm', 'nonsense'],
  guideTrack: { hz: 15, joints: [0, 1, 2], frames: [[0, 1, null, 2], null], neutral: [0, 0, null] },
  features: { anatomical: 'scoring internals' },
  quality: [{ code: 'TEMPLATE_ACTIVE_DURATION', ok: true, value: 6, threshold: '2–30 s' }],
  selfTest: { identical: 99, mirrored: 97, still: 5 },
  createdById: 'admin',
  createdAt: at,
}

const exerciseRow = {
  id: 'ex-1',
  slug: 'dang-tay',
  title: 'Dang tay như cánh chim',
  description: 'Mô tả',
  childPrompt: 'Mình cùng dang tay nhé!',
  difficulty: 1,
  bodyFocus: ['ARMS', 'HEAD'],
  source: 'BUILTIN_SYNTHETIC',
  status: 'PUBLISHED' as const,
  sortOrder: 0,
  currentTemplateId: 'tpl-1',
  createdById: 'admin',
  createdAt: at,
  updatedAt: at,
}

describe('serializeExerciseSession', () => {
  it('never exposes storage, queue or ML internals', () => {
    const dto = serializeExerciseSession(sessionRow, { queuePosition: null, mlBusy: false })
    assertNoForbiddenKeys(dto)
    assert.equal(dto.rawVideoDeleted, true)
    assert.equal(dto.templateVersion, 2)
    assert.equal(dto.retryable, false)
    assert.equal(dto.score?.overall, 84)
    assert.deepEqual(dto.score?.warnings, ['MULTI_PERSON'])
    assert.deepEqual(dto.score?.tempo, { ratio: 1.1, lagSec: 0.4 })
    assert.equal(dto.score?.feedback.child.length, 3)
  })

  it('drops per-part internals and fills missing parts', () => {
    const dto = serializeSessionScore({ ...scoreRow, detail: { ...detail, parts: { leftArm: detail.parts.leftArm } } })
    assert.deepEqual(dto.parts.leftArm, { status: 'ok', active: true, score: 88, amplitudeRatio: 0.95, worstWindowSec: [1, 2.5] })
    assert.equal(dto.parts.trunk.status, 'not_visible')
    assert.equal('spatialErrorDeg' in dto.parts.leftArm, false)
    assert.equal('visibility' in dto.parts.leftArm, false)
  })

  it('is retryable only for FAILED sessions whose video is still kept', () => {
    const failed = { ...sessionRow, status: 'FAILED' as const, videoDeletedAt: null, scores: [] }
    assert.equal(serializeExerciseSession(failed).retryable, true)
    assert.equal(serializeExerciseSession({ ...failed, videoDeletedAt: at }).retryable, false)
    assert.equal(serializeExerciseSession(failed).score, null)
  })

  it('uses the latest score', () => {
    const older = { ...scoreRow, overall: 10, stars: 1, createdAt: new Date('2026-01-01T00:00:00Z') }
    const dto = serializeExerciseSession({ ...sessionRow, scores: [older, scoreRow] })
    assert.equal(dto.score?.overall, 84)
  })
})

describe('serializeSessionScore INSUFFICIENT', () => {
  it('has no number, stars or band even if the row has them', () => {
    const dto = serializeSessionScore({
      ...scoreRow,
      status: 'INSUFFICIENT',
      overall: 40,
      stars: 1,
      band: 'PROGRESSING',
      reasonCodes: ['ACTIVE_PART_NOT_VISIBLE'],
    })
    assert.equal(dto.status, 'INSUFFICIENT')
    assert.equal(dto.overall, null)
    assert.equal(dto.stars, null)
    assert.equal(dto.band, null)
    assert.deepEqual(dto.reasonCodes, ['ACTIVE_PART_NOT_VISIBLE'])
  })

  it('survives a malformed detail', () => {
    const dto = serializeSessionScore({ ...scoreRow, detail: null })
    assert.deepEqual(dto.warnings, [])
    assert.deepEqual(dto.feedback, { child: [], parent: [] })
    assert.equal(dto.parts.leftLeg.status, 'not_visible')
  })
})

describe('exercise and template DTOs', () => {
  it('serializes a parent card without template internals', () => {
    const dto = serializeExercise(exerciseRow, templateRow, {
      attempts: 2,
      scoredAttempts: 1,
      bestStars: 3,
      lastStars: null,
      lastAt: at,
    })
    assertNoForbiddenKeys(dto)
    assert.deepEqual(dto.bodyFocus, ['ARMS'])
    assert.deepEqual(dto.template.activeParts, ['leftArm', 'rightArm'])
    assert.equal(dto.title, 'Dang tay như cánh chim')
    assert.equal(allKeys(dto).has('templateHash'), false)
    assert.equal(allKeys(dto).has('sourceSubjectId'), false)
  })

  it('serializes the guide skeleton only', () => {
    const dto = serializeGuideTemplate(templateRow)
    assertNoForbiddenKeys(dto)
    assert.equal(dto.hz, 15)
    assert.deepEqual(dto.frames, [[0, 1, null, 2], null])
    assert.deepEqual(dto.neutral, [0, 0, null])
    assert.equal(allKeys(dto).has('sourceSubjectId'), false)
  })

  it('serializes the admin view with gates but without features', () => {
    const dto = serializeAdminExercise({ ...exerciseRow, templates: [templateRow] }, { attempts: 3, insufficientRate: 0.5 })
    assertNoForbiddenKeys(dto)
    assert.equal(dto.title, '[Mẫu tổng hợp] Dang tay như cánh chim')
    assert.equal(dto.template?.id, 'tpl-1')
    assert.equal(dto.templates[0].isCurrent, true)
    assert.equal(dto.templates[0].sourceMlSubjectDeleted, false)
    assert.deepEqual(dto.templates[0].quality, [
      { code: 'TEMPLATE_ACTIVE_DURATION', ok: true, value: 6, threshold: '2–30 s' },
    ])
    assert.deepEqual(dto.stats, { attempts: 3, insufficientRate: 0.5 })
  })

  it('gives a draft without a published template a null template', () => {
    const dto = serializeAdminExercise({ ...exerciseRow, status: 'DRAFT', currentTemplateId: null, templates: [templateRow] })
    assert.equal(dto.template, null)
    assert.equal(dto.templates[0].isCurrent, false)
  })

  it('omits features from compile results', () => {
    const dto = serializeBuildTemplateResult({
      ok: true,
      gates: [{ code: 'TEMPLATE_NO_ACTIVE_PART', ok: true, value: 2, threshold: '≥ 1' }],
      suggestedTrim: { startSec: 0.4, endSec: 6.6 },
      template: {
        features: { secret: true } as never,
        guideTrack: { hz: 15, joints: [0], frames: [], neutral: [] },
        templateHash: 'hash',
        activeParts: ['leftArm'],
        durationSec: 6,
        activeStartSec: 0.4,
        activeEndSec: 6.6,
        lateralized: false,
      },
      selfTest: { identical: 99, mirrored: 98, still: 3 },
    })
    assertNoForbiddenKeys(dto)
    assert.equal(dto.template?.templateHash, 'hash')
  })
})
