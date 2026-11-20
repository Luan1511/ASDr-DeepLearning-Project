import axios from 'axios'

const messages: Record<string, string> = {
  CHAT_LANGUAGE_ERROR: 'Trợ lý chưa tạo được câu trả lời tiếng Việt hoàn chỉnh. Bạn thử gửi lại nhé.',
  CHAT_CITATION_ERROR: 'Trợ lý chưa đối chiếu được nguồn cho câu trả lời. Bạn thử gửi lại nhé.',
  CHAT_MODEL_OUTPUT_ERROR: 'Trợ lý chưa hoàn tất câu trả lời. Bạn thử gửi lại nhé.',
  CHAT_TIMEOUT: 'Trợ lý đang trả lời lâu hơn dự kiến. Bạn đợi một chút rồi thử lại nhé.',
  CHAT_BUSY: 'Trợ lý đang bận. Bạn đợi một chút rồi gửi lại nhé.',
  CHAT_UPSTREAM_ERROR: 'Dịch vụ AI tạm thời gặp sự cố. Bạn vui lòng thử lại sau.',
  CHAT_INTERNAL_ERROR: 'Trợ lý gặp lỗi xử lý. Bạn vui lòng thử lại sau.',
  CHAT_SERVICE_UNAVAILABLE: 'Trợ lý tạm thời chưa sẵn sàng. Bạn vui lòng thử lại sau.',
}

/** Proxy HTML/text and arbitrary upstream messages must not become chat copy. */
export function chatErrorMessage(error: unknown): string {
  if (!axios.isAxiosError(error)) return 'Chưa kết nối được trợ lý. Bạn vui lòng thử lại.'
  const status = error.response?.status
  if (status === 401) return 'Phiên đăng nhập đã hết hạn. Bạn đăng nhập lại nhé.'
  if (status === 404) return 'Không tìm thấy cuộc trò chuyện. Bạn thử tải lại hoặc tạo chat mới nhé.'
  if (status === 409) return 'Cuộc trò chuyện vừa có tin nhắn mới. Bạn tải lại hội thoại rồi gửi tiếp nhé.'
  const data = error.response?.data as { error?: unknown } | undefined
  const code = typeof data?.error === 'string' ? data.error : ''
  if (Object.prototype.hasOwnProperty.call(messages, code)) return messages[code]
  if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT' || status === 504 || status === 524) return messages.CHAT_TIMEOUT
  if (status === 429) return messages.CHAT_BUSY
  if (status === 400) return 'Nội dung gửi chưa hợp lệ. Bạn kiểm tra câu hỏi rồi thử lại nhé.'
  if (status && status >= 500) return 'Kết nối tới trợ lý đang gặp sự cố. Bạn đợi một chút rồi gửi lại nhé.'
  return 'Chưa kết nối được trợ lý. Bạn vui lòng thử lại.'
}
