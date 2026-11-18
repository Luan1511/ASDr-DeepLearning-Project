/** Personalisation of a child's profile (Giai đoạn 6): DTOs, API calls and labels. */
import { api, apiErrorCode, isNetworkError } from './api'
import type { BodyFocus, ExerciseSummaryDto, PracticeMode } from './exerciseTypes'

export type CommunicationLevel = 'NOT_YET_SPEAKING' | 'SINGLE_WORDS' | 'SHORT_PHRASES' | 'SENTENCES'
export type SensoryTag = 'SOUND' | 'LIGHT' | 'TOUCH' | 'CROWD' | 'CHANGE'
export type GuideSpeed = 'AUTO' | 'NORMAL' | 'SLOW'
export type PracticeModePref = 'AUTO' | PracticeMode

export type Personalization = {
  nickname: string | null
  interests: string[]
  communication: CommunicationLevel | null
  sensory: SensoryTag[]
  calming: string | null
  goals: string | null
  focusAreas: BodyFocus[]
  guideSpeed: GuideSpeed
  practiceMode: PracticeModePref
  /** Null: no choice made (Bin reminds during practice). */
  liveCoach: boolean | null
  /** Practice days per week the family aims for. */
  weeklyGoal: number | null
  updatedAt: string | null
}

export type PersonalizationInput = Omit<Personalization, 'updatedAt'>

export const EMPTY_PERSONALIZATION: PersonalizationInput = {
  nickname: null,
  interests: [],
  communication: null,
  sensory: [],
  calming: null,
  goals: null,
  focusAreas: [],
  guideSpeed: 'AUTO',
  practiceMode: 'AUTO',
  liveCoach: null,
  weeklyGoal: null,
}

/** Settings suggested for one exercise, with the reasons in the parent's words. */
export type ExerciseSettingsDto = {
  playbackRate: 0.75 | 1
  practiceMode: PracticeMode | null
  liveCoach: boolean
  coachVoice: boolean
  /** `topic` 'coach' only matters for exercises where Bin can remind during practice. */
  reasons: Array<{ topic: 'speed' | 'mode' | 'coach'; text: string }>
}

export type RecommendationKind = 'START' | 'CONTINUE' | 'STEP_UP' | 'NEW' | 'REVIEW'

export type ExercisePlanDto = {
  nickname: string | null
  level: 1 | 2 | 3
  weekly: { goal: number | null; daysPractised: number; weekStart: string }
  recommendations: Array<{
    kind: RecommendationKind
    reason: string
    settings: ExerciseSettingsDto
    exercise: ExerciseSummaryDto
  }>
}

export const NICKNAME_MAX = 40
export const INTEREST_MAX_COUNT = 12
export const INTEREST_MAX_LENGTH = 40
export const FREE_TEXT_MAX = 500

export async function fetchPersonalization(childId: string): Promise<{ personalization: Personalization; empty: boolean }> {
  return (await api.get(`/children/${childId}/personalization`)).data
}

export async function savePersonalization(
  childId: string,
  input: PersonalizationInput,
): Promise<{ personalization: Personalization; empty: boolean }> {
  return (await api.put(`/children/${childId}/personalization`, input)).data
}

export async function fetchExercisePlan(
  childId: string,
  exerciseId?: string,
): Promise<{ plan: ExercisePlanDto; settings?: ExerciseSettingsDto }> {
  return (await api.get(`/children/${childId}/exercise-plan`, { params: exerciseId ? { exerciseId } : undefined })).data
}

// ---------------------------------------------------------------------------
// Labels (Vietnamese, descriptive, never diagnostic)
// ---------------------------------------------------------------------------

export const COMMUNICATION_LABEL: Record<CommunicationLevel, string> = {
  NOT_YET_SPEAKING: 'Chưa nói, dùng cử chỉ hoặc âm thanh',
  SINGLE_WORDS: 'Nói từ đơn',
  SHORT_PHRASES: 'Nói cụm từ ngắn',
  SENTENCES: 'Nói thành câu',
}

export const SENSORY_LABEL: Record<SensoryTag, string> = {
  SOUND: 'Âm thanh lớn',
  LIGHT: 'Ánh sáng mạnh',
  TOUCH: 'Bị chạm vào',
  CROWD: 'Chỗ đông người',
  CHANGE: 'Thay đổi đột ngột',
}
export const SENSORY_ORDER: SensoryTag[] = ['SOUND', 'LIGHT', 'TOUCH', 'CROWD', 'CHANGE']

export const GUIDE_SPEED_LABEL: Record<GuideSpeed, string> = {
  AUTO: 'Tự động theo các lần tập',
  NORMAL: 'Bình thường',
  SLOW: 'Chậm hơn',
}

export const PRACTICE_PREF_LABEL: Record<PracticeModePref, string> = {
  AUTO: 'Tự chọn theo màn hình',
  FOLLOW_ALONG: 'Làm cùng bạn Bin',
  AFTER_DEMO: 'Xem trước rồi làm theo',
}

export const FOCUS_ORDER: BodyFocus[] = ['ARMS', 'LEGS', 'TRUNK']

/** Quick picks for the interests field; parents can type their own. */
export const INTEREST_SUGGESTIONS = [
  'Khủng long',
  'Xe cộ',
  'Âm nhạc',
  'Vẽ',
  'Con vật',
  'Bóng',
  'Xếp hình',
  'Nước',
  'Truyện tranh',
  'Con số',
]

export const RECOMMENDATION_LABEL: Record<RecommendationKind, string> = {
  START: 'Bắt đầu',
  CONTINUE: 'Tập tiếp',
  STEP_UP: 'Thử mức mới',
  NEW: 'Bài mới',
  REVIEW: 'Ôn lại',
}

export const PERSONALIZATION_NOTE =
  'Những thông tin này chỉ để ứng dụng và người chăm sóc hiểu con hơn (cách Bin làm mẫu, gợi ý bài tập). Không dùng để sàng lọc hay đánh giá y khoa, và chỉ chia sẻ với bác sĩ khi bạn chọn.'

/** Parent text for an error of the personalisation endpoints. */
export function personalizationErrorMessage(error: unknown, fallback: string): string {
  const code = apiErrorCode(error)
  if (code === 'VALIDATION_ERROR') {
    return `Thông tin chưa hợp lệ: tên gọi tối đa ${NICKNAME_MAX} ký tự, tối đa ${INTEREST_MAX_COUNT} sở thích, mỗi ô ghi chú tối đa ${FREE_TEXT_MAX} ký tự.`
  }
  if (code === 'CHILD_NOT_FOUND') return 'Không tìm thấy hồ sơ trẻ (có thể đã bị xoá).'
  if (code === 'DATABASE_MIGRATION_REQUIRED') return 'Máy chủ chưa được cập nhật cơ sở dữ liệu cho phần cá nhân hoá. Vui lòng báo quản trị viên.'
  if (isNetworkError(error)) return 'Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.'
  return fallback
}
