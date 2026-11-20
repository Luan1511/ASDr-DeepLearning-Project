import { z } from 'zod'
import { env } from '../lib/env'

const sourceSchema = z.object({
  id: z.string(),
  citation_id: z.number().int().positive().optional(),
  title: z.string(),
  url: z.string().nullable().refine((url) => !url || /^https?:\/\//i.test(url)),
  quotes: z.array(z.string()).default([]),
  usage: z.enum(['cited', 'retrieved']).optional(),
})
const resultSchema = z.object({
  answer: z.string().trim().min(1),
  sources: z.array(sourceSchema).max(30),
})
export class ChatServiceError extends Error {
  constructor(public status: number, message: string, public code = 'CHAT_SERVICE_UNAVAILABLE') { super(message) }
}
const upstreamErrors: Record<string, { status: number; message: string }> = {
  CHAT_CITATION_ERROR: { status: 503, message: 'Trợ lý chưa đối chiếu được nguồn cho câu trả lời. Bạn thử gửi lại nhé.' },
  CHAT_LANGUAGE_ERROR: { status: 503, message: 'Trợ lý chưa tạo được câu trả lời tiếng Việt hoàn chỉnh. Bạn thử gửi lại nhé.' },
  CHAT_MODEL_OUTPUT_ERROR: { status: 503, message: 'Trợ lý chưa hoàn tất câu trả lời. Bạn thử gửi lại nhé.' },
  CHAT_TIMEOUT: { status: 503, message: 'Trợ lý đang trả lời lâu hơn dự kiến. Bạn đợi một chút rồi thử lại nhé.' },
  CHAT_UPSTREAM_ERROR: { status: 503, message: 'Dịch vụ AI tạm thời gặp sự cố. Bạn vui lòng thử lại sau.' },
  CHAT_INTERNAL_ERROR: { status: 503, message: 'Trợ lý gặp lỗi xử lý. Bạn vui lòng thử lại sau.' },
}
export async function answerRag(message: string, history: { role: 'user' | 'assistant'; content: string }[]) {
  if (!env.CHAT_API_BASE_URL || !env.CHAT_API_KEY) {
    throw new ChatServiceError(503, 'Trợ lý đang được cấu hình. Bạn vui lòng thử lại sau.')
  }
  try {
    const response = await fetch(env.CHAT_API_BASE_URL.replace(/\/$/, '') + '/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': env.CHAT_API_KEY },
      body: JSON.stringify({ question: message, history }),
      signal: AbortSignal.timeout(180_000),
    })
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { detail?: { code?: unknown } } | null
      const code = typeof payload?.detail?.code === 'string' && Object.prototype.hasOwnProperty.call(upstreamErrors, payload.detail.code)
        ? payload.detail.code : response.status === 429 ? 'CHAT_BUSY' : 'CHAT_SERVICE_UNAVAILABLE'
      const known = upstreamErrors[code]
      // Log only whitelisted codes and a bounded server-generated request ID.
      const requestId = response.headers.get('x-request-id') ?? ''
      console.warn('[chat-rag] failed', { code, status: response.status, requestId: /^[a-f0-9]{32}$/.test(requestId) ? requestId : undefined })
      throw new ChatServiceError(known?.status ?? (response.status === 429 ? 429 : 503),
        known?.message ?? (response.status === 429 ? 'Trợ lý đang bận. Bạn đợi một chút rồi gửi lại nhé.' : 'Trợ lý tạm thời chưa phản hồi được. Bạn vui lòng thử lại.'), code)
    }
    const parsed = resultSchema.safeParse(await response.json())
    if (!parsed.success) throw new ChatServiceError(503, 'Phản hồi của trợ lý chưa hoàn chỉnh. Bạn vui lòng thử lại.', 'CHAT_MODEL_OUTPUT_ERROR')
    // Source metadata comes from actual retrieval, not citation markers in prose.
    const reply = parsed.data.answer.replace(/\[\s*\d+\s*\]/g, '').trim()
    return { reply, sources: parsed.data.sources }
  } catch (error) {
    if (error instanceof ChatServiceError) throw error
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new ChatServiceError(503, upstreamErrors.CHAT_TIMEOUT.message, 'CHAT_TIMEOUT')
    }
    throw new ChatServiceError(503, 'Kết nối tới trợ lý đang gián đoạn. Bạn vui lòng thử lại.')
  }
}
