import { Gender } from '@prisma/client'
import { z } from 'zod'

export const CHILD_NAME_MAX = 100
export const CHILD_NOTE_MAX = 1000

const EARLIEST_BIRTH_DATE = Date.UTC(1900, 0, 1)
// A birth date typed as "today" in UTC+14 is still "tomorrow" in UTC.
const FUTURE_TOLERANCE_MS = 24 * 60 * 60 * 1000

export function parseGender(input?: string | null): Gender {
  const v = (input ?? '').trim().toUpperCase()
  if (v === 'MALE') return Gender.MALE
  if (v === 'FEMALE') return Gender.FEMALE
  if (v === 'OTHER') return Gender.OTHER
  return Gender.UNSPECIFIED
}

/**
 * Calendar date of birth ("YYYY-MM-DD", optionally followed by a time that is
 * ignored) stored as UTC midnight, the format the frontend has always sent.
 * Null for impossible dates (2023-02-30), dates before 1900 or in the future.
 */
export function parseBirthDate(raw: string, now: Date = new Date()): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T ])/.exec(raw.trim())
  if (!match) return null
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  if (date.getTime() < EARLIEST_BIRTH_DATE) return null
  if (date.getTime() > now.getTime() + FUTURE_TOLERANCE_MS) return null
  return date
}

const fullNameSchema = z.string().trim().min(1).max(CHILD_NAME_MAX)
const noteSchema = z.string().trim().max(CHILD_NOTE_MAX)

// Snake-case aliases kept for older clients.
export const createChildSchema = z
  .object({
    fullName: fullNameSchema.optional(),
    full_name: fullNameSchema.optional(),
    dateOfBirth: z.string().min(1).optional(),
    date_of_birth: z.string().min(1).optional(),
    gender: z.string().optional(),
    note: noteSchema.optional(),
  })
  .refine((v) => v.fullName || v.full_name, { message: 'fullName is required' })
  .refine((v) => v.dateOfBirth || v.date_of_birth, { message: 'dateOfBirth is required' })

/** Partial update; `note: null` or an empty note clears it. */
export const updateChildSchema = z.object({
  fullName: fullNameSchema.optional(),
  dateOfBirth: z.string().min(1).optional(),
  gender: z.string().optional(),
  note: noteSchema.nullable().optional(),
})

export function normalizeNote(note: string | null | undefined): string | null | undefined {
  if (note === undefined) return undefined
  return note ? note : null
}
