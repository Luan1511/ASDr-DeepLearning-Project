/** Sharing a child's record with a doctor (Giai đoạn 7): DTOs, API calls and labels. */
import { useEffect, useState } from 'react'
import { api, apiErrorCode, isNetworkError } from './api'
import type { ExerciseProgressDto } from './exerciseTypes'
import type { Personalization } from './personalization'
import type { QuestionnaireResponseDto } from './questionnaireTypes'
import type { Gender, ScreeningResult, ScreeningStatus } from './types'

export type DoctorMode = 'off' | 'demo' | 'on'
export type DoctorCapabilities = { mode: DoctorMode; available: boolean; demo: boolean }

export type DoctorShareScope = 'PROFILE' | 'PERSONALIZATION' | 'SCREENING' | 'QUESTIONNAIRE' | 'EXERCISE'

export type DoctorDto = {
  id: string
  displayName: string
  title: string
  specialty: string
  workplace: string
  city: string
  bio: string
  languages: string[]
  /** Sample doctor for trying the feature (not a real person). */
  isMock: boolean
  acceptingNew: boolean
  verified: boolean
}

/** A directory entry: the doctor plus which of MY children they currently see. */
export type DoctorListItem = DoctorDto & { links: Array<{ id: string; childId: string; expiresAt: string | null; scopes: DoctorShareScope[] }> }

export type DoctorDirectory = { demo: boolean; doctors: DoctorListItem[]; cities: string[]; specialties: string[] }

export type DoctorShareStatement = {
  version: string
  title: string
  intro: string
  scopes: Array<{ scope: DoctorShareScope; label: string; detail: string; required: boolean }>
  notes: string[]
}

export type DoctorLinkDto = {
  id: string
  childId: string
  doctor: DoctorDto
  scopes: DoctorShareScope[]
  version: string
  message: string | null
  grantedAt: string
  revokedAt: string | null
  active: boolean
  /** When the doctor last opened the record (null = not yet). */
  lastViewedAt: string | null
  viewCount: number
  expiresAt: string | null
}

/** Doctor side: one shared record in the list. */
export type PatientSummaryDto = {
  expiresAt: string | null
  linkId: string
  scopes: DoctorShareScope[]
  message: string | null
  grantedAt: string
  lastViewedAt: string | null
  child: { fullName: string; dateOfBirth: string; ageMonths: number; gender: Gender; note: string | null }
  parent: { name: string }
}

/** Doctor side: a shared record with the parts the parent granted. */
export type PatientRecordDto = {
  patient: PatientSummaryDto
  personalization?: Personalization
  screenings?: Array<{ id: string; status: ScreeningStatus; createdAt: string; result: ScreeningResult | null }>
  questionnaires?: QuestionnaireResponseDto[]
  exercises?: ExerciseProgressDto[]
}

export const DOCTOR_MESSAGE_MAX = 300

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

const TTL_MS = 60_000
let capsCache: { key: string; at: number; promise: Promise<DoctorCapabilities | null> } | null = null

function authKey(): string {
  const header = api.defaults.headers.common.Authorization
  return typeof header === 'string' ? header : ''
}

export function loadDoctorCapabilities(): Promise<DoctorCapabilities | null> {
  const key = authKey()
  if (capsCache && capsCache.key === key && Date.now() - capsCache.at < TTL_MS) return capsCache.promise
  // An older backend (no doctor routes) or an error simply hides the feature.
  const promise = api
    .get('/doctors/capabilities')
    .then((res) => res.data as DoctorCapabilities)
    .catch(() => null)
  capsCache = { key, at: Date.now(), promise }
  return promise
}

/** null while loading or when the backend does not offer the doctor feature. */
export function useDoctorCapabilities(): DoctorCapabilities | null {
  const [caps, setCaps] = useState<DoctorCapabilities | null>(null)
  useEffect(() => {
    let stale = false
    loadDoctorCapabilities().then((value) => !stale && setCaps(value))
    return () => {
      stale = true
    }
  }, [])
  return caps
}

export async function fetchDoctors(params: { q?: string; city?: string; specialty?: string } = {}): Promise<DoctorDirectory> {
  const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v))
  return (await api.get('/doctors', { params: clean })).data
}

export async function fetchShareStatement(): Promise<DoctorShareStatement> {
  return (await api.get('/doctors/share-statement')).data.statement
}

export async function fetchDoctorLinks(childId: string): Promise<{ available: boolean; links: DoctorLinkDto[] }> {
  return (await api.get(`/children/${childId}/doctor-links`)).data
}

export async function createDoctorLink(
  childId: string,
  input: { doctorId: string; scopes: DoctorShareScope[]; version: string; durationDays?: 30 | 90 | 180 | 0; message?: string },
): Promise<DoctorLinkDto> {
  return (await api.post(`/children/${childId}/doctor-links`, { ...input, accepted: true })).data.link
}

export async function revokeDoctorLink(childId: string, linkId: string): Promise<{ revoked: number }> {
  return (await api.delete(`/children/${childId}/doctor-links/${linkId}`)).data
}

export async function fetchDoctorMe(): Promise<{ doctor: DoctorDto; stats: { activePatients: number } }> {
  return (await api.get('/doctor/me')).data
}

export async function fetchPatients(): Promise<PatientSummaryDto[]> {
  return (await api.get('/doctor/patients')).data.patients
}

export async function fetchPatientRecord(linkId: string): Promise<PatientRecordDto> {
  return (await api.get(`/doctor/patients/${linkId}`)).data
}

// ---------------------------------------------------------------------------
// Labels and messages
// ---------------------------------------------------------------------------

export const SHARE_SCOPE_LABEL: Record<DoctorShareScope, string> = {
  PROFILE: 'Thông tin cơ bản',
  PERSONALIZATION: 'Hồ sơ cá nhân hoá',
  SCREENING: 'Kết quả sàng lọc dáng đi',
  QUESTIONNAIRE: 'Kết quả bảng hỏi',
  EXERCISE: 'Tiến độ luyện tập',
}

export const MOCK_DOCTOR_NOTICE =
  'Đây là danh sách bác sĩ mẫu để thử tính năng chia sẻ hồ sơ. Các tài khoản này không phải bác sĩ thật — không dùng để xin tư vấn y khoa.'

export const DOCTOR_VIEW_DISCLAIMER =
  'Dữ liệu do phụ huynh chia sẻ từ ứng dụng AIMBRACE. Kết quả sàng lọc, bảng hỏi và điểm luyện tập chỉ mang tính tham khảo, không phải chẩn đoán; mô hình và cách chấm đang trong giai đoạn thử nghiệm.'

export function doctorName(doctor: Pick<DoctorDto, 'title' | 'displayName'>): string {
  return `${doctor.title} ${doctor.displayName}`.trim()
}

const API_ERROR_MESSAGE: Record<string, string> = {
  DOCTORS_DISABLED: 'Tính năng kết nối bác sĩ hiện chưa mở.',
  DOCTOR_ONLY: 'Trang này chỉ dành cho tài khoản bác sĩ.',
  DOCTOR_NOT_FOUND: 'Không tìm thấy bác sĩ này (có thể đã ngừng nhận hồ sơ).',
  DOCTOR_NOT_ACCEPTING: 'Bác sĩ này hiện chưa nhận thêm hồ sơ mới.',
  CANNOT_SHARE_WITH_SELF: 'Không thể chia sẻ hồ sơ với chính tài khoản của bạn.',
  CHILD_NOT_FOUND: 'Không tìm thấy hồ sơ trẻ (có thể đã bị xoá).',
  LINK_NOT_FOUND: 'Không tìm thấy kết nối này (có thể đã được ngừng).',
  PATIENT_NOT_FOUND: 'Hồ sơ này không còn được chia sẻ với bạn (phụ huynh đã ngừng chia sẻ hoặc đã xoá hồ sơ).',
  SHARE_SCOPE_REQUIRED: 'Cần chia sẻ ít nhất phần “Thông tin cơ bản”.',
  SHARE_VERSION_OUTDATED: 'Nội dung chia sẻ vừa được cập nhật. Vui lòng đọc lại và xác nhận.',
  VALIDATION_ERROR: `Thông tin chưa hợp lệ (lời nhắn tối đa ${DOCTOR_MESSAGE_MAX} ký tự).`,
  DATABASE_MIGRATION_REQUIRED: 'Máy chủ chưa được cập nhật cơ sở dữ liệu cho tính năng bác sĩ. Vui lòng báo quản trị viên.',
}

export function doctorApiErrorMessage(error: unknown, fallback: string): string {
  const code = apiErrorCode(error)
  if (code && API_ERROR_MESSAGE[code]) return API_ERROR_MESSAGE[code]
  if (isNetworkError(error)) return 'Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.'
  return fallback
}
