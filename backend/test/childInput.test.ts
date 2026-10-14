import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Gender } from '@prisma/client'
import { createChildSchema, normalizeNote, parseBirthDate, parseGender, updateChildSchema } from '../src/lib/childInput'

const NOW = new Date('2026-10-06T08:00:00.000Z')

describe('parseBirthDate', () => {
  it('stores the calendar date at UTC midnight', () => {
    assert.equal(parseBirthDate('2022-03-15', NOW)?.toISOString(), '2022-03-15T00:00:00.000Z')
  })

  it('ignores a time part (older clients sent ISO timestamps)', () => {
    assert.equal(parseBirthDate('2022-03-15T00:00:00.000Z', NOW)?.toISOString(), '2022-03-15T00:00:00.000Z')
    assert.equal(parseBirthDate(' 2022-03-15 ', NOW)?.toISOString(), '2022-03-15T00:00:00.000Z')
  })

  it('rejects impossible or malformed dates', () => {
    assert.equal(parseBirthDate('2023-02-30', NOW), null)
    assert.equal(parseBirthDate('2023-13-01', NOW), null)
    assert.equal(parseBirthDate('15/03/2022', NOW), null)
    assert.equal(parseBirthDate('not a date', NOW), null)
    assert.equal(parseBirthDate('', NOW), null)
  })

  it('accepts a leap day only in leap years', () => {
    assert.ok(parseBirthDate('2024-02-29', NOW))
    assert.equal(parseBirthDate('2023-02-29', NOW), null)
  })

  it('rejects dates in the future and before 1900', () => {
    assert.equal(parseBirthDate('2027-01-01', NOW), null)
    assert.equal(parseBirthDate('1899-12-31', NOW), null)
  })

  it('allows "today" in time zones ahead of UTC', () => {
    // 2026-10-06 08:00 UTC is already 2026-10-07 in UTC+14.
    assert.ok(parseBirthDate('2026-10-07', NOW))
    assert.equal(parseBirthDate('2026-10-08', NOW), null)
  })
})

describe('parseGender', () => {
  it('maps known values case-insensitively and defaults to UNSPECIFIED', () => {
    assert.equal(parseGender('male'), Gender.MALE)
    assert.equal(parseGender(' FEMALE '), Gender.FEMALE)
    assert.equal(parseGender('Other'), Gender.OTHER)
    assert.equal(parseGender('x'), Gender.UNSPECIFIED)
    assert.equal(parseGender(undefined), Gender.UNSPECIFIED)
  })
})

describe('child schemas', () => {
  it('trims names and rejects blank ones', () => {
    assert.equal(createChildSchema.parse({ fullName: '  Bé An ', dateOfBirth: '2022-01-01' }).fullName, 'Bé An')
    assert.throws(() => createChildSchema.parse({ fullName: '   ', dateOfBirth: '2022-01-01' }))
    assert.throws(() => updateChildSchema.parse({ fullName: '' }))
  })

  it('keeps the snake_case aliases of the create payload', () => {
    const input = createChildSchema.parse({ full_name: 'Bé An', date_of_birth: '2022-01-01' })
    assert.equal(input.full_name, 'Bé An')
    assert.throws(() => createChildSchema.parse({ fullName: 'Bé An' }))
  })

  it('limits name and note length', () => {
    assert.throws(() => updateChildSchema.parse({ fullName: 'a'.repeat(101) }))
    assert.throws(() => updateChildSchema.parse({ note: 'a'.repeat(1001) }))
  })

  it('treats an empty or null note as clearing it, and a missing note as unchanged', () => {
    assert.equal(normalizeNote(updateChildSchema.parse({ note: '   ' }).note), null)
    assert.equal(normalizeNote(updateChildSchema.parse({ note: null }).note), null)
    assert.equal(normalizeNote(updateChildSchema.parse({}).note), undefined)
    assert.equal(normalizeNote(updateChildSchema.parse({ note: ' thích xe ' }).note), 'thích xe')
  })
})
