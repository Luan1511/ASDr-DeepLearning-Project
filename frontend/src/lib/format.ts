import type { Gender, GaitView, JobStatus, QualityLevel, ScreeningStatus } from './types'

export const SCREENING_STATUS_LABEL: Record<ScreeningStatus, string> = {
  UPLOADED: 'Đã tải lên',
  PROCESSING: 'Đang phân tích',
  COMPLETED: 'Hoàn tất',
  FAILED: 'Thất bại',
}

export const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  QUEUED: 'Đang chờ',
  RUNNING: 'Đang chạy',
  SUCCEEDED: 'Xong',
  FAILED: 'Lỗi',
}

export const GENDER_LABEL: Record<Gender, string> = {
  MALE: 'Nam',
  FEMALE: 'Nữ',
  OTHER: 'Khác',
  UNSPECIFIED: 'Chưa rõ giới tính',
}

export const QUALITY_LABEL: Record<QualityLevel, string> = {
  good: 'Chất lượng tốt',
  fair: 'Chất lượng trung bình',
  poor: 'Chất lượng thấp',
}

export const GAIT_VIEW_LABEL: Record<GaitView, string> = {
  side: 'Quay ngang',
  frontal: 'Quay chính diện',
  oblique: 'Quay chéo',
  unknown: 'Không xác định',
}

export function formatNumber(value: number, digits = 1) {
  return value.toLocaleString('vi-VN', { maximumFractionDigits: digits, minimumFractionDigits: 0 })
}

export function formatPercent(value: number, digits = 0) {
  return `${formatNumber(value * 100, digits)}%`
}

export function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${formatNumber(bytes / 1024, 0)} KB`
  return `${formatNumber(bytes / 1024 / 1024, 1)} MB`
}

export function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('vi-VN')
}

const pad2 = (n: number) => String(n).padStart(2, '0')

/** "16:20 06/10/2026" (local time). */
export function formatDateTime(iso: string) {
  const d = new Date(iso)
  return `${formatTime(iso)} ${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`
}

/** "06/10" (local date, no year). */
export function formatDayMonth(iso: string) {
  const d = new Date(iso)
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}`
}

/** "16:20" (local time). */
export function formatTime(iso: string) {
  const d = new Date(iso)
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

/** Dates of birth are calendar dates stored at UTC midnight; format them in UTC. */
export function formatBirthDate(iso: string) {
  return new Date(iso).toLocaleDateString('vi-VN', { timeZone: 'UTC' })
}

/** "3 tuổi 7 tháng" — whole months between the date of birth and today. */
export function formatAge(dateOfBirth: string, now: Date = new Date()) {
  const dob = new Date(dateOfBirth)
  let months = (now.getFullYear() - dob.getUTCFullYear()) * 12 + (now.getMonth() - dob.getUTCMonth())
  if (now.getDate() < dob.getUTCDate()) months -= 1
  if (months < 0) return '—'
  const years = Math.floor(months / 12)
  const rest = months % 12
  if (years === 0) return months === 0 ? 'Dưới 1 tháng tuổi' : `${months} tháng tuổi`
  return rest ? `${years} tuổi ${rest} tháng` : `${years} tuổi`
}

/** `<input type="date">` value (YYYY-MM-DD) for a date of birth. */
export function toDateInputValue(iso: string) {
  return iso.slice(0, 10)
}

/** Today's local date as YYYY-MM-DD (max for date-of-birth inputs). */
export function todayInputValue(now: Date = new Date()) {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`
}
