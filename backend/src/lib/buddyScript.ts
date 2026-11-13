/**
 * Control script of "bạn Bin", the 2D companion for text and voice chat.
 * The LLM's answer is re-validated here; unknown animation names fall back to
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

const VISION_ROLES = ['child', 'mother', 'father', 'unknown'] as const
const VISION_CUES = ['smile', 'brow_lowered', 'mouth_open'] as const
const buddyVisionContextSchema = z.object({
  people: z.array(z.object({
    role: z.enum(VISION_ROLES),
    cues: z.array(z.enum(VISION_CUES)).max(VISION_CUES.length).optional(),
  }).strict()).max(4),
  speaker: z.enum(VISION_ROLES).optional(),
}).strict()

type BuddyVisionContext = z.infer<typeof buddyVisionContextSchema>

export const buddyChatInputSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['child', 'buddy']),
        text: z.string().trim().min(1).max(500),
      }),
    )
    .min(1)
    .max(32),
  childName: z.string().trim().max(60).optional(),
  childAge: z.number().int().min(1).max(18).optional(),
  vision: buddyVisionContextSchema.optional(),
})

export type BuddyChatInput = z.infer<typeof buddyChatInputSchema>

function pick<T extends string>(allowed: readonly T[], value: unknown, fallback: T): T {
  if (typeof value !== 'string') return fallback
  const v = value.trim().toLowerCase().replace(/[\s-]+/g, '_') as T
  return allowed.includes(v) ? v : fallback
}

function clip(text: string, max: number) {
  const t = text.replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  const end = t.lastIndexOf(' ', max - 1)
  return `${t.slice(0, end > 0 ? end : max - 1)}…`
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
  return {
    version: 1,
    steps,
    idle: pick(BUDDY_EXPRESSIONS, obj.idle, 'listening'),
    suggestions: [...new Set(suggestions)].slice(0, MAX_SUGGESTIONS),
  }
}

function speechKey(text: string) {
  return text.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim()
}

function questions(text: string) {
  return (text.match(/[^.!?…]+\?/gu) ?? []).map(speechKey).filter((q) => q.length >= 18)
}

/** Only flag close matches. Short answers such as "Màu xanh!" can be intentional. */
export function repeatsBuddySpeech(script: BuddyScript, messages: BuddyChatInput['messages']) {
  const say = script.steps.map((step) => step.say).join(' ')
  const sentences = (say.match(/[^.!?…]+/gu) ?? []).map(speechKey).filter((s) => s.length >= 18)
  if (new Set(sentences).size < sentences.length) return true

  const last = messages[messages.length - 1]
  const child = last?.role === 'child' ? last.text.normalize('NFC') : ''
  if (/(?:nói|đọc|kể|hỏi|nhắc|đố|lặp)\s+lại|lần nữa|chưa nghe|gì cơ/iu.test(child)) return false

  const childKey = speechKey(child)
  if (childKey.length >= 18 && sentences.includes(childKey)) return true
  const reply = speechKey(say)
  const asked = questions(say)
  const recent = messages.filter((message) => message.role === 'buddy').slice(-3)
  return recent.some(({ text }) =>
    (reply.length >= 18 && reply === speechKey(text)) ||
    questions(text).some((question) => asked.includes(question)),
  )
}

export const FALLBACK_SCRIPT: BuddyScript = {
  version: 1,
  steps: [
    {
      say: 'Bin chưa trả lời được lúc này. Mình thử lại nhé.',
      expression: 'listening',
      gesture: 'none',
      ears: 'none',
      look: 'center',
    },
  ],
  idle: 'listening',
  suggestions: [],
}

function visionPrompt(vision: BuddyVisionContext) {
  const roleLabels = { child: 'bé', mother: 'mẹ', father: 'bố', unknown: 'chưa rõ vai trò' }
  const cueLabels = { smile: 'có nét giống đang cười', brow_lowered: 'hạ chân mày', mouth_open: 'mở miệng' }
  const people = vision.people.map((person) => {
    const uniqueRole = vision.people.filter(({ role }) => role === person.role).length === 1
    const role = uniqueRole ? person.role : 'unknown'
    const cues = [...new Set(person.cues)].map((cue) => cueLabels[cue])
    return [roleLabels[role], ...cues].join(', ')
  }).join(' | ')
  const speaker = vision.speaker && vision.speaker !== 'unknown'
    && vision.people.filter(({ role }) => role === vision.speaker).length === 1
    ? roleLabels[vision.speaker] : 'chưa xác định'

  return `\n\nNgữ cảnh camera cho lượt hiện tại: ${people || 'không có quan sát đủ rõ'}. Người vừa nói: ${speaker}.
Ưu tiên lời vừa nghe. Các quan sát camera chỉ để hỗ trợ khi phù hợp với câu chuyện. Đừng tự nói về camera, gán cảm xúc từ nét mặt hoặc suy ra người vừa nói từ người đang có mặt. Nếu người nói chưa xác định, xưng hô trung tính và đáp theo nội dung vừa nghe. Tuổi đã nêu là tuổi của bé trong hồ sơ.`
}

export function buildSystemPrompt(childAge?: number, vision?: BuddyVisionContext) {
  return `Bạn là ${BUDDY_NAME}, robot xanh hay chơi cùng trẻ nhỏ.${childAge ? ` Bạn nhỏ ${childAge} tuổi.` : ''}

Nói tiếng Việt đời thường, dùng từ cụ thể và câu ngắn. Xưng "Bin" hoặc "mình", gọi trẻ là "bạn". Vào ngay ý của trẻ. Tránh câu khen chung, chào lại, nhắc nguyên câu trẻ vừa nói và thán từ tiếng Anh như "wow". Mỗi lượt có thể kết thúc bằng một nhận xét, một chi tiết mới hoặc một câu hỏi ngắn. Hỏi khi câu hỏi giúp trẻ nói tiếp. Khi trẻ muốn nghỉ, chào nhẹ nhàng rồi dừng.

Dựa vào các lượt trước để hiểu câu ngắn như "ừ", "cái kia" hay đáp án một từ. Tiếp tục trò chơi, câu đố hoặc câu chuyện đang dang dở. Khi trẻ trả lời câu đố, phản hồi vào đáp án đó. Khi trẻ xin nhắc lại, có thể nhắc. Với chi tiết về trẻ và những gì trẻ kể, dựa vào lời trẻ, bỏ qua các suy đoán trước đó của Bin. Nhắc đúng người đã nói và nói thật nếu chưa nhớ.

Lời nói có thể bị chép nhầm một vài từ. Sau khi trẻ kể tên hoặc chọn một thứ, câu ngắn như "à, nó là..." có thể đang sửa chi tiết đó. Dùng thông tin mới nhất khi đính chính rõ. Khi câu nghe được có thể mang hai nghĩa, hỏi xác nhận một chi tiết rồi chờ câu trả lời. Ví dụ "Ý bạn là chú rùa tên Lá à?". Đừng ghép tên cũ với tên mới hay tự thêm việc trẻ hoặc thú cưng đã làm.

Ví dụ nhịp nói:
- Bạn nhỏ bảo "Mình có con rùa tên Lá." → "Lá thích bò đi đâu nhất?"
- Bin hỏi "Con gì kêu meo meo?" Bạn nhỏ đáp "Con mèo." → "Đúng rồi, mèo! Nó hay cuộn tròn khi ngủ."
- Bạn nhỏ bảo "Tớ muốn nghe chuyện." → "Ngày nọ, một chú ốc sên nhặt được chiếc ô tí hon. Trời vừa đổ mưa."
- Bạn nhỏ bảo "Thôi, mình nghỉ." → "Ừ, nghỉ thôi. Hẹn bạn lần sau nhé!"

Giữ cuộc trò chuyện phù hợp với trẻ. Không hỏi thông tin riêng, không hứa giữ bí mật, không chẩn đoán hay tư vấn thuốc. Nếu trẻ nói bị đau, sợ hãi, bị làm hại hoặc gặp nguy hiểm, đáp dịu dàng và nhắc báo ngay cho bố mẹ hoặc người lớn đáng tin. Với chủ đề không phù hợp, từ chối nhẹ nhàng và chuyển sang hoạt động an toàn.

Chỉ xuất một đối tượng JSON dạng {"say":"lời Bin nói","expression":"neutral","gesture":"none","suggestions":[]}.
- say gồm một hoặc hai câu liền ý, tối đa 145 ký tự. Dùng dấu câu tự nhiên để đọc thành tiếng. Không emoji, markdown hoặc ghi chú sân khấu.
- expression: ${BUDDY_EXPRESSIONS.join(' | ')}
- gesture: ${BUDDY_GESTURES.join(' | ')}. Có thể dùng "none" để Bin đứng yên.
- suggestions: tối đa 3 lời đáp ngắn từ phía trẻ, bám vào câu hỏi vừa đặt. Nếu không hỏi, trả về [].${vision ? visionPrompt(vision) : ''}`
}
