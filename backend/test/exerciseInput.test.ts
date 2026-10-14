import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  EXERCISE_EXTENSIONS,
  TEMPLATE_SOURCE_PATTERN,
  acceptedExtensions,
  chooseMlUpload,
  compileTemplateSchema,
  createExerciseSchema,
  exerciseAccess,
  makeExerciseUploadBodySchema,
  maxRecordingMs,
  minRecordingMs,
  sessionListQuerySchema,
  stripBuiltinTitlePrefix,
  updateExerciseSchema,
} from '../src/lib/exerciseInput'

const ML_STATES = {
  v2: { legacy: false },
  legacy: { legacy: true },
  // getMlCapabilities() reports an unreachable server as legacy.
  unreachable: { legacy: true },
} as const

describe('chooseMlUpload', () => {
  it('maps every extension × ML version × webmAsMkv flag', () => {
    for (const ext of EXERCISE_EXTENSIONS) {
      for (const [state, { legacy }] of Object.entries(ML_STATES)) {
        for (const webmAsMkv of [false, true]) {
          const choice = chooseMlUpload({ ext, legacy, webmAsMkv })
          const label = `${ext} ${state} webmAsMkv=${webmAsMkv}`
          if (ext === '.webm' && legacy) {
            if (webmAsMkv) assert.deepEqual(choice, { filename: 'session.mkv', mimeType: 'video/x-matroska' }, label)
            else assert.equal(choice, 'UNSUPPORTED', label)
          } else {
            assert.notEqual(choice, 'UNSUPPORTED', label)
            if (choice !== 'UNSUPPORTED') assert.equal(choice.filename, `session${ext}`, label)
          }
        }
      }
    }
  })

  it('sends WebM as WebM to ML 2.0', () => {
    assert.deepEqual(chooseMlUpload({ ext: '.webm', legacy: false, webmAsMkv: false }), {
      filename: 'session.webm',
      mimeType: 'video/webm',
    })
  })

  it('never puts user input in the file name', () => {
    for (const ext of ['.MP4', '.Mov', '.mp4']) {
      const choice = chooseMlUpload({ ext, legacy: false, webmAsMkv: false })
      assert.notEqual(choice, 'UNSUPPORTED')
      if (choice !== 'UNSUPPORTED') assert.match(choice.filename, /^session\.(mp4|mov|mkv|webm)$/)
    }
    for (const ext of ['.avi', '', '.mp4/../../x', '../evil.mp4', '.exe']) {
      assert.equal(chooseMlUpload({ ext, legacy: false, webmAsMkv: true }), 'UNSUPPORTED', ext)
    }
  })

  it('offers .webm to browsers only when the ML server accepts it', () => {
    assert.deepEqual(acceptedExtensions(true), ['.mp4', '.mov', '.mkv', '.webm'])
    assert.deepEqual(acceptedExtensions(false), ['.mp4', '.mov', '.mkv'])
  })
})

describe('exerciseAccess', () => {
  it('follows EXERCISE_MODE', () => {
    assert.equal(exerciseAccess('off', 'ADMIN'), false)
    assert.equal(exerciseAccess('off', 'USER'), false)
    assert.equal(exerciseAccess('admin_only', 'ADMIN'), true)
    assert.equal(exerciseAccess('admin_only', 'USER'), false)
    assert.equal(exerciseAccess('admin_only', undefined), false)
    assert.equal(exerciseAccess('on', 'USER'), true)
  })
})

describe('recording length', () => {
  const CAP = 60_000

  it('allows twice the auto-stop length, at least +10 s, never above the cap', () => {
    // FOLLOW_ALONG, 6 s template at 0.75x: 1.5 + 8 + 1.5 = 11 s expected → 22 s.
    assert.equal(maxRecordingMs(6, 'FOLLOW_ALONG', CAP), 22_000)
    // AFTER_DEMO, 6 s: 1.5 * 6 + 2 = 11 s → 22 s.
    assert.equal(maxRecordingMs(6, 'AFTER_DEMO', CAP), 22_000)
    // Very short template: expected + 10 s wins.
    assert.equal(maxRecordingMs(1, 'AFTER_DEMO', CAP), 13_500)
    // Long template: capped.
    assert.equal(maxRecordingMs(30, 'FOLLOW_ALONG', CAP), CAP)
    assert.equal(maxRecordingMs(30, 'AFTER_DEMO', 45_000), 45_000)
  })

  it('requires at least 60 % of the template and 1 s', () => {
    assert.equal(minRecordingMs(10), 6000)
    assert.equal(minRecordingMs(1), 1000)
    assert.equal(minRecordingMs(0), 1000)
  })
})

describe('upload body schema', () => {
  const schema = makeExerciseUploadBodySchema(60_000)
  const base = { durationMs: '8000', recordedVia: 'WEBCAM', practiceMode: 'FOLLOW_ALONG', playbackRate: '1' }

  it('accepts multipart strings and coerces them', () => {
    const parsed = schema.parse({ ...base, videoWidth: '960', videoHeight: '540', guideOffsetMs: '1500' })
    assert.equal(parsed.durationMs, 8000)
    assert.equal(parsed.videoWidth, 960)
    assert.equal(parsed.guideOffsetMs, 1500)
    assert.equal(parsed.playbackRate, 1)
  })

  it('treats empty optional fields as missing and defaults playbackRate to 1', () => {
    const parsed = schema.parse({ ...base, videoWidth: '', guideOffsetMs: '', playbackRate: '' })
    assert.equal(parsed.videoWidth, undefined)
    assert.equal(parsed.guideOffsetMs, undefined)
    assert.equal(parsed.playbackRate, 1)
  })

  it('enforces the duration bounds', () => {
    assert.equal(schema.safeParse({ ...base, durationMs: '999' }).success, false)
    assert.equal(schema.safeParse({ ...base, durationMs: '1000' }).success, true)
    assert.equal(schema.safeParse({ ...base, durationMs: '60000' }).success, true)
    assert.equal(schema.safeParse({ ...base, durationMs: '60001' }).success, false)
    assert.equal(schema.safeParse({ ...base, durationMs: undefined }).success, false)
    assert.equal(schema.safeParse({ ...base, durationMs: 'abc' }).success, false)
  })

  it('accepts only playback rates 0.75 and 1', () => {
    assert.equal(schema.safeParse({ ...base, playbackRate: '0.75' }).success, true)
    assert.equal(schema.safeParse({ ...base, playbackRate: '0.5' }).success, false)
    assert.equal(schema.safeParse({ ...base, playbackRate: '1.5' }).success, false)
  })

  it('rejects unknown modes and sources', () => {
    assert.equal(schema.safeParse({ ...base, recordedVia: 'SCREEN' }).success, false)
    assert.equal(schema.safeParse({ ...base, practiceMode: 'FREESTYLE' }).success, false)
  })
})

describe('admin schemas', () => {
  const exercise = {
    slug: 'dang-tay',
    title: 'Dang tay như cánh chim',
    description: 'Mô tả',
    childPrompt: 'Mình cùng dang tay nhé!',
    difficulty: 1,
    bodyFocus: ['ARMS', 'ARMS'],
  }

  it('validates exercise metadata', () => {
    const parsed = createExerciseSchema.parse(exercise)
    assert.deepEqual(parsed.bodyFocus, ['ARMS'])
    assert.equal(createExerciseSchema.safeParse({ ...exercise, slug: 'Dang Tay' }).success, false)
    assert.equal(createExerciseSchema.safeParse({ ...exercise, slug: 'ab' }).success, false)
    assert.equal(createExerciseSchema.safeParse({ ...exercise, difficulty: 4 }).success, false)
    assert.equal(createExerciseSchema.safeParse({ ...exercise, bodyFocus: [] }).success, false)
    assert.equal(createExerciseSchema.safeParse({ ...exercise, title: 'x'.repeat(81) }).success, false)
  })

  it('keeps the admin-only built-in prefix out of stored titles', () => {
    assert.equal(stripBuiltinTitlePrefix('[Mẫu tổng hợp] Vươn tay lên cao'), 'Vươn tay lên cao')
    assert.equal(updateExerciseSchema.parse({ title: '[Mẫu tổng hợp] Vươn tay lên cao' }).title, 'Vươn tay lên cao')
  })

  it('never lets PATCH publish', () => {
    assert.equal(updateExerciseSchema.safeParse({ status: 'PUBLISHED' }).success, false)
    assert.equal(updateExerciseSchema.safeParse({ status: 'ARCHIVED' }).success, true)
  })

  it('accepts only tpl_<uuid> template sources', () => {
    assert.match('tpl_123e4567-e89b-12d3-a456-426614174000', TEMPLATE_SOURCE_PATTERN)
    assert.doesNotMatch('ex_123e4567-e89b-12d3-a456-426614174000', TEMPLATE_SOURCE_PATTERN)
    assert.doesNotMatch('123e4567-e89b-12d3-a456-426614174000', TEMPLATE_SOURCE_PATTERN)
    assert.doesNotMatch('tpl_../../etc', TEMPLATE_SOURCE_PATTERN)
  })

  it('requires the attestation and a sane trim on template compile', () => {
    const body = {
      sourceSubjectId: 'tpl_123e4567-e89b-12d3-a456-426614174000',
      mirrorPolicy: 'EITHER',
      attestation: true,
    }
    assert.equal(compileTemplateSchema.safeParse(body).success, true)
    assert.equal(compileTemplateSchema.safeParse({ ...body, attestation: false }).success, false)
    assert.equal(compileTemplateSchema.safeParse({ ...body, trim: { startSec: 3, endSec: 2 } }).success, false)
    assert.equal(compileTemplateSchema.safeParse({ ...body, mirrorPolicy: 'ANY' }).success, false)
  })

  it('bounds the session list query', () => {
    const childId = '123e4567-e89b-12d3-a456-426614174000'
    assert.equal(sessionListQuerySchema.parse({ childId }).limit, 20)
    assert.equal(sessionListQuerySchema.safeParse({ childId, limit: '101' }).success, false)
    assert.equal(sessionListQuerySchema.safeParse({ childId: 'x' }).success, false)
  })
})
