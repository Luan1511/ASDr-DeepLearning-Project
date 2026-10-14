import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  CONSENT_VERSION,
  EXERCISE_CONSENT_PREFIX,
  EXERCISE_CONSENT_VERSION,
  QUESTIONNAIRE_CONSENT_VERSION,
  buildExerciseConsentStatement,
  buildQuestionnaireConsentStatement,
  isExerciseConsentVersion,
  type MlVideoRetention,
} from '../src/lib/consent'
import { isActiveExerciseConsent } from '../src/lib/exerciseData'

const RAW_COPY_LINE = 'Trong lúc xử lý (thường vài phút), máy chủ phân tích có thể tạm lưu bản sao video gốc chưa làm mờ khuôn mặt.'

describe('exercise consent statement', () => {
  const cases: Array<[MlVideoRetention, boolean]> = [
    ['raw', true],
    ['unknown', true],
    ['blurred', false],
    ['none', false],
  ]

  for (const [retention, mentionsRawCopy] of cases) {
    it(`retention "${retention}" ${mentionsRawCopy ? 'adds' : 'omits'} the raw-copy line`, () => {
      const statement = buildExerciseConsentStatement({ backendKeepsVideo: false, mlVideoRetention: retention })
      assert.equal(statement.version, EXERCISE_CONSENT_VERSION)
      assert.equal(statement.title, 'Đồng ý ghi hình khi trẻ tập vận động')
      assert.deepEqual(statement.optionalScopes, [])
      assert.equal(statement.items.length, mentionsRawCopy ? 7 : 6)
      assert.equal(statement.items.includes(RAW_COPY_LINE), mentionsRawCopy)
      assert.ok(statement.items.some((item) => item.includes('không ghi âm')))
      assert.ok(statement.items.some((item) => item.includes('không giữ khung xương của trẻ')))
    })
  }
})

describe('consent version namespaces', () => {
  it('keeps the screening consent version unchanged', () => {
    assert.equal(CONSENT_VERSION, '2026-10-05')
    assert.equal(isExerciseConsentVersion(CONSENT_VERSION), false)
  })

  it('recognises exercise versions by prefix', () => {
    assert.equal(EXERCISE_CONSENT_VERSION.startsWith(EXERCISE_CONSENT_PREFIX), true)
    assert.equal(isExerciseConsentVersion(EXERCISE_CONSENT_VERSION), true)
    assert.equal(isExerciseConsentVersion('exercise-2027-01-01'), true)
    assert.equal(isExerciseConsentVersion(QUESTIONNAIRE_CONSENT_VERSION), false)
  })

  it('treats only the current, unrevoked EXERCISE_VIDEO record as active', () => {
    const active = { version: EXERCISE_CONSENT_VERSION, revokedAt: null, scopes: ['EXERCISE_VIDEO'] }
    assert.equal(isActiveExerciseConsent(active), true)
    assert.equal(isActiveExerciseConsent({ ...active, revokedAt: new Date() }), false)
    assert.equal(isActiveExerciseConsent({ ...active, scopes: [] }), false)
    assert.equal(isActiveExerciseConsent({ ...active, version: CONSENT_VERSION, scopes: ['VIDEO_PROCESSING'] }), false)
    assert.equal(isActiveExerciseConsent({ ...active, version: 'exercise-2000-01-01' }), false)
  })
})

describe('questionnaire consent statement', () => {
  it('has a version and seven items', () => {
    const statement = buildQuestionnaireConsentStatement()
    assert.equal(statement.version, QUESTIONNAIRE_CONSENT_VERSION)
    assert.equal(statement.version, 'questionnaire-2026-10-08')
    assert.equal(statement.items.length, 7)
    assert.deepEqual(statement.optionalScopes, [])
  })

  it('names what the in-app Follow-Up stores (choices + optional description) and warns against personal details', () => {
    const item = buildQuestionnaireConsentStatement().items.find((i) => i.includes('phần hỏi thêm trong ứng dụng'))
    assert.ok(item, 'an item about the in-app Follow-Up')
    assert.ok(item.includes('các lựa chọn của bạn') && item.includes('phần mô tả thêm'))
    assert.ok(item.includes('nhân viên y tế xem lại'))
    assert.ok(item.includes('không ghi tên, địa chỉ hay số điện thoại'))
    assert.ok(!item.includes('chẩn đoán'))
  })
})
