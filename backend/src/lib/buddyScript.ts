/**
 * Control script of "bạn Bin", the 2D companion that chats with a child by text:
 * what Bin says and which expression / gesture / ear motion goes with each
 * sentence. The LLM's answer is re-validated here; unknown names fall back to
 * safe defaults so the frontend only ever receives values its animation library
 * knows. Kept free of env/IO so it can be unit-tested.
 */
import { z } from 'zod'

export const BUDDY_NAME = 'Bin'

export const BUDDY_EXPRESSIONS = [
  'neutral',
  'happy',
  'curious',
  'encourage',
  'surprised',
  'listening',
  'thinking',
  'sad',
  'proud',
] as const
export const BUDDY_GESTURES = [
  'none',
  'wave',
  'cheer',
  'clap',
  'thumbs_up',
  'think',
  'nod',
  'shake_head',
  'shrug',
  'peace',
  'ok',
  'point',
  'hug',
  'dance',
  'listen',
] as const
export const BUDDY_EARS = ['none', 'wiggle', 'flap', 'perk', 'droop'] as const
export const BUDDY_LOOKS = ['center', 'left', 'right', 'up', 'down'] as const

export type BuddyExpression = (typeof BUDDY_EXPRESSIONS)[number]
export type BuddyGesture = (typeof BUDDY_GESTURES)[number]

export type BuddyStep = {
  say: string
  expression: BuddyExpression
  gesture: BuddyGesture
  ears: (typeof BUDDY_EARS)[number]
  look: (typeof BUDDY_LOOKS)[number]
}

export type BuddyScript = {
  version: 1
  steps: BuddyStep[]
  /** Expression Bin settles into once the script has played. */
  idle: BuddyExpression
  /** Short reply chips the child can tap next. */
  suggestions: string[]
}

export const MAX_STEPS = 4
const MAX_SAY_CHARS = 160
const MAX_SUGGESTIONS = 3
const MAX_SUGGESTION_CHARS = 40

export const buddyChatInputSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['child', 'buddy']),
        text: z.string().trim().min(1).max(500),
      }),
    )
    .min(1)
    .max(16),
  childName: z.string().trim().max(60).optional(),
  childAge: z.number().int().min(1).max(18).optional(),
})

export type BuddyChatInput = z.infer<typeof buddyChatInputSchema>

function pick<T extends string>(allowed: readonly T[], value: unknown, fallback: T): T {
  if (typeof value !== 'string') return fallback
  const v = value.trim().toLowerCase().replace(/[\s-]+/g, '_') as T
  return allowed.includes(v) ? v : fallback
}

function clip(text: string, max: number) {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`
}

/** Turns whatever the model produced into a script the frontend can always play. */
export function sanitizeBuddyScript(raw: unknown): BuddyScript | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  const rawSteps = Array.isArray(obj.steps) ? obj.steps : []
  const steps: BuddyStep[] = []
  for (const item of rawSteps) {
    if (!item || typeof item !== 'object') continue
    const s = item as Record<string, unknown>
    const say = typeof s.say === 'string' ? clip(s.say, MAX_SAY_CHARS) : ''
    if (!say) continue
    steps.push({
      say,
      expression: pick(BUDDY_EXPRESSIONS, s.expression, 'happy'),
      gesture: pick(BUDDY_GESTURES, s.gesture, 'none'),
      ears: pick(BUDDY_EARS, s.ears, 'none'),
      look: pick(BUDDY_LOOKS, s.look, 'center'),
    })
    if (steps.length >= MAX_STEPS) break
  }
  if (steps.length === 0) return null
  const suggestions = (Array.isArray(obj.suggestions) ? obj.suggestions : [])
    .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    .map((x) => clip(x, MAX_SUGGESTION_CHARS))
    .slice(0, MAX_SUGGESTIONS)
  return { version: 1, steps, idle: pick(BUDDY_EXPRESSIONS, obj.idle, 'listening'), suggestions }
}

export const FALLBACK_SCRIPT: BuddyScript = {
  version: 1,
  steps: [
    {
      say: 'Ôi, Bin đang hơi bối rối một chút. Bạn nói lại cho Bin nghe nhé!',
      expression: 'thinking',
      gesture: 'shrug',
      ears: 'droop',
      look: 'center',
    },
  ],
  idle: 'listening',
  suggestions: ['Chào Bin!', 'Kể chuyện đi'],
}

export function buildSystemPrompt(childName?: string, childAge?: number) {
  const who = [childName ? `Tên bé: ${childName}.` : '', childAge ? `Bé ${childAge} tuổi.` : ''].join(' ').trim()
  return `Bạn là "${BUDDY_NAME}", một chú robot nhỏ màu xanh có đôi tai biết vẫy, là bạn đồng hành của trẻ nhỏ (3-10 tuổi), trong đó có trẻ tự kỷ (ASD).
${who}

CÁCH NÓI CHUYỆN
- Tiếng Việt, xưng "Bin", gọi bé là "bạn" (hoặc tên bé nếu biết).
- Câu thật ngắn, đơn giản, cụ thể, mỗi câu một ý. Giọng ấm áp, bình tĩnh, khen ngợi chân thành.
- Có thể chơi đoán đồ vật, đếm số, màu sắc, kể chuyện rất ngắn, gọi tên cảm xúc.
- Hỏi tối đa một câu hỏi mỗi lượt, ưu tiên câu hỏi có lựa chọn (ví dụ "màu đỏ hay màu xanh?").
- Không dùng emoji, không dùng ký hiệu markdown.

AN TOÀN
- Không hỏi địa chỉ, trường học, số điện thoại, ảnh hay thông tin riêng tư.
- Không chẩn đoán, không khuyên về thuốc hay y tế.
- Nếu bé nói bị đau, sợ hãi, bị ai làm hại hoặc gặp nguy hiểm: an ủi nhẹ nhàng và bảo bé nói ngay với bố mẹ hoặc người lớn bé tin tưởng.
- Từ chối nhẹ nhàng mọi chủ đề không phù hợp với trẻ em và gợi ý một trò chơi khác.

ĐIỀU KHIỂN NHÂN VẬT
Chỉ trả về MỘT đối tượng JSON, không có chữ nào khác, theo đúng dạng:
{
  "steps": [
    { "say": "câu Bin nói", "expression": "...", "gesture": "...", "ears": "...", "look": "..." }
  ],
  "idle": "...",
  "suggestions": ["gợi ý trả lời 1", "gợi ý trả lời 2"]
}
- steps: 1 đến 3 bước, mỗi "say" tối đa 20 từ. Mỗi bước là một câu kèm một động tác phù hợp với nội dung.
- expression (nét mặt): ${BUDDY_EXPRESSIONS.join(' | ')}
- gesture (cử chỉ tay/đầu): ${BUDDY_GESTURES.join(' | ')}
  wave=vẫy chào, cheer=giơ hai tay cổ vũ, clap=vỗ tay, thumbs_up=giơ ngón cái, think=tay chống cằm suy nghĩ, nod=gật đầu, shake_head=lắc đầu nhẹ, shrug=nhún vai, peace=giơ hai ngón tay, ok=ra dấu OK, point=chỉ tay sang bên, hug=tự ôm (an ủi), dance=nhún nhảy, listen=nghiêng đầu lắng nghe.
- ears (tai): ${BUDDY_EARS.join(' | ')}  (wiggle=vẫy lần lượt, flap=vẫy cả hai, perk=dựng lên chú ý, droop=cụp xuống buồn)
- look (hướng mắt): ${BUDDY_LOOKS.join(' | ')}
- idle: nét mặt sau khi nói xong, thường là "listening".
- suggestions: 2-3 câu trả lời rất ngắn (dưới 6 từ) mà bé có thể bấm để trả lời tiếp, viết như lời của bé.
Chọn động tác đa dạng, khớp với cảm xúc: chào thì wave, khen thì clap/thumbs_up/cheer, bé buồn thì sad hoặc hug, đố vui thì think/curious.`
}
