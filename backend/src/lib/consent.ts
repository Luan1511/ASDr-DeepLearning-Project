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
