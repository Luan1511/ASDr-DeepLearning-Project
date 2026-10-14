/**
 * API calls, labels and parent-facing copy for the M-CHAT-R/F parent questionnaire.
 *
 * Two ways to answer: entry by item NUMBER from the official form (MCHAT_MODE=entry),
 * and — once the licensed content file is installed on the server (MCHAT_MODE=inapp) —
 * the 20 items and the automated Follow-Up inside the app. The item, instruction and
 * Follow-Up wording only ever comes from GET /questionnaires/content and the Follow-Up
 * state; it must never be written in this code base (spec §0).
 */
import axios from 'axios'
import { api, apiErrorCode, isNetworkError } from './api'
import type {
  AdminQuestionnaireStatusDto,
  AssistedFollowUpSource,
  ChildQuestionnairesDto,
  FollowUpAnswerInput,
  FollowUpSource,
  FollowUpStateDto,
  FollowUpStatus,
  FollowUpSummaryDto,
  InstrumentDto,
  McHatBand,
  McHatContentDto,
  McHatOutcome,
  QuestionnaireResponseDto,
  QuestionnaireResponseMode,
  QuestionnairesDto,
  Respondent,
} from './questionnaireTypes'
import type { ConsentStatement } from './types'

export const MCHAT_ITEM_COUNT = 20
export const MCHAT_ITEM_NUMBERS: number[] = Array.from({ length: MCHAT_ITEM_COUNT }, (_, i) => i + 1)

/** Used until GET /questionnaires answers (and if it omits a link). */
export const MCHAT_LINKS = {
  officialFormUrl: 'https://www.mchatscreen.com/mchat-rf/translations/',
  a365Url: 'https://a365.vn',
  cdcMilestonesUrl: 'https://www.cdc.gov/act-early/resources/milestone-checklists.html',
} as const

export type QuestionnaireLinks = { officialFormUrl: string; a365Url: string; cdcMilestonesUrl: string }

export function linksOf(instrument: InstrumentDto | null | undefined): QuestionnaireLinks {
  return {
    officialFormUrl: instrument?.officialFormUrl || MCHAT_LINKS.officialFormUrl,
    a365Url: instrument?.a365Url || MCHAT_LINKS.a365Url,
    cdcMilestonesUrl: instrument?.cdcMilestonesUrl || MCHAT_LINKS.cdcMilestonesUrl,
  }
}

// ---------------------------------------------------------------------------
// Normalisation (a backend from before the in-app release omits the new fields)
// ---------------------------------------------------------------------------

type Loose<T> = Partial<T> & Record<string, unknown>

/** `data[key]` when the body wraps the payload in `{ [key]: … }`, else the body itself. */
function unwrap<T>(data: unknown, key: string): T {
  if (data && typeof data === 'object' && key in data) return (data as Record<string, unknown>)[key] as T
  return data as T
}

function normalizeQuestionnaires(raw: Loose<QuestionnairesDto>): QuestionnairesDto {
  const enabled = Boolean(raw.enabled)
  return {
    enabled,
    mode: raw.mode ?? (enabled ? 'entry' : 'off'),
    inApp: {
      available: Boolean(raw.inApp?.available),
      contentVersion: raw.inApp?.contentVersion ?? null,
      followUpAvailable: Boolean(raw.inApp?.followUpAvailable),
    },
    instruments: raw.instruments ?? [],
  }
}

export function normalizeResponse(raw: QuestionnaireResponseDto): QuestionnaireResponseDto {
  const r = raw as Loose<QuestionnaireResponseDto> & QuestionnaireResponseDto
  const f: Partial<FollowUpSummaryDto> = r.followUp ?? {}
  return {
    ...r,
    mode: r.mode ?? 'OFFICIAL_FORM_ENTRY',
    contentVersion: r.contentVersion ?? null,
    followUp: {
      inAppAvailable: Boolean(f.inAppAvailable),
      inAppStarted: Boolean(f.inAppStarted),
      itemsDone: f.itemsDone ?? 0,
      itemsTotal: f.itemsTotal ?? r.failedItems.length,
      needsReview: Boolean(f.needsReview),
      reviewItems: f.reviewItems ?? [],
      itemScores: f.itemScores ?? [],
    },
  }
}

function normalizeFollowUpState(raw: FollowUpStateDto): FollowUpStateDto {
  // Per-item scores are only meaningful (and only sent) once the Follow-Up is COMPLETED.
  const items =
    raw.status === 'COMPLETED' ? raw.items : raw.items.map((i) => ({ ...i, score: null, needsReview: false }))
  return { ...raw, items, ...(raw.response ? { response: normalizeResponse(raw.response) } : {}) }
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

export async function fetchQuestionnaires(): Promise<QuestionnairesDto> {
  return normalizeQuestionnaires((await api.get('/questionnaires')).data)
}

export async function fetchQuestionnaireConsentStatement(): Promise<ConsentStatement> {
  return (await api.get('/questionnaires/consent-statement')).data.statement
}

/** Licensed text for the in-app questionnaire (503 QUESTIONNAIRE_CONTENT_UNAVAILABLE when not installed). */
export async function fetchMchatContent(): Promise<McHatContentDto> {
  return unwrap<McHatContentDto>((await api.get('/questionnaires/content')).data, 'content')
}

export async function fetchChildQuestionnaires(childId: string): Promise<ChildQuestionnairesDto> {
  const data: ChildQuestionnairesDto = (await api.get(`/children/${childId}/questionnaires`)).data
  return { ...data, responses: data.responses.map(normalizeResponse) }
}

/** item number → true ("Có") / false ("Không"). */
export type McHatAnswers = Partial<Record<number, boolean>>

export async function submitMchatResponse(
  childId: string,
  input: {
    respondent: Respondent
    answers: Record<number, boolean>
    consentVersion: string
    mode?: QuestionnaireResponseMode
  },
): Promise<QuestionnaireResponseDto> {
  const answers: Record<string, boolean> = {}
  for (const n of MCHAT_ITEM_NUMBERS) answers[String(n)] = input.answers[n]
  const res = await api.post(`/children/${childId}/questionnaires`, {
    instrument: 'MCHAT_RF',
    respondent: input.respondent,
    answers,
    consentAccepted: true,
    consentVersion: input.consentVersion,
    ...(input.mode ? { mode: input.mode } : {}),
  })
  return normalizeResponse(res.data.response)
}

export async function fetchQuestionnaireResponse(id: string): Promise<QuestionnaireResponseDto> {
  return normalizeResponse((await api.get(`/questionnaire-responses/${id}`)).data.response)
}

/** Records an assisted Follow-Up (replaces any partial in-app answers). */
export async function submitFollowUp(
  id: string,
  input: { source: AssistedFollowUpSource; stillFailingItems: number[] },
): Promise<QuestionnaireResponseDto> {
  return normalizeResponse((await api.post(`/questionnaire-responses/${id}/follow-up`, input)).data.response)
}

export async function fetchFollowUpState(id: string): Promise<FollowUpStateDto> {
  return normalizeFollowUpState(unwrap((await api.get(`/questionnaire-responses/${id}/follow-up`)).data, 'state'))
}

export async function answerFollowUp(id: string, input: FollowUpAnswerInput): Promise<FollowUpStateDto> {
  return normalizeFollowUpState(
    unwrap((await api.post(`/questionnaire-responses/${id}/follow-up/answer`, input)).data, 'state'),
  )
}

export async function followUpBack(id: string): Promise<FollowUpStateDto> {
  return normalizeFollowUpState(unwrap((await api.post(`/questionnaire-responses/${id}/follow-up/back`)).data, 'state'))
}

export async function deleteQuestionnaireResponse(id: string): Promise<{ deleted: boolean }> {
  return (await api.delete(`/questionnaire-responses/${id}`)).data
}

export async function fetchAdminQuestionnaireStatus(): Promise<AdminQuestionnaireStatusDto> {
  return unwrap<AdminQuestionnaireStatusDto>((await api.get('/admin/questionnaires/status')).data, 'status')
}

/**
 * Why the questionnaire feature cannot be used right now, if that is what `error` says:
 * switched off (MCHAT_MODE=off), DB not migrated, or a backend without these routes
 * (plain 404 without an error code).
 */
export function questionnaireUnavailableReason(error: unknown): 'disabled' | 'migration' | 'absent' | null {
  const code = apiErrorCode(error)
  if (code === 'QUESTIONNAIRE_DISABLED') return 'disabled'
  if (code === 'DATABASE_MIGRATION_REQUIRED') return 'migration'
  if (!code && axios.isAxiosError(error) && error.response?.status === 404) return 'absent'
  return null
}

/** Extra fields of an error body (e.g. `missing` of INCOMPLETE_ANSWERS). */
export function apiErrorBody(error: unknown): Record<string, unknown> {
  if (!axios.isAxiosError(error)) return {}
  const data = error.response?.data
  return data && typeof data === 'object' ? (data as Record<string, unknown>) : {}
}

/** Item numbers listed by a 400 INCOMPLETE_ANSWERS response. */
export function missingItemsOf(error: unknown): number[] {
  const body = apiErrorBody(error)
  const details = body.details as { missing?: unknown } | undefined
  const raw = Array.isArray(body.missing) ? body.missing : Array.isArray(details?.missing) ? details.missing : []
  return raw.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= MCHAT_ITEM_COUNT)
}

// ---------------------------------------------------------------------------
// Copy (spec §6.2). Banned outside the disclaimer: diagnostic words and percentages.
// ---------------------------------------------------------------------------

export const QUESTIONNAIRE_TITLE = 'Bảng hỏi sàng lọc M-CHAT-R/F (16–30 tháng tuổi)'
export const QUESTIONNAIRE_RESULT_HEADER = 'Kết quả sàng lọc bằng bảng hỏi'

export const ENTRY_INSTRUCTIONS =
  'Mở bản M-CHAT-R/F tiếng Việt chính thức trên mchatscreen.com, đọc từng câu và chọn Có/Không trên phiếu. Sau đó nhập đúng câu trả lời theo số thứ tự câu bên dưới để hệ thống tính điểm. AIMBRACE không hiển thị nội dung câu hỏi.'
export const ENTRY_HELP = 'Ứng dụng tự tính điểm — bạn không cần biết câu nào được tính điểm.'

export const INAPP_INTRO =
  'Bạn sẽ trả lời 20 câu, mỗi màn hình một câu, bằng cách chọn Có hoặc Không. Bạn có thể quay lại câu trước và xem lại toàn bộ câu trả lời trước khi gửi. Ứng dụng tự tính điểm.'
export const INAPP_KEYBOARD_HINT = 'Phím tắt: C = Có, K = Không, ← câu trước, → câu sau (khi đã trả lời).'
export const PAPER_ENTRY_LINK = 'Nhập theo phiếu giấy'
export const PAPER_ENTRY_HINT = 'Dành cho trường hợp bạn đã điền phiếu M-CHAT-R/F chính thức trên giấy.'
export const INAPP_LINK = 'Trả lời trực tiếp trong ứng dụng'
export const CONTENT_UNAVAILABLE_NOTE =
  'Nội dung bảng hỏi trong ứng dụng hiện chưa sẵn sàng, nên trang này dùng cách nhập theo phiếu giấy chính thức.'

export const COPYRIGHT_TEXT = 'M-CHAT-R/F™ © 2009 Diana Robins, Deborah Fein, & Marianne Barton.'
export const COPYRIGHT_DOWNLOAD_TEXT = 'Tải bản tiếng Việt chính thức tại'

/** The content file's credit line (translation/licence) of a content or Follow-Up state payload. */
export function contentNoticeOf(
  source: { copyrightNotice?: string | null; contentCopyrightNotice?: string | null } | null | undefined,
): string | null {
  return source?.contentCopyrightNotice ?? source?.copyrightNotice ?? null
}

const normalizeNotice = (text: string) =>
  text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[\s.]+$/, '')
    .trim()

/** `notice` when it adds something to the official copyright line, else null. */
export function extraCopyrightNotice(notice: string | null | undefined): string | null {
  const text = notice?.trim()
  if (!text) return null
  const n = normalizeNotice(text)
  const official = normalizeNotice(COPYRIGHT_TEXT)
  if (n === official || n === normalizeNotice(`${COPYRIGHT_TEXT} ${COPYRIGHT_DOWNLOAD_TEXT} mchatscreen.com`)) return null
  return text
}

export const QUESTIONNAIRE_DISCLAIMER =
  'Đây là kết quả sàng lọc bằng bảng hỏi, không phải chẩn đoán. Chỉ bác sĩ hoặc chuyên gia được đào tạo (nhi khoa phát triển, tâm bệnh nhi, phục hồi chức năng) mới có thể đánh giá và kết luận. Bảng hỏi được thiết kế để hạn chế bỏ sót, nên nhiều trẻ có kết quả cần theo dõi thêm nhưng sau đó không được chẩn đoán; kết quả khả năng thấp cũng không loại trừ hoàn toàn — nếu bạn còn lo lắng, hãy trao đổi với bác sĩ.'

export const QUESTIONNAIRE_DISABLED_MESSAGE =
  'Bảng hỏi M-CHAT-R/F đang chờ tác giả cho phép sử dụng trong ứng dụng nên chưa mở.'
export const QUESTIONNAIRE_MIGRATION_MESSAGE =
  'Máy chủ chưa được cập nhật cơ sở dữ liệu cho tính năng bảng hỏi. Vui lòng báo quản trị viên.'
export const QUESTIONNAIRE_DASHBOARD_NOTE =
  'Kết quả bảng hỏi và kết quả sàng lọc video là hai nguồn thông tin riêng, không gộp thành một điểm.'

export const DRAFT_NOTE =
  'Câu trả lời đang nhập chỉ được lưu tạm trên tab trình duyệt này (tự xoá khi đóng tab) cho đến khi bạn bấm gửi.'

/** "28/06/2026" from a YYYY-MM-DD calendar date (or an ISO timestamp at UTC midnight). */
export function formatCalendarDate(value: string) {
  const [y, m, d] = value.slice(0, 10).split('-')
  return y && m && d ? `${d}/${m}/${y}` : value
}

export function tooYoungMessage(ageMonths: number, eligibleFrom: string) {
  return `M-CHAT-R/F dành cho trẻ từ 16 đến 30 tháng tuổi. Con hiện ${Math.max(0, ageMonths)} tháng — bạn có thể làm từ ngày ${formatCalendarDate(eligibleFrom)}. Trong lúc chờ, hãy theo dõi các mốc phát triển của con (bảng kiểm của CDC có bản tiếng Việt) và hỏi bác sĩ nhi nếu có băn khoăn.`
}

export function tooOldMessage(ageMonths: number) {
  return `Con đã ${ageMonths} tháng, ngoài độ tuổi của M-CHAT-R/F (16–30 tháng). Hiện AIMBRACE chưa có bảng hỏi được cấp phép cho độ tuổi này. Bạn có thể theo dõi các mốc phát triển của con và trao đổi với bác sĩ nếu có điều lo lắng.`
}

export const BAND_LABEL: Record<McHatBand, string> = {
  LOW: 'Khả năng thấp',
  MODERATE: 'Khả năng trung bình',
  HIGH: 'Khả năng cao',
}

/** Short history-list label; the full next steps come from the backend (`actions`). */
export const OUTCOME_SHORT_LABEL: Record<McHatOutcome, string> = {
  SCREEN_NEGATIVE: 'Tiếp tục theo dõi các mốc phát triển',
  FOLLOW_UP_NEEDED: 'Cần làm phần hỏi thêm',
  REFER: 'Nên đưa con đi đánh giá',
}

export const RESPONDENT_LABEL: Record<Respondent, string> = {
  MOTHER: 'Mẹ',
  FATHER: 'Bố',
  GUARDIAN: 'Người giám hộ',
  OTHER_CAREGIVER: 'Người chăm sóc khác',
}
export const RESPONDENTS: Respondent[] = ['MOTHER', 'FATHER', 'GUARDIAN', 'OTHER_CAREGIVER']

export const FOLLOW_UP_SOURCE_LABEL: Record<FollowUpSource, string> = {
  HEALTH_WORKER: 'Cùng nhân viên y tế (trạm y tế, bác sĩ nhi)',
  A365: 'Trên ứng dụng a365',
  OTHER: 'Cách khác',
  IN_APP: 'Phụ huynh tự làm trong AIMBRACE',
}
/** Choices of the assisted Follow-Up form (IN_APP is set by the server only). */
export const FOLLOW_UP_SOURCES: AssistedFollowUpSource[] = ['HEALTH_WORKER', 'A365', 'OTHER']

export const FOLLOW_UP_STATUS_LABEL: Record<FollowUpStatus, string> = {
  NOT_NEEDED: 'Không cần phần hỏi thêm',
  PENDING: 'Đang chờ phần hỏi thêm',
  COMPLETED: 'Đã làm phần hỏi thêm',
  NOT_APPLICABLE: 'Không áp dụng phần hỏi thêm',
}

export const RESPONSE_MODE_LABEL: Record<QuestionnaireResponseMode, string> = {
  IN_APP: 'Trả lời trong ứng dụng',
  OFFICIAL_FORM_ENTRY: 'Nhập theo phiếu giấy chính thức',
}

export const ANSWER_LABEL = { yes: 'Có', no: 'Không' } as const

/** "M-CHAT-R/F · cách tính điểm mchat-rf-scoring-v1" */
export function instrumentVersionLine(r: Pick<QuestionnaireResponseDto, 'scoringVersion'>) {
  return `M-CHAT-R/F · cách tính điểm ${r.scoringVersion}`
}

// ---------------------------------------------------------------------------
// Result states (mchat_admin.md §4.2) — never the per-item scoring to parents
// ---------------------------------------------------------------------------

export type ResultState = 'PENDING' | 'LOW' | 'LOW_AFTER_FOLLOW_UP' | 'HIGH'

export function resultStateOf(r: Pick<QuestionnaireResponseDto, 'outcome' | 'followUpStatus'>): ResultState {
  if (r.outcome === 'REFER') return 'HIGH'
  if (r.outcome === 'FOLLOW_UP_NEEDED' || r.followUpStatus === 'PENDING') return 'PENDING'
  if (r.followUpStatus === 'COMPLETED') return 'LOW_AFTER_FOLLOW_UP'
  return 'LOW'
}

export const RESULT_STATE_LABEL: Record<ResultState, string> = {
  PENDING: 'Chưa hoàn tất – khả năng trung bình',
  LOW: 'Khả năng thấp',
  LOW_AFTER_FOLLOW_UP: 'Khả năng thấp sau phần hỏi thêm',
  HIGH: 'Khả năng cao – nên đánh giá phát triển sớm',
}

export const RESULT_STATE_TEXT: Record<ResultState, string> = {
  PENDING:
    'Đây chưa phải kết quả cuối cùng. Bước tiếp theo là phần hỏi thêm (Follow-Up) cho một số câu; kết quả chỉ hoàn tất sau phần này.',
  LOW: 'Bảng hỏi lần này chưa thấy điều cần chú ý thêm. Kết quả này không loại trừ mọi khả năng — hãy tiếp tục theo dõi các mốc phát triển của con.',
  LOW_AFTER_FOLLOW_UP:
    'Sau phần hỏi thêm, kết quả ở mức khả năng thấp. Hãy tiếp tục theo dõi các mốc phát triển và làm lại bảng hỏi ở các lần khám định kỳ.',
  HIGH: 'Bạn nên sớm đưa con đi đánh giá phát triển, không cần chờ. Nhiều trẻ có kết quả này vẫn được lợi từ hỗ trợ phát triển, và can thiệp sớm có thể bắt đầu trước khi có kết luận của chuyên gia.',
}

/** The official refer-on-concern rule: shown with every result. */
export const REFER_ON_CONCERN =
  'Dù kết quả thế nào: nếu bạn hoặc bác sĩ lo lắng về sự phát triển của con, hoặc con mất đi kỹ năng đã có, hãy đưa con đi khám — không cần chờ điểm số.'

export const NEEDS_REVIEW_NOTE =
  'Một vài câu trả lời có phần mô tả thêm của bạn mà ứng dụng không tự đánh giá được. Hãy mang bản tóm tắt này khi gặp nhân viên y tế để họ xem lại cùng bạn.'

export function rescreenLine(rescreenAfter: string) {
  return `Hẹn làm lại bảng hỏi sau sinh nhật 2 tuổi của con: từ ngày ${formatCalendarDate(rescreenAfter)}.`
}

/** Where to go, by facility TYPE (no names or phone numbers: those go stale). */
export const REFERRAL_GUIDE: Array<{ title: string; body: string }> = [
  {
    title: 'Bước đầu: trạm y tế xã/phường, bác sĩ gia đình hoặc phòng khám nhi',
    body: 'Mang theo “Tóm tắt cho bác sĩ” bên dưới. Bạn có thể đưa kết quả này vào lần khám sức khỏe định kỳ của con và xin giới thiệu lên tuyến trên.',
  },
  {
    title: 'Đánh giá phát triển: bệnh viện tuyến tỉnh trở lên',
    body: 'Nơi có khoa phục hồi chức năng, tâm bệnh nhi hoặc tâm lý lâm sàng nhi. Nên kiểm tra thính lực của con trong cùng đợt khám.',
  },
  {
    title: 'Can thiệp sớm: Trung tâm hỗ trợ phát triển giáo dục hòa nhập',
    body: 'Trung tâm công lập thuộc Sở Giáo dục và Đào tạo tỉnh/thành phố, có thể đánh giá và lập kế hoạch can thiệp sớm. Nếu chọn trung tâm tư nhân, hãy hỏi giấy phép hoạt động và chuyên môn của nhân viên.',
  },
  {
    title: 'Hỗ trợ tại nhà trong lúc chờ: a365.vn',
    body: 'Trang a365.vn có tài liệu và hoạt động dành cho phụ huynh trong lúc chờ đến lượt khám.',
  },
]

// ---------------------------------------------------------------------------
// In-app Follow-Up copy (the Follow-Up wording itself comes from the server)
// ---------------------------------------------------------------------------

export const FOLLOW_UP_TITLE = 'Phần hỏi thêm (Follow-Up)'
export const FOLLOW_UP_WHY =
  'Một số câu trả lời ở phần đầu cần được hỏi rõ hơn. Phần hỏi thêm chỉ hỏi về những câu đó, để kết quả sàng lọc sát hơn với con.'
export const FOLLOW_UP_DURATION = 'Thường mất khoảng 5–10 phút.'
export const FOLLOW_UP_RESUME =
  'Bạn có thể dừng bất cứ lúc nào: mỗi câu trả lời được lưu ngay, lần sau mở lại sẽ tiếp tục từ chỗ đang làm.'
export const FOLLOW_UP_ASSISTED =
  'Bạn cũng có thể làm phần này cùng nhân viên y tế (trạm y tế, bác sĩ nhi) rồi ghi kết quả vào AIMBRACE.'
export const FOLLOW_UP_ASSISTED_LINK = 'Làm cùng nhân viên y tế'
export const FOLLOW_UP_IN_PROGRESS = 'Đang làm dở'
export const OTHER_TEXT_PRIVACY_NOTE = 'Không ghi tên, địa chỉ hay số điện thoại.'

export function followUpActionLabel(started: boolean) {
  return started ? 'Tiếp tục phần hỏi thêm' : 'Làm phần hỏi thêm'
}

export const followUpPath = (responseId: string) => `/questionnaire-responses/${responseId}/follow-up`
export const resultPath = (responseId: string) => `/questionnaire-responses/${responseId}`
/** Anchor of the assisted Follow-Up form on the result page. */
export const ASSISTED_ANCHOR = 'lam-cung-nhan-vien-y-te'

/** A pending MODERATE response whose Follow-Up can be taken in the app now. */
export function canTakeFollowUpInApp(r: QuestionnaireResponseDto) {
  return r.band === 'MODERATE' && r.followUpStatus === 'PENDING' && r.followUp.inAppAvailable
}

// ---------------------------------------------------------------------------
// Touch targets of the questionnaire screens (≥ 48 px; the global .btn-duo* stay unchanged)
// ---------------------------------------------------------------------------

/** Add to a .btn-duo / .btn-duo-secondary / .btn-duo-ghost used for navigation on questionnaire screens. */
export const Q_NAV_BUTTON = 'min-h-12'
/** Text-only links/buttons on questionnaire screens. */
export const Q_TEXT_LINK = 'inline-flex min-h-12 items-center gap-1.5 px-2'

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export const CONTENT_UNAVAILABLE_MESSAGE =
  'Nội dung bảng hỏi trong ứng dụng hiện chưa sẵn sàng. Bạn vẫn có thể nhập câu trả lời theo phiếu giấy hoặc làm phần hỏi thêm cùng nhân viên y tế.'
export const STEP_MISMATCH_MESSAGE =
  'Tiến độ phần hỏi thêm vừa thay đổi (có thể từ một tab hoặc thiết bị khác). Trang đã được cập nhật — vui lòng trả lời câu đang hiện.'

const API_ERROR_MESSAGE: Record<string, string> = {
  QUESTIONNAIRE_DISABLED: QUESTIONNAIRE_DISABLED_MESSAGE,
  QUESTIONNAIRE_CONTENT_UNAVAILABLE: CONTENT_UNAVAILABLE_MESSAGE,
  DATABASE_MIGRATION_REQUIRED: QUESTIONNAIRE_MIGRATION_MESSAGE,
  AGE_OUT_OF_RANGE: 'Tuổi của con hiện nằm ngoài khoảng 16–30 tháng của M-CHAT-R/F nên chưa gửi được.',
  INCOMPLETE_ANSWERS: 'Còn câu chưa có câu trả lời. Các câu còn thiếu được đánh dấu bên dưới.',
  VALIDATION_ERROR: 'Thông tin gửi lên chưa hợp lệ. Vui lòng kiểm tra lại người trả lời và các câu trả lời.',
  CONSENT_REQUIRED: 'Cần xác nhận đồng ý lưu câu trả lời trước khi gửi.',
  CONSENT_VERSION_OUTDATED: 'Nội dung đồng ý vừa được cập nhật. Vui lòng đọc lại và xác nhận trước khi gửi.',
  CHILD_NOT_FOUND: 'Không tìm thấy hồ sơ trẻ (có thể đã bị xoá).',
  RESPONSE_NOT_FOUND: 'Không tìm thấy lần trả lời này (có thể đã bị xoá).',
  FOLLOW_UP_NOT_APPLICABLE: 'Lần trả lời này không cần (hoặc đã ghi) phần hỏi thêm.',
  FOLLOW_UP_ITEMS_INVALID: 'Chỉ chọn được các câu số được liệt kê cho phần hỏi thêm, mỗi câu một lần.',
  STEP_MISMATCH: STEP_MISMATCH_MESSAGE,
  NOTHING_TO_UNDO: 'Không còn câu trả lời nào để quay lại.',
}

/** Parent-facing text for a questionnaire API error (falls back to `fallback`). */
export function questionnaireApiErrorMessage(error: unknown, fallback: string): string {
  const code = apiErrorCode(error)
  if (code && API_ERROR_MESSAGE[code]) return API_ERROR_MESSAGE[code]
  if (isNetworkError(error)) return 'Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.'
  return fallback
}

// ---------------------------------------------------------------------------
// Local drafts: sessionStorage only (never localStorage, never the server)
// ---------------------------------------------------------------------------

export type McHatDraft = { respondent: Respondent | null; answers: McHatAnswers }

const draftKey = (childId: string) => `aimbrace.mchat-draft.${childId}`
const inAppDraftKey = (childId: string) => `aimbrace.mchat-inapp-draft.${childId}`

function parseDraft(parsed: { respondent?: unknown; answers?: unknown }): McHatDraft {
  const respondent = RESPONDENTS.includes(parsed.respondent as Respondent) ? (parsed.respondent as Respondent) : null
  const answers: McHatAnswers = {}
  if (parsed.answers && typeof parsed.answers === 'object') {
    for (const n of MCHAT_ITEM_NUMBERS) {
      const v = (parsed.answers as Record<string, unknown>)[String(n)]
      if (typeof v === 'boolean') answers[n] = v
    }
  }
  return { respondent, answers }
}

function readStorage(key: string): Record<string, unknown> | null {
  try {
    const raw = window.sessionStorage.getItem(key)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function writeStorage(key: string, value: unknown) {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage full or disabled: the draft simply is not kept.
  }
}

function removeStorage(key: string) {
  try {
    window.sessionStorage.removeItem(key)
  } catch {
    // ignore
  }
}

export function loadMchatDraft(childId: string): McHatDraft {
  const parsed = readStorage(draftKey(childId))
  return parsed ? parseDraft(parsed) : { respondent: null, answers: {} }
}

export function saveMchatDraft(childId: string, draft: McHatDraft) {
  writeStorage(draftKey(childId), draft)
}

export function clearMchatDraft(childId: string) {
  removeStorage(draftKey(childId))
}

/** In-app draft: also remembers the item on screen; dropped when the content version changed. */
export type McHatInAppDraft = McHatDraft & { contentVersion: string; index: number }

export function loadInAppDraft(childId: string, contentVersion: string): McHatInAppDraft {
  const parsed = readStorage(inAppDraftKey(childId))
  if (!parsed || parsed.contentVersion !== contentVersion) {
    return { respondent: null, answers: {}, contentVersion, index: 0 }
  }
  const index = typeof parsed.index === 'number' && Number.isInteger(parsed.index) ? parsed.index : 0
  return { ...parseDraft(parsed), contentVersion, index: Math.min(Math.max(index, 0), MCHAT_ITEM_COUNT - 1) }
}

export function saveInAppDraft(childId: string, draft: McHatInAppDraft) {
  writeStorage(inAppDraftKey(childId), draft)
}

export function clearInAppDraft(childId: string) {
  removeStorage(inAppDraftKey(childId))
}

/** DOM id of an answer row (used to scroll to the first missing item). */
export const mchatItemElementId = (n: number) => `mchat-item-${n}`

export function missingItems(answers: McHatAnswers): number[] {
  return MCHAT_ITEM_NUMBERS.filter((n) => typeof answers[n] !== 'boolean')
}
