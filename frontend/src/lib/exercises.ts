/** API calls, labels and parent-facing messages for Giai đoạn 4 exercises. */
import { api, apiErrorCode, isNetworkError } from './api'
import type {
  AdminExerciseDto,
  AdminExerciseQueueDto,
  AdminExerciseStatsDto,
  AdminTemplateDto,
  BodyFocus,
  BuildTemplateResultDto,
  ExerciseCapabilitiesDto,
  ExerciseConsentStatus,
  ExerciseProgressDto,
  ExerciseSessionDto,
  ExerciseSummaryDto,
  GuideTemplateDto,
  ImitationBand,
  ImitationReasonCode,
  ImitationWarningCode,
  MirrorPolicy,
  PartId,
  PracticeMode,
  RecordedVia,
} from './exerciseTypes'
import type { ConsentStatement } from './types'

// ---------------------------------------------------------------------------
// Parent API
// ---------------------------------------------------------------------------

export async function fetchExerciseCapabilities(): Promise<ExerciseCapabilitiesDto> {
  return (await api.get('/exercises/capabilities')).data
}

export async function fetchExerciseConsentStatement(): Promise<ConsentStatement> {
  return (await api.get('/exercises/consent-statement')).data.statement
}

export async function fetchExercises(childId?: string): Promise<ExerciseSummaryDto[]> {
  return (await api.get('/exercises', { params: childId ? { childId } : undefined })).data.exercises
}

export async function fetchExercise(id: string): Promise<{ exercise: ExerciseSummaryDto; guide: GuideTemplateDto }> {
  return (await api.get(`/exercises/${id}`)).data
}

export async function fetchExerciseConsent(childId: string): Promise<ExerciseConsentStatus> {
  return (await api.get(`/children/${childId}/exercise-consent`)).data
}

export async function grantExerciseConsent(childId: string, version: string) {
  return (await api.post(`/children/${childId}/exercise-consent`, { accepted: true, version, scopes: ['EXERCISE_VIDEO'] }))
    .data.consent as ExerciseConsentStatus['consent']
}

export async function revokeExerciseConsent(childId: string): Promise<{ revoked: number }> {
  return (await api.delete(`/children/${childId}/exercise-consent`)).data
}

export type UploadExerciseVideoInput = {
  childId: string
  exerciseId: string
  templateId: string
  file: Blob
  filename: string
  durationMs: number
  videoWidth?: number | null
  videoHeight?: number | null
  recordedVia: RecordedVia
  practiceMode: PracticeMode
  playbackRate: 0.75 | 1
  guideOffsetMs?: number | null
  onProgress?: (pct: number) => void
}

export async function uploadExerciseVideo(input: UploadExerciseVideoInput): Promise<ExerciseSessionDto> {
  const fd = new FormData()
  fd.append('durationMs', String(Math.round(input.durationMs)))
  if (input.videoWidth) fd.append('videoWidth', String(input.videoWidth))
  if (input.videoHeight) fd.append('videoHeight', String(input.videoHeight))
  fd.append('recordedVia', input.recordedVia)
  fd.append('practiceMode', input.practiceMode)
  fd.append('playbackRate', String(input.playbackRate))
  if (input.guideOffsetMs !== undefined && input.guideOffsetMs !== null) fd.append('guideOffsetMs', String(Math.round(input.guideOffsetMs)))
  fd.append('video', input.file, input.filename)
  const res = await api.post('/exercise-sessions/upload', fd, {
    params: { childId: input.childId, exerciseId: input.exerciseId, templateId: input.templateId },
    onUploadProgress: (ev) => {
      if (ev.total && input.onProgress) input.onProgress(Math.round((ev.loaded / ev.total) * 100))
    },
  })
  return res.data.session
}

export async function fetchExerciseSessions(params: { childId: string; exerciseId?: string; limit?: number }): Promise<ExerciseSessionDto[]> {
  return (await api.get('/exercise-sessions', { params })).data.sessions
}

export async function fetchExerciseSession(id: string): Promise<ExerciseSessionDto> {
  return (await api.get(`/exercise-sessions/${id}`, { params: { _t: Date.now() } })).data.session
}

export async function retryExerciseSession(id: string): Promise<ExerciseSessionDto> {
  return (await api.post(`/exercise-sessions/${id}/retry`)).data.session
}

export async function deleteExerciseSession(id: string): Promise<{ deleted: boolean; mlSubjectsDeleted: number }> {
  return (await api.delete(`/exercise-sessions/${id}`)).data
}

export async function fetchExerciseProgress(childId: string): Promise<ExerciseProgressDto[]> {
  return (await api.get(`/children/${childId}/exercise-progress`)).data.exercises
}

// ---------------------------------------------------------------------------
// Admin API
// ---------------------------------------------------------------------------

export type ExerciseMetadataInput = {
  slug: string
  title: string
  description: string
  childPrompt: string
  difficulty: 1 | 2 | 3
  bodyFocus: BodyFocus[]
  sortOrder?: number
}

export async function adminFetchExercises(): Promise<AdminExerciseDto[]> {
  return (await api.get('/admin/exercises')).data.exercises
}

export async function adminCreateExercise(input: ExerciseMetadataInput): Promise<AdminExerciseDto> {
  return (await api.post('/admin/exercises', input)).data.exercise
}

export async function adminUpdateExercise(
  id: string,
  input: Partial<ExerciseMetadataInput> & { status?: 'DRAFT' | 'ARCHIVED' },
): Promise<AdminExerciseDto> {
  return (await api.patch(`/admin/exercises/${id}`, input)).data.exercise
}

export async function adminDeleteExercise(id: string): Promise<{ deleted: boolean }> {
  return (await api.delete(`/admin/exercises/${id}`)).data
}

export type TemplateSourceDto = { sourceSubjectId: string; numFrames: number; fps: number | null; fpsSource: 'ml' | 'duration' | null }

/** Uploads an ADULT demonstration video; the backend extracts it into a "tpl_<uuid>" ML subject. */
export async function adminUploadTemplateSource(
  exerciseId: string,
  file: File,
  durationMs: number | null,
  onProgress?: (pct: number) => void,
): Promise<TemplateSourceDto> {
  const fd = new FormData()
  if (durationMs) fd.append('durationMs', String(Math.round(durationMs)))
  fd.append('attestation', 'true')
  fd.append('video', file)
  const res = await api.post(`/admin/exercises/${exerciseId}/template-sources`, fd, {
    onUploadProgress: (ev) => {
      if (ev.total && onProgress) onProgress(Math.round((ev.loaded / ev.total) * 100))
    },
  })
  return res.data
}

export type CompileTemplateInput = {
  sourceSubjectId: string
  fps?: number | null
  mirrorPolicy: MirrorPolicy
  trim?: { startSec: number; endSec: number }
  dryRun?: boolean
}

export async function adminCompileTemplate(
  exerciseId: string,
  input: CompileTemplateInput,
): Promise<{ template?: AdminTemplateDto; result: BuildTemplateResultDto }> {
  const res = await api.post(`/admin/exercises/${exerciseId}/templates`, { ...input, attestation: true })
  return res.data
}

export async function adminPublishTemplate(exerciseId: string, templateId: string): Promise<AdminExerciseDto> {
  return (await api.post(`/admin/exercises/${exerciseId}/publish`, { templateId })).data.exercise
}

export async function adminDeleteTemplateSource(exerciseId: string, templateId: string): Promise<{ deleted: boolean }> {
  return (await api.delete(`/admin/exercises/${exerciseId}/templates/${templateId}/source-subject`)).data
}

export async function adminSyncBuiltins(): Promise<{
  created: number
  newVersions: number
  unchanged: number
  /** Built-ins whose template did not compile (slug + reason). */
  failed?: Array<{ slug: string; reason: string }>
}> {
  return (await api.post('/admin/exercises/builtins/sync')).data
}

export async function adminFetchExerciseQueue(): Promise<AdminExerciseQueueDto> {
  return (await api.get('/admin/exercises/queue')).data
}

export async function adminFetchExerciseStats(id: string): Promise<AdminExerciseStatsDto> {
  return (await api.get(`/admin/exercises/${id}/stats`)).data
}

/** Admin preview of any template version (including drafts). */
export async function adminFetchTemplateGuide(exerciseId: string, templateId: string): Promise<GuideTemplateDto> {
  return (await api.get(`/admin/exercises/${exerciseId}/templates/${templateId}/guide`)).data.guide
}

// ---------------------------------------------------------------------------
// Labels and messages (Vietnamese, encouraging, never diagnostic)
// ---------------------------------------------------------------------------

/** Named from the CHILD's side. */
export const PART_LABEL: Record<PartId, string> = {
  leftArm: 'Tay trái',
  rightArm: 'Tay phải',
  leftLeg: 'Chân trái',
  rightLeg: 'Chân phải',
  trunk: 'Thân người',
}

export const BODY_FOCUS_LABEL: Record<BodyFocus, string> = { ARMS: 'Tay', LEGS: 'Chân', TRUNK: 'Thân người' }

export const DIFFICULTY_LABEL: Record<1 | 2 | 3, string> = { 1: 'Dễ', 2: 'Vừa', 3: 'Khó hơn' }

export const BAND_LABEL: Record<ImitationBand, string> = {
  VERY_CLOSE: 'Rất giống bạn Mầm',
  CLOSE: 'Khá giống bạn Mầm',
  PROGRESSING: 'Con đang tiến bộ',
  KEEP_PRACTISING: 'Cùng luyện thêm nhé',
}

export const MIRROR_POLICY_LABEL: Record<MirrorPolicy, string> = {
  EITHER: 'Chấp nhận cả làm theo kiểu soi gương',
  ANATOMICAL_ONLY: 'Phải đúng tay/chân (không soi gương)',
  MIRROR_ONLY: 'Chỉ chấp nhận soi gương',
}

export const PRACTICE_MODE_LABEL: Record<PracticeMode, string> = {
  FOLLOW_ALONG: 'Làm cùng bạn Mầm',
  AFTER_DEMO: 'Xem trước rồi làm theo',
}

export const SESSION_STATUS_LABEL: Record<ExerciseSessionDto['status'], string> = {
  QUEUED: 'Đang chờ chấm',
  PROCESSING: 'Đang chấm',
  SCORED: 'Đã chấm',
  INSUFFICIENT: 'Chưa nhìn rõ',
  FAILED: 'Chưa chấm được',
}

export const EXERCISE_DISCLAIMER =
  'Điểm luyện tập do máy tự tính từ khung xương, chỉ để khích lệ và theo dõi tiến bộ của chính con qua các lần tập cùng một bài. Cách chấm đang thử nghiệm, chưa được kiểm chứng trên trẻ em, không so sánh giữa các bài khác nhau và không dùng để sàng lọc hay đánh giá y khoa.'

export const REASON_MESSAGE: Record<ImitationReasonCode, string> = {
  TOO_FEW_FRAMES: 'Máy chưa nhìn thấy con đủ lâu. Đặt máy sao cho thấy cả người con, đủ sáng, rồi thử lại nhé.',
  VIDEO_TOO_SHORT: 'Đoạn quay hơi ngắn. Cùng làm hết bài với bạn Mầm rồi mới dừng nhé.',
  ACTIVE_PART_NOT_VISIBLE: 'Chưa thấy rõ tay hoặc chân của con. Đặt máy xa hơn để thấy cả người nhé.',
}

export const WARNING_MESSAGE: Record<ImitationWarningCode, string> = {
  MULTI_PERSON: 'Có nhiều người trong khung hình; điểm có thể chưa chính xác. Lần sau chỉ để mình con trước camera.',
  NOT_FACING: 'Con nên đứng quay mặt về phía camera để chấm chính xác hơn.',
  FPS_UNCERTAIN: 'Không đo chính xác được tốc độ khung hình; nhận xét về nhịp có thể chưa chính xác.',
  TEMPO_LIMIT: 'Nhịp làm của con khác khá nhiều so với bạn Mầm; nhận xét về nhịp chỉ mang tính gợi ý.',
  ROLL_UNCERTAIN: 'Máy quay hơi nghiêng; hãy đặt máy thẳng ở lần sau.',
  MIRRORED_VIDEO: 'Video có vẻ đã bị lật như gương (tuỳ chọn của camera điện thoại); điểm vẫn được tính.',
  LOW_MOTION: 'Lần này con chưa cử động nhiều; mình cùng thử lại nhé!',
}

export const SETUP_TIPS = [
  'Đặt máy cách con khoảng 2–3 mét, ngang tầm ngực con.',
  'Thấy cả người con, từ đầu đến bàn chân.',
  'Phòng đủ sáng, tránh đứng ngược sáng cửa sổ.',
  'Chỉ một mình con trong khung hình — bố mẹ đứng phía sau máy.',
  'Con đứng yên một chút khi bắt đầu.',
]

const API_ERROR_MESSAGE: Record<string, string> = {
  RECORDING_FORMAT_UNSUPPORTED:
    'Máy chủ phân tích hiện chưa nhận định dạng video WebM của trình duyệt này. Hãy dùng Chrome bản mới (126 trở lên) hoặc Safari, hoặc quay bằng điện thoại rồi tải video lên.',
  TOO_MANY_PENDING: 'Con đã gửi nhiều bài đang chờ chấm. Đợi các bài trước có kết quả rồi gửi tiếp nhé.',
  EXERCISE_IN_PROGRESS: 'Đang có bài tập của trẻ được chấm điểm. Vui lòng đợi xong (thường dưới vài phút) rồi xoá lại.',
  TEMPLATE_OUTDATED: 'Bài mẫu vừa được cập nhật. Mình tải lại bài và tập lại nhé.',
  EXERCISE_CONSENT_REQUIRED: 'Cần bật quyền ghi hình bài tập cho con trước khi gửi.',
  RECORDING_TOO_LONG: 'Video dài quá. Hãy quay ngắn hơn.',
  RECORDING_TOO_SHORT: 'Video ngắn hơn bài mẫu. Để con làm hết động tác rồi mới dừng ghi nhé.',
  EXERCISES_DISABLED: 'Tính năng bài tập đang được nhóm thử nghiệm và chưa mở cho phụ huynh.',
  EXERCISE_NOT_FOUND: 'Không tìm thấy bài tập (có thể đã được ẩn).',
  CHILD_NOT_FOUND: 'Không tìm thấy hồ sơ trẻ.',
  SESSION_NOT_FOUND: 'Không tìm thấy lượt tập (có thể đã bị xoá).',
  RETRY_NOT_AVAILABLE: 'Lượt tập này không thể chấm lại (video đã được xoá). Mình tập lại lần mới nhé.',
  ML_UNAVAILABLE:
    'Chưa kết nối được máy chủ phân tích để xoá dữ liệu trên đó. Dữ liệu vẫn được giữ nguyên; vui lòng thử lại sau.',
  FILE_TOO_LARGE: 'Video quá lớn. Hãy quay ngắn hơn hoặc giảm chất lượng.',
  UNSUPPORTED_FILE_TYPE: 'Định dạng video không được hỗ trợ (dùng MP4, MOV, MKV hoặc WebM).',
  CONSENT_VERSION_OUTDATED: 'Nội dung đồng ý vừa được cập nhật. Vui lòng đọc lại và xác nhận.',
  DATABASE_MIGRATION_REQUIRED: 'Máy chủ chưa được cập nhật cơ sở dữ liệu cho tính năng bài tập. Vui lòng báo quản trị viên.',
  SLUG_TAKEN: 'Mã bài tập (slug) đã tồn tại.',
  EXERCISE_HAS_SESSIONS: 'Bài tập đã có lượt tập nên không xoá được; hãy chuyển sang lưu trữ (ẩn).',
  ATTESTATION_REQUIRED: 'Cần xác nhận người trong video mẫu là người lớn đã đồng ý.',
  SOURCE_SUBJECT_NOT_ALLOWED: 'Chỉ dùng được video mẫu tải lên từ trang này (không dùng subject khác trên máy phân tích).',
  TEMPLATE_FPS_REQUIRED: 'Không xác định được tốc độ khung hình của video mẫu; hãy nhập fps.',
  TEMPLATE_QUALITY_FAILED: 'Video mẫu chưa đạt yêu cầu chất lượng (xem danh sách kiểm tra).',
  TEMPLATE_NOT_FOR_EXERCISE: 'Phiên bản mẫu không thuộc bài tập này.',
  TEMPLATE_NOT_FOUND: 'Không tìm thấy phiên bản mẫu (có thể đã bị xoá).',
  SOURCE_SUBJECT_NOT_FOUND: 'Không còn dữ liệu video mẫu trên máy phân tích; hãy tải lại video mẫu.',
  EXERCISE_SUBJECT_PROTECTED: 'Dữ liệu này thuộc tính năng bài tập và chỉ quản lý được từ trang Bài tập (Admin).',
  INVALID_CHILD_ID: 'Mã hồ sơ trẻ không hợp lệ.',
  MISSING_CHILD_ID: 'Hãy chọn hồ sơ trẻ trước.',
  MISSING_EXERCISE_ID: 'Hãy chọn bài tập trước.',
  ML_SERVER_ERROR: 'Máy chủ phân tích gặp sự cố khi xử lý video. Vui lòng thử lại sau.',
}

/** Parent/admin text for an exercise API error (falls back to `fallback`). */
export function exerciseApiErrorMessage(error: unknown, fallback: string): string {
  const code = apiErrorCode(error)
  if (code && API_ERROR_MESSAGE[code]) return API_ERROR_MESSAGE[code]
  if (isNetworkError(error)) return 'Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.'
  return fallback
}
