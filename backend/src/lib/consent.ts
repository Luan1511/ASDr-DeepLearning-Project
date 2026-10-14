/**
 * Guardian consent for processing a child's videos (đề cương: "lưu trữ dữ liệu
 * một cách riêng tư (trẻ được che mặt) với sự cho phép của phụ huynh").
 *
 * The statement is rendered from the actual deployment settings so it never
 * promises more privacy than the system really provides.
 */
export const CONSENT_VERSION = '2026-10-05'

export const CONSENT_SCOPES = ['VIDEO_PROCESSING', 'RESEARCH_USE'] as const
export type ConsentScope = (typeof CONSENT_SCOPES)[number]
export const REQUIRED_CONSENT_SCOPES: ConsentScope[] = ['VIDEO_PROCESSING']

/** What the ML server keeps after extraction (reported by its /health). */
export type MlVideoRetention = 'blurred' | 'none' | 'raw' | 'unknown'

export type ConsentStatement = {
  version: string
  title: string
  items: string[]
  optionalScopes: Array<{ scope: ConsentScope; label: string }>
  retention: {
    backendKeepsVideo: boolean
    mlVideoRetention: MlVideoRetention
  }
}

export function buildConsentStatement(retention: ConsentStatement['retention']): ConsentStatement {
  const backendLine = retention.backendKeepsVideo
    ? 'Video gốc được lưu trên máy chủ ứng dụng để phục vụ kiểm tra lại kết quả.'
    : 'Video gốc trên máy chủ ứng dụng được xoá ngay sau khi phân tích thành công; hệ thống chỉ giữ dữ liệu khung xương và kết quả.'

  const mlLine: Record<MlVideoRetention, string> = {
    blurred: 'Trên máy chủ phân tích, chỉ lưu bản video đã làm mờ khuôn mặt của trẻ cùng dữ liệu khung xương.',
    none: 'Máy chủ phân tích không lưu video, chỉ lưu dữ liệu khung xương.',
    raw: 'Máy chủ phân tích có lưu bản sao video gốc để kiểm tra kỹ thuật.',
    unknown:
      'Máy chủ phân tích có thể lưu bản sao video gốc để kiểm tra kỹ thuật (phiên bản máy chủ hiện tại chưa xác nhận việc làm mờ khuôn mặt).',
  }

  return {
    version: CONSENT_VERSION,
    title: 'Đồng ý xử lý video của trẻ',
    items: [
      'Tôi là cha, mẹ hoặc người giám hộ hợp pháp của trẻ và có quyền đồng ý thay cho trẻ.',
      'Video được gửi tới máy chủ phân tích của nhóm nghiên cứu để trích xuất khung xương (skeleton) và chạy mô hình sàng lọc. Kết quả chỉ mang tính tham khảo, không phải chẩn đoán y khoa.',
      backendLine,
      mlLine[retention.mlVideoRetention],
      'Dữ liệu chỉ hiển thị với tài khoản của bạn và quản trị viên hệ thống; không chia sẻ cho bên thứ ba khi chưa có sự đồng ý riêng của bạn.',
      'Bạn có thể thu hồi đồng ý bất cứ lúc nào; sau khi thu hồi, hệ thống không nhận thêm video mới của trẻ.',
    ],
    optionalScopes: [
      {
        scope: 'RESEARCH_USE',
        label:
          'Cho phép nhóm nghiên cứu dùng dữ liệu khung xương của trẻ (không kèm video và tên) để cải thiện mô hình.',
      },
    ],
    retention,
  }
}

export function normalizeMlRetention(value: unknown): MlVideoRetention {
  return value === 'blurred' || value === 'none' || value === 'raw' ? value : 'unknown'
}

// ---------------------------------------------------------------------------
// Giai đoạn 4: exercise practice videos. Kept in its own ConsentRecord version
// namespace ("exercise-…") so the screening consent (CONSENT_VERSION) and older
// code that only knows it stay untouched. New code never revokes one namespace
// from the other; older code's "revoke every active record" also revokes this
// one, which is fail-safe (the parent is simply asked again).
// ---------------------------------------------------------------------------

export const EXERCISE_CONSENT_VERSION = 'exercise-2026-10-07'
export const EXERCISE_CONSENT_PREFIX = 'exercise-'
export const EXERCISE_CONSENT_SCOPES = ['EXERCISE_VIDEO'] as const
export type ExerciseConsentScope = (typeof EXERCISE_CONSENT_SCOPES)[number]

export function isExerciseConsentVersion(version: string): boolean {
  return version.startsWith(EXERCISE_CONSENT_PREFIX)
}

export function buildExerciseConsentStatement(retention: ConsentStatement['retention']): ConsentStatement {
  const mlMayKeepRaw = retention.mlVideoRetention === 'raw' || retention.mlVideoRetention === 'unknown'
  return {
    version: EXERCISE_CONSENT_VERSION,
    title: 'Đồng ý ghi hình khi trẻ tập vận động',
    items: [
      'Tôi là cha, mẹ hoặc người giám hộ hợp pháp của trẻ và có quyền đồng ý thay cho trẻ.',
      'Khi trẻ tập, camera chỉ ghi hình, không ghi âm. Video chỉ được gửi đi khi tôi bấm “Gửi chấm điểm”.',
      'Video được gửi tới máy chủ phân tích của nhóm nghiên cứu chỉ để trích xuất khung xương và so sánh với động tác mẫu. Video bài tập không được dùng cho mô hình sàng lọc.',
      'Sau khi chấm điểm, video gốc trên máy chủ ứng dụng và dữ liệu trên máy chủ phân tích được xoá; hệ thống chỉ giữ điểm luyện tập và nhận xét, không giữ khung xương của trẻ. Nếu chấm lỗi, video được giữ tối đa 24 giờ để thử lại rồi tự xoá.',
      ...(mlMayKeepRaw
        ? ['Trong lúc xử lý (thường vài phút), máy chủ phân tích có thể tạm lưu bản sao video gốc chưa làm mờ khuôn mặt.']
        : []),
      'Điểm bắt chước chỉ để luyện tập và theo dõi tiến bộ, không phải kết quả sàng lọc hay chẩn đoán.',
      'Dữ liệu chỉ hiển thị với tài khoản của bạn và quản trị viên hệ thống; bạn có thể thu hồi đồng ý hoặc xoá từng lượt tập bất cứ lúc nào.',
    ],
    optionalScopes: [],
    retention,
  }
}

// ---------------------------------------------------------------------------
// Parent questionnaires: explicit consent snapshot stored on every response row
// (not a ConsentRecord, so no code path can revoke it as a side effect).
// ---------------------------------------------------------------------------

export const QUESTIONNAIRE_CONSENT_VERSION = 'questionnaire-2026-10-08'

export function buildQuestionnaireConsentStatement(): ConsentStatement {
  return {
    version: QUESTIONNAIRE_CONSENT_VERSION,
    title: 'Đồng ý lưu câu trả lời bảng hỏi của trẻ',
    items: [
      'Tôi là cha, mẹ hoặc người giám hộ hợp pháp của trẻ và có quyền đồng ý thay cho trẻ.',
      'Câu trả lời (Có/Không theo số thứ tự câu), điểm và kết quả được lưu trong hồ sơ của trẻ để theo dõi theo thời gian.',
      'Nếu làm phần hỏi thêm trong ứng dụng, các lựa chọn của bạn và phần mô tả thêm (nếu có) cũng được lưu cùng lần trả lời, chỉ để tính kết quả và để nhân viên y tế xem lại; không ghi tên, địa chỉ hay số điện thoại vào phần mô tả.',
      'Đây là sàng lọc tham khảo, không phải chẩn đoán.',
      'Trong ứng dụng, chỉ tài khoản của bạn xem được câu trả lời; quản trị viên chỉ xem số liệu tổng hợp.',
      'Dữ liệu không dùng cho mô hình sàng lọc bằng video và không chia sẻ cho bên thứ ba.',
      'Bạn có thể xoá từng lần trả lời hoặc toàn bộ hồ sơ của trẻ bất cứ lúc nào.',
    ],
    optionalScopes: [],
    // Not applicable to questionnaires (no video); kept for the shared shape.
    retention: { backendKeepsVideo: false, mlVideoRetention: 'none' },
  }
}
