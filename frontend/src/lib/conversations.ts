import { apiErrorCode } from './api'
export type DirectMessage = { id: string; seq: number; senderId: string; clientRequestId: string; content: string | null; hidden: boolean; createdAt: string }
export type Conversation = { id: string; status: string; inviterId: string; isInviter: boolean; blockedByMe: boolean; peer: { id: string; displayName: string }; unavailable: boolean; unread: number; lastMessage: DirectMessage | null; sourcePost: { id: string; title: string } | null; updatedAt: string }
export function conversationError(error: unknown) {
  const code = apiErrorCode(error)
  return ({ CHAT_UNAVAILABLE: 'Không thể trò chuyện với tài khoản này lúc này.', INVITATION_CLOSED: 'Lời mời đã đóng. Người nhận có thể chủ động kết nối lại.', INVITATION_REQUIRED: 'Cần chấp nhận lời mời trước khi trò chuyện.', INVITATION_RATE_LIMIT: 'Bạn đã gửi đủ 10 lời mời trong 24 giờ. Vui lòng thử lại sau.', MESSAGE_RATE_LIMIT: 'Bạn gửi tin quá nhanh. Vui lòng đợi một phút rồi thử lại.', ALREADY_REPORTED: 'Tin này đã có báo cáo đang chờ xử lý.', POST_NOT_FOUND: 'Không thể nhắn riêng từ bài viết này.', CONVERSATION_NOT_FOUND: 'Không tìm thấy cuộc trò chuyện.' } as Record<string, string>)[code ?? ''] ?? 'Không kết nối được hộp thư. Vui lòng thử lại.'
}
