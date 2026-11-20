import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  DOCTOR_SHARE_SCOPES,
  DOCTOR_SHARE_VERSION,
  ageInMonths,
  buildDoctorShareStatement,
  createDoctorLinkSchema,
  doctorMatchesQuery,
  foldVietnamese,
  listedDoctorFilter,
  normalizeScopes,
  serializeDoctor,
  serializeDoctorLink,
} from '../src/lib/doctorShare'
import { MOCK_DOCTORS } from '../src/lib/mockDoctors'

const at = new Date('2026-11-17T03:00:00.000Z')

const doctorRow = {
  id: 'doc-1',
  userId: 'user-doctor',
  displayName: 'Trần Minh Anh',
  title: 'BS. CKI',
  specialty: 'Nhi khoa phát triển',
  workplace: 'Phòng khám mẫu Hoa Nắng',
  city: 'Đà Nẵng',
  bio: 'Mô tả',
  languages: ['Tiếng Việt'],
  isMock: true,
  acceptingNew: true,
  isActive: true,
  verificationStatus: 'VERIFIED' as const,
  verifiedAt: at,
  verifiedById: 'admin-1',
  createdAt: at,
  updatedAt: at,
}

const linkRow = {
  id: 'link-1',
  doctorId: 'doc-1',
  childId: 'child-1',
  grantedById: 'user-parent',
  scopes: ['EXERCISE', 'PROFILE', 'VIDEO'],
  version: DOCTOR_SHARE_VERSION,
  statement: { secret: 'the full agreed text' },
  message: 'Nhờ bác sĩ xem giúp',
  grantedAt: at,
  expiresAt: new Date('2027-02-15T03:00:00.000Z'),
  revokedAt: null,
  lastViewedAt: null,
  viewCount: 0,
  doctor: doctorRow,
}

describe('doctor share statement', () => {
  it('lists every scope once, with the basic profile as the only mandatory one', () => {
    const statement = buildDoctorShareStatement('on')
    assert.equal(statement.version, DOCTOR_SHARE_VERSION)
    assert.deepEqual(
      statement.scopes.map((s) => s.scope),
      [...DOCTOR_SHARE_SCOPES],
    )
    assert.deepEqual(
      statement.scopes.filter((s) => s.required).map((s) => s.scope),
      ['PROFILE'],
    )
    assert.ok(statement.scopes.every((s) => s.label && s.detail))
  })

  it('promises that videos are never shared and that sharing can be ended', () => {
    const text = buildDoctorShareStatement('on').notes.join(' ')
    assert.match(text, /Video của trẻ không bao giờ được chia sẻ/)
    assert.match(text, /ngừng chia sẻ bất cứ lúc nào/)
    assert.match(text, /không phải chẩn đoán/)
  })

  it('says the doctors are samples in demo mode only', () => {
    assert.match(buildDoctorShareStatement('demo').notes.join(' '), /bác sĩ mẫu/)
    assert.doesNotMatch(buildDoctorShareStatement('on').notes.join(' '), /bác sĩ mẫu/)
  })

  it('never uses diagnostic wording', () => {
    const text = JSON.stringify(buildDoctorShareStatement('demo'))
    for (const banned of ['bị tự kỷ', 'mắc ASD', 'dương tính']) assert.equal(text.includes(banned), false, banned)
  })
})

describe('doctor link input and serializers', () => {
  it('validates a grant request', () => {
    const base = { doctorId: '123e4567-e89b-12d3-a456-426614174000', scopes: ['PROFILE'], accepted: true, version: 'v' }
    assert.equal(createDoctorLinkSchema.safeParse(base).success, true)
    assert.equal(createDoctorLinkSchema.parse({ ...base, message: '   ' }).message, null)
    assert.equal(createDoctorLinkSchema.safeParse({ ...base, accepted: false }).success, false)
    assert.equal(createDoctorLinkSchema.safeParse({ ...base, scopes: [] }).success, false)
    assert.equal(createDoctorLinkSchema.safeParse({ ...base, scopes: ['VIDEO'] }).success, false)
    assert.equal(createDoctorLinkSchema.safeParse({ ...base, doctorId: 'x' }).success, false)
    assert.equal(createDoctorLinkSchema.safeParse({ ...base, message: 'x'.repeat(301) }).success, false)
    assert.equal(createDoctorLinkSchema.parse(base).durationDays, 90)
    for (const durationDays of [30, 90, 180, 0] as const) assert.equal(createDoctorLinkSchema.parse({ ...base, durationDays }).durationDays, durationDays)
    assert.equal(createDoctorLinkSchema.safeParse({ ...base, durationDays: 60 }).success, false)
  })

  it('keeps known scopes in the canonical order', () => {
    assert.deepEqual(normalizeScopes(['EXERCISE', 'VIDEO', 'PROFILE', 'PROFILE']), ['PROFILE', 'EXERCISE'])
  })

  it('lists sample doctors in demo mode only', () => {
    assert.deepEqual(listedDoctorFilter('demo'), { isActive: true, OR: [{ isMock: true }, { isMock: false, verificationStatus: 'VERIFIED' }] })
    assert.deepEqual(listedDoctorFilter('on'), { isMock: false, isActive: true, verificationStatus: 'VERIFIED' })
  })

  it('searches the directory without caring about Vietnamese marks or letter case', () => {
    assert.equal(foldVietnamese('Âm ngữ trị liệu – Đà Nẵng'), 'am ngu tri lieu – da nang')
    assert.equal(doctorMatchesQuery(doctorRow, 'nhi khoa'), true)
    assert.equal(doctorMatchesQuery(doctorRow, 'NHI  da nang'), true)
    assert.equal(doctorMatchesQuery(doctorRow, 'minh anh hoa nắng'), true)
    assert.equal(doctorMatchesQuery(doctorRow, 'bs cki'), true)
    assert.equal(doctorMatchesQuery(doctorRow, 'âm ngữ'), false)
    // Whole-word beginnings only: "anh" is a word of the name, "inh" is not.
    assert.equal(doctorMatchesQuery(doctorRow, 'anh'), true)
    assert.equal(doctorMatchesQuery(doctorRow, 'inh'), false)
    assert.equal(
      doctorMatchesQuery({ ...doctorRow, displayName: 'Nguyễn Thu Hà', specialty: 'Tâm lý lâm sàng trẻ em' }, 'am ngu'),
      false,
    )
    assert.equal(doctorMatchesQuery(doctorRow, '   '), true)
  })

  it('never exposes the account behind a doctor', () => {
    const dto = serializeDoctor(doctorRow)
    assert.equal('userId' in dto, false)
    assert.equal(dto.isMock, true)
  })

  it('shows a grant to its parent without the stored statement or the granting account', () => {
    const dto = serializeDoctorLink(linkRow)
    assert.deepEqual(dto.scopes, ['PROFILE', 'EXERCISE'])
    assert.equal(dto.active, true)
    assert.equal('statement' in dto, false)
    assert.equal('grantedById' in dto, false)
    assert.equal(serializeDoctorLink({ ...linkRow, revokedAt: at }).active, false)
    assert.equal(serializeDoctorLink({ ...linkRow, expiresAt: new Date('2026-11-16T00:00:00.000Z') }).active, false)
  })
})

describe('ageInMonths', () => {
  it('counts whole months', () => {
    const dob = new Date('2023-05-20T00:00:00.000Z')
    assert.equal(ageInMonths(dob, new Date('2026-11-19T00:00:00.000Z')), 41)
    assert.equal(ageInMonths(dob, new Date('2026-11-20T00:00:00.000Z')), 42)
    assert.equal(ageInMonths(dob, new Date('2023-05-01T00:00:00.000Z')), 0)
  })
})

describe('sample doctors', () => {
  it('are clearly sample data: reserved e-mail domain, invented workplaces, unique e-mails', () => {
    assert.ok(MOCK_DOCTORS.length >= 6)
    assert.equal(new Set(MOCK_DOCTORS.map((d) => d.email)).size, MOCK_DOCTORS.length)
    for (const doctor of MOCK_DOCTORS) {
      assert.match(doctor.email, /@asdr\.local$/)
      assert.match(doctor.workplace, /mẫu/)
      assert.ok(doctor.displayName && doctor.specialty && doctor.city && doctor.bio)
    }
  })
})
