/**
 * Sharing a child's record with a doctor (Giai đoạn 7): the scopes a parent
 * can grant, the statement they agree to (stored with every grant, like the
 * video consent), input validation and the whitelisting serializers.
 *
 * Rules that never change: a doctor only reads, only while a grant is active,
 * only the granted scopes, and never a video or a file name.
 */
import type { DoctorChildLink, DoctorProfile } from '@prisma/client'
import { z } from 'zod'

export const DOCTOR_SHARE_VERSION = 'doctor-share-2026-11-20'

export const DOCTOR_SHARE_SCOPES = ['PROFILE', 'PERSONALIZATION', 'SCREENING', 'QUESTIONNAIRE', 'EXERCISE'] as const
export type DoctorShareScope = (typeof DOCTOR_SHARE_SCOPES)[number]
/** Without the basic profile the doctor could not tell whose record it is. */
export const REQUIRED_SHARE_SCOPES: DoctorShareScope[] = ['PROFILE']

export const DOCTOR_MESSAGE_MAX = 300

export type DoctorMode = 'off' | 'demo' | 'on'

export type DoctorShareStatement = {
  version: string
  title: string
  intro: string
  scopes: Array<{ scope: DoctorShareScope; label: string; detail: string; required: boolean }>
  notes: string[]
}

const SCOPE_TEXT: Record<DoctorShareScope, { label: string; detail: string }> = {
  PROFILE: {
    label: 'Thông tin cơ bản',
    detail: 'Họ tên, ngày sinh, giới tính và ghi chú trong hồ sơ của trẻ; họ tên của phụ huynh.',
  },
  PERSONALIZATION: {
    label: 'Hồ sơ cá nhân hoá',
    detail: 'Tên gọi ở nhà, sở thích, cách giao tiếp, điều con nhạy cảm, điều giúp con bình tĩnh và mục tiêu của bố mẹ.',
  },
  SCREENING: {
    label: 'Kết quả sàng lọc dáng đi',
    detail: 'Mức cần theo dõi, điểm sàng lọc của mô hình, chỉ số dáng đi và ghi chú chất lượng video của từng lần.',
  },
  QUESTIONNAIRE: {
    label: 'Kết quả bảng hỏi phụ huynh',
    detail: 'Điểm, mức kết quả, số thứ tự các mục cần xem lại và kết quả phần hỏi thêm của từng lần trả lời.',
  },
  EXERCISE: {
    label: 'Tiến độ luyện tập',
    detail: 'Số lần tập, điểm luyện tập và góp ý động tác theo từng bài tập.',
  },
}

export function buildDoctorShareStatement(mode: DoctorMode): DoctorShareStatement {
  const notes = [
    'Tôi là cha, mẹ hoặc người giám hộ hợp pháp của trẻ và có quyền quyết định chia sẻ hồ sơ của trẻ.',
    'Bác sĩ được chọn chỉ xem được những phần tôi đánh dấu, không sửa hay xoá được dữ liệu.',
    'Video của trẻ không bao giờ được chia sẻ; bác sĩ chỉ thấy kết quả đã phân tích.',
    'Tôi xem được lần gần nhất bác sĩ mở hồ sơ, và có thể ngừng chia sẻ bất cứ lúc nào; việc ngừng có hiệu lực ngay.',
    'Quyền chia sẻ mặc định hết hạn sau 90 ngày; phụ huynh có thể chọn 30, 90, 180 ngày hoặc không thời hạn.',
    'Kết quả trong ứng dụng là sàng lọc tham khảo, không phải chẩn đoán y khoa.',
  ]
  if (mode === 'demo') {
    notes.push(
      'Danh sách hiện tại là bác sĩ mẫu để thử tính năng, không phải bác sĩ thật. Không dùng các tài khoản này để xin tư vấn y khoa.',
    )
  }
  return {
    version: DOCTOR_SHARE_VERSION,
    title: 'Chia sẻ hồ sơ của trẻ với bác sĩ',
    intro:
      'Khi kết nối, bác sĩ bạn chọn sẽ thấy hồ sơ của trẻ trong danh sách của họ và xem được những phần bạn đánh dấu dưới đây.',
    scopes: DOCTOR_SHARE_SCOPES.map((scope) => ({
      scope,
      ...SCOPE_TEXT[scope],
      required: REQUIRED_SHARE_SCOPES.includes(scope),
    })),
    notes,
  }
}

export const createDoctorLinkSchema = z.object({
  doctorId: z.string().uuid(),
  scopes: z.array(z.enum(DOCTOR_SHARE_SCOPES)).min(1),
  accepted: z.literal(true),
  version: z.string().min(1),
  durationDays: z.union([z.literal(30), z.literal(90), z.literal(180), z.literal(0)]).default(90),
  message: z
    .string()
    .trim()
    .max(DOCTOR_MESSAGE_MAX)
    .optional()
    .transform((v) => (v ? v : null)),
})

/** Stored scopes in the canonical order; unknown values are dropped. */
export function normalizeScopes(scopes: string[]): DoctorShareScope[] {
  return DOCTOR_SHARE_SCOPES.filter((scope) => scopes.includes(scope))
}

/** Lower-case without Vietnamese tone and vowel marks, so "am ngu" finds "Âm ngữ". */
export function foldVietnamese(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
}

const searchWords = (text: string) => foldVietnamese(text).split(/[^a-z0-9]+/).filter(Boolean)

/**
 * Free-text search of the directory: every word typed must begin a word of
 * the name, title, specialty, workplace or city ("am ngu" finds "Âm ngữ trị
 * liệu" but not "Tâm lý ... Nguyễn").
 */
export function doctorMatchesQuery(
  doctor: Pick<DoctorProfile, 'displayName' | 'title' | 'specialty' | 'workplace' | 'city'>,
  query: string,
): boolean {
  const words = searchWords([doctor.title, doctor.displayName, doctor.specialty, doctor.workplace, doctor.city].join(' '))
  return searchWords(query).every((typed) => words.some((word) => word.startsWith(typed)))
}

/** Which doctors a parent may see: the sample ones only in demo mode. */
export function listedDoctorFilter(mode: DoctorMode) {
  return mode === 'on'
    ? { isMock: false, isActive: true, verificationStatus: 'VERIFIED' as const }
    : { isActive: true, OR: [{ isMock: true }, { isMock: false, verificationStatus: 'VERIFIED' as const }] }
}

export function serializeDoctor(doctor: DoctorProfile) {
  return {
    id: doctor.id,
    displayName: doctor.displayName,
    title: doctor.title,
    specialty: doctor.specialty,
    workplace: doctor.workplace,
    city: doctor.city,
    bio: doctor.bio,
    languages: doctor.languages,
    isMock: doctor.isMock,
    acceptingNew: doctor.acceptingNew,
    verified: doctor.verificationStatus === 'VERIFIED' && doctor.isActive,
  }
}

/** A grant as its parent sees it (with the doctor it goes to). */
export function serializeDoctorLink(link: DoctorChildLink & { doctor: DoctorProfile }) {
  return {
    id: link.id,
    childId: link.childId,
    doctor: serializeDoctor(link.doctor),
    scopes: normalizeScopes(link.scopes),
    version: link.version,
    message: link.message,
    grantedAt: link.grantedAt,
    expiresAt: link.expiresAt,
    revokedAt: link.revokedAt,
    active: link.revokedAt === null && (link.expiresAt === null || link.expiresAt > new Date()),
    lastViewedAt: link.lastViewedAt,
    viewCount: link.viewCount,
  }
}

/** Whole months between a date of birth and `now` (never negative). */
export function ageInMonths(dateOfBirth: Date, now: Date = new Date()): number {
  let months = (now.getUTCFullYear() - dateOfBirth.getUTCFullYear()) * 12 + (now.getUTCMonth() - dateOfBirth.getUTCMonth())
  if (now.getUTCDate() < dateOfBirth.getUTCDate()) months -= 1
  return Math.max(0, months)
}
