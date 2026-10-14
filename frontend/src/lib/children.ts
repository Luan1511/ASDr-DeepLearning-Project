import { apiErrorCode, isNetworkError } from './api'

/** Parent-facing text for errors of the child-profile and data-deletion endpoints. */
export function childApiErrorMessage(error: unknown, fallback: string): string {
  const code = apiErrorCode(error)
  if (code === 'INVALID_DATE_OF_BIRTH') return 'Ngày sinh không hợp lệ (không được sau hôm nay hoặc trước năm 1900).'
  if (code === 'VALIDATION_ERROR') return 'Thông tin chưa hợp lệ: họ tên 1–100 ký tự, ghi chú tối đa 1000 ký tự.'
  if (code === 'CHILD_NOT_FOUND' || code === 'NOT_FOUND') return 'Không tìm thấy dữ liệu (có thể đã bị xoá).'
  if (code === 'SCREENING_IN_PROGRESS') {
    return 'Đang có video của trẻ được phân tích. Vui lòng đợi phân tích xong (thường vài phút) rồi xoá lại.'
  }
  if (code === 'EXERCISE_IN_PROGRESS') {
    return 'Đang có bài tập của trẻ được chấm điểm. Vui lòng đợi xong (thường dưới vài phút) rồi xoá lại.'
  }
  if (code === 'ML_UNAVAILABLE') {
    return 'Chưa kết nối được máy chủ phân tích để xoá dữ liệu khung xương trên đó. Dữ liệu vẫn được giữ nguyên; vui lòng thử lại sau.'
  }
  if (isNetworkError(error)) return 'Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.'
  return fallback
}
