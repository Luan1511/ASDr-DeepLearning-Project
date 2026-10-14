/**
 * Child age for questionnaire eligibility, in completed months.
 *
 * Dates of birth are calendar dates stored at UTC midnight (lib/childInput.ts).
 * "Today" is the calendar date in Vietnam (Asia/Ho_Chi_Minh, UTC+7, no DST), so
 * a parent answering at 00:30 local time already gets that day's age.
 */
import { MCHAT_RF } from './mchatRf'

export type CalendarDate = { y: number; m: number; d: number }

const VN_OFFSET_MS = 7 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

export function vnCalendarDate(at: Date): CalendarDate {
  const shifted = new Date(at.getTime() + VN_OFFSET_MS)
  return { y: shifted.getUTCFullYear(), m: shifted.getUTCMonth() + 1, d: shifted.getUTCDate() }
}

function utcCalendarDate(date: Date): CalendarDate {
  return { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() }
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

function formatDate({ y, m, d }: CalendarDate): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function toUtcMidnight({ y, m, d }: CalendarDate): Date {
  return new Date(Date.UTC(y, m - 1, d))
}

function addMonthsParts(dobUtc: Date, months: number): CalendarDate {
  const dob = utcCalendarDate(dobUtc)
  const index = dob.y * 12 + (dob.m - 1) + months
  const y = Math.floor(index / 12)
  const m = (index % 12) + 1
  return { y, m, d: Math.min(dob.d, daysInMonth(y, m)) }
}

/**
 * (y2−y1)·12 + (m2−m1), minus one while the month anniversary has not been
 * reached. For birthdays late in the month the anniversary is clamped to the
 * month's last day, the same rule as addMonthsClamped, so the age on the date
 * returned by addMonthsClamped(dob, k) is exactly k.
 */
export function ageInCompletedMonths(dobUtcMidnight: Date, at: Date): number {
  const dob = utcCalendarDate(dobUtcMidnight)
  const now = vnCalendarDate(at)
  const anniversaryDay = Math.min(dob.d, daysInMonth(now.y, now.m))
  return (now.y - dob.y) * 12 + (now.m - dob.m) - (now.d < anniversaryDay ? 1 : 0)
}

/** DOB + months as YYYY-MM-DD, with the day clamped to the month (Feb 29 → Feb 28). */
export function addMonthsClamped(dobUtc: Date, months: number): string {
  return formatDate(addMonthsParts(dobUtc, months))
}

export type McHatEligibility = {
  eligible: boolean
  reason: 'TOO_YOUNG' | 'TOO_OLD' | null
  ageMonths: number
  /** YYYY-MM-DD: first day at 16 completed months. */
  eligibleFrom: string
  /** YYYY-MM-DD: last day at 30 completed months. */
  eligibleUntil: string
}

export function mchatEligibility(dobUtc: Date, at: Date): McHatEligibility {
  const { min, max } = MCHAT_RF.ageMonths
  const ageMonths = ageInCompletedMonths(dobUtc, at)
  const firstTooOld = toUtcMidnight(addMonthsParts(dobUtc, max + 1))
  const reason = ageMonths < min ? 'TOO_YOUNG' : ageMonths > max ? 'TOO_OLD' : null
  return {
    eligible: reason === null,
    reason,
    ageMonths,
    eligibleFrom: addMonthsClamped(dobUtc, min),
    eligibleUntil: formatDate(utcCalendarDate(new Date(firstTooOld.getTime() - DAY_MS))),
  }
}

/** UTC midnight of the second birthday (Feb 29 births → Feb 28). */
export function secondBirthday(dobUtc: Date): Date {
  return toUtcMidnight(addMonthsParts(dobUtc, 24))
}
