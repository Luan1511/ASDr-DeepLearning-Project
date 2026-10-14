/**
 * Vietnamese feedback (spec §6.1). Encouraging, never diagnostic: every line
 * is checked against BANNED_FEEDBACK_WORDS by test/imitationFeedback.test.ts.
 * Parts are always named from the CHILD's side.
 */
import { IMITATION_V1 as C } from './constants'
import type { FeatureId, ImitationBand, ImitationReasonCode, PartId, PracticeMode } from './types'

/** Token match, NFC, case-insensitive (multi-word entries match consecutive tokens). */
export const BANNED_FEEDBACK_WORDS: string[] = [
  'bất thường',
  'kém',
  'dấu hiệu',
  'tự kỷ',
  'chẩn đoán',
  'sai',
  'thất bại',
  'ASD',
  'bệnh',
]

function tokens(text: string): string[] {
  return text
    .normalize('NFC')
    .toLocaleLowerCase('vi')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
}

const BANNED_TOKENS = BANNED_FEEDBACK_WORDS.map(tokens)

export function containsBannedWord(text: string): boolean {
  const t = tokens(text)
  return BANNED_TOKENS.some((banned) => {
    for (let i = 0; i + banned.length <= t.length; i += 1) {
      if (banned.every((b, k) => t[i + k] === b)) return true
    }
    return false
  })
}

export const CHILD_PART_NAME: Record<PartId, string> = {
  leftArm: 'tay trái',
  rightArm: 'tay phải',
  leftLeg: 'chân trái',
  rightLeg: 'chân phải',
  trunk: 'người',
}

export const PARENT_PART_NAME: Record<PartId, string> = {
  leftArm: 'Tay trái',
  rightArm: 'Tay phải',
  leftLeg: 'Chân trái',
  rightLeg: 'Chân phải',
  trunk: 'Thân người',
}

const SIDE_WORD: Record<PartId, string> = { leftArm: 'trái', rightArm: 'phải', leftLeg: 'trái', rightLeg: 'phải', trunk: '' }
const LIMB_WORD: Record<PartId, string> = { leftArm: 'tay', rightArm: 'tay', leftLeg: 'chân', rightLeg: 'chân', trunk: 'người' }

export const OPENING: Record<ImitationBand, string> = {
  VERY_CLOSE: 'Tuyệt vời! Con làm rất giống bạn Mầm!',
  CLOSE: 'Giỏi lắm! Con làm khá giống bạn Mầm rồi!',
  PROGRESSING: 'Con đang tiến bộ đấy!',
  KEEP_PRACTISING: 'Cảm ơn con đã cố gắng! Mình cùng tập thêm nhé!',
}

/** Shown with every scored attempt (the effort star); not counted among the ≤ 3 lines. */
export const EFFORT_LINE = 'Con đã cố gắng rất tốt!'

export const BEST_PART = '{Part} làm rất giống bạn Mầm!'

type TipKind = 'upper' | 'fore' | 'thigh' | 'thighLen' | 'shank' | 'lean' | 'rootDy' | 'rootDx'

export const TIP_MORE: Record<TipKind, string> = {
  upper: 'Thử đưa {part} lên cao hơn nữa nhé!',
  fore: 'Thử co duỗi khuỷu {part} rõ hơn nhé!',
  thigh: 'Thử đưa {part} ra xa hơn nhé!',
  thighLen: 'Thử nâng gối {side} cao hơn nhé!',
  shank: 'Thử co {part} rõ hơn nhé!',
  lean: 'Thử nghiêng người nhiều hơn nhé!',
  rootDy: 'Thử hạ người thấp hơn nhé!',
  rootDx: 'Thử bước sang ngang rộng hơn nhé!',
}
export const TIP_LESS = '{Part} làm nhẹ nhàng hơn một chút nhé!'
export const TIP_TIMING = '{Part} chưa giống bạn Mầm ở giây {t1}–{t2}, cùng xem lại bạn Mầm làm nhé!'

export const EXTRA = {
  staticNotVisible: 'Chưa thấy rõ {limb} của con, đặt máy xa hơn để thấy cả người nhé.',
  staticMoving: 'Giữ yên {limb} khi làm động tác {activeLimb} nhé!',
  slower: 'Con làm chậm hơn bạn Mầm một chút, lần sau thử nhanh hơn nhé!',
  faster: 'Con làm nhanh quá, thử chậm lại cho giống bạn Mầm nhé!',
  late: 'Lần sau mình bắt đầu cùng lúc với bạn Mầm nhé!',
  mirror: 'Con làm theo kiểu soi gương, rất tốt!',
} as const

export const INSUFFICIENT_LEAD = 'Mầm chưa nhìn rõ con lần này.'
export const INSUFFICIENT_MESSAGE: Record<ImitationReasonCode, string> = {
  TOO_FEW_FRAMES: 'Máy chưa nhìn thấy con đủ lâu. Đặt máy sao cho thấy cả người con, đủ sáng, rồi thử lại nhé.',
  VIDEO_TOO_SHORT: 'Đoạn quay hơi ngắn. Cùng làm hết bài với bạn Mầm rồi mới dừng nhé.',
  ACTIVE_PART_NOT_VISIBLE: 'Chưa thấy rõ {limb} của con. Đặt máy xa hơn để thấy cả người nhé.',
}

export const PARENT_LINE = {
  activePart: '{Part}: điểm {score}/100, biên độ bằng khoảng {ratio} lần bạn Mầm.',
  activePartNotVisible: '{Part}: chưa thấy rõ trong video nên chưa chấm được.',
  staticMoving: '{Part}: bạn Mầm giữ yên phần này nhưng con cử động khá nhiều.',
  staticNotVisible: '{Part}: chưa thấy rõ trong video nên không tính vào điểm.',
  tempoSlower: 'Nhịp: con làm chậm hơn bạn Mầm, thời gian dài gấp khoảng {ratio} lần.',
  tempoFaster: 'Nhịp: con làm nhanh hơn bạn Mầm, thời gian chỉ bằng khoảng {ratio} lần.',
  tempoClose: 'Nhịp: gần giống bạn Mầm.',
  lagLate: 'Con bắt đầu sau bạn Mầm khoảng {sec} giây.',
  lagEarly: 'Con bắt đầu trước bạn Mầm khoảng {sec} giây.',
  mirror: 'Con làm theo kiểu soi gương (đổi bên trái và phải so với bạn Mầm); cách này vẫn được tính điểm.',
} as const

/** Every raw catalogue string (for the banned-word test). */
export const FEEDBACK_CATALOGUE: string[] = [
  ...Object.values(OPENING),
  EFFORT_LINE,
  BEST_PART,
  ...Object.values(TIP_MORE),
  TIP_LESS,
  TIP_TIMING,
  ...Object.values(EXTRA),
  INSUFFICIENT_LEAD,
  ...Object.values(INSUFFICIENT_MESSAGE),
  ...Object.values(PARENT_LINE),
]

const capitalize = (s: string) => (s ? s.charAt(0).toLocaleUpperCase('vi') + s.slice(1) : s)

export function fillFeedback(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => vars[key] ?? match)
}

function partVars(part: PartId): Record<string, string> {
  return { part: CHILD_PART_NAME[part], Part: capitalize(CHILD_PART_NAME[part]), side: SIDE_WORD[part] }
}

/** "tay", "chân", "tay và chân", … for a set of parts (child's wording). */
export function limbWords(parts: PartId[]): string {
  const words = (['tay', 'chân', 'người'] as const).filter((w) => parts.some((p) => LIMB_WORD[p] === w))
  if (words.length <= 1) return words[0] ?? 'người'
  return `${words.slice(0, -1).join(', ')} và ${words[words.length - 1]}`
}

const formatNumber = (v: number, digits = 1) => v.toFixed(digits).replace('.', ',')

function tipKind(feature: FeatureId): TipKind {
  switch (feature) {
    case 'lUpper':
    case 'rUpper':
      return 'upper'
    case 'lFore':
    case 'rFore':
      return 'fore'
    case 'lThigh':
    case 'rThigh':
      return 'thigh'
    case 'lThighLen':
    case 'rThighLen':
      return 'thighLen'
    case 'lShank':
    case 'rShank':
      return 'shank'
    default:
      return feature
  }
}

export interface FeedbackPart {
  part: PartId
  active: boolean
  visible: boolean
  /** Not visible because of the child's recording (the demonstration showed the part). */
  hiddenByChild: boolean
  /** Part score PS (active) or spatial score S (static), 0..100. */
  score: number | null
  ratio: number | null
  dominant: FeatureId
  worstWindowSec: [number, number] | null
}

export interface FeedbackInput {
  status: 'SCORED' | 'INSUFFICIENT'
  reasons: ImitationReasonCode[]
  band: ImitationBand | null
  parts: FeedbackPart[]
  tempoRatio: number | null
  lagSec: number | null
  practiceMode: PracticeMode
  /** Mirror mode on a lateralized template. */
  mirrorMode: boolean
}

const A = C.amplitude
const T = C.tempo
const STATIC_MOVING_BELOW = 60
const BEST_PART_FROM = 80
const TIP_BELOW = 70
const LAG_NOTE_SEC = 1.5

function insufficientFeedback(input: FeedbackInput): { child: string[]; parent: string[] } {
  const hiddenActive = input.parts.filter((p) => p.active && !p.visible && p.hiddenByChild).map((p) => p.part)
  const limb = limbWords(hiddenActive.length ? hiddenActive : input.parts.filter((p) => p.active).map((p) => p.part))
  const messages = input.reasons.map((code) => fillFeedback(INSUFFICIENT_MESSAGE[code], { limb }))
  // A clip that is too short also has too few frames; "too short" is the more useful advice.
  const order: ImitationReasonCode[] = ['VIDEO_TOO_SHORT', 'ACTIVE_PART_NOT_VISIBLE', 'TOO_FEW_FRAMES']
  const lead = order.find((code) => input.reasons.includes(code))
  const childMessage = lead ? fillFeedback(INSUFFICIENT_MESSAGE[lead], { limb }) : INSUFFICIENT_MESSAGE.TOO_FEW_FRAMES
  return { child: [INSUFFICIENT_LEAD, childMessage], parent: messages }
}

export function buildFeedback(input: FeedbackInput): { child: string[]; parent: string[] } {
  if (input.status === 'INSUFFICIENT' || !input.band) return insufficientFeedback(input)

  const active = input.parts.filter((p) => p.active && p.visible && p.score !== null)
  const staticParts = input.parts.filter((p) => !p.active)
  const rho = input.tempoRatio

  // Praise
  const opening = OPENING[input.band]
  const best = [...active].sort((a, b) => (b.score as number) - (a.score as number))[0]
  const bestLine = best && (best.score as number) >= BEST_PART_FROM ? fillFeedback(BEST_PART, partVars(best.part)) : null

  // Tip for the weakest active part
  let tip: string | null = null
  const worst = [...active].sort((a, b) => (a.score as number) - (b.score as number))[0]
  if (worst && (worst.score as number) < TIP_BELOW) {
    const vars = partVars(worst.part)
    if (worst.ratio !== null && worst.ratio < A.okLo) tip = fillFeedback(TIP_MORE[tipKind(worst.dominant)], vars)
    else if (worst.ratio !== null && worst.ratio > A.okHi) tip = fillFeedback(TIP_LESS, vars)
    else if (worst.worstWindowSec) {
      tip = fillFeedback(TIP_TIMING, {
        ...vars,
        t1: String(Math.floor(worst.worstWindowSec[0])),
        t2: String(Math.max(Math.floor(worst.worstWindowSec[0]) + 1, Math.ceil(worst.worstWindowSec[1]))),
      })
    }
  }

  // Extra: the first that applies
  const activeLimb = limbWords(input.parts.filter((p) => p.active).map((p) => p.part))
  const hiddenStatic = staticParts.filter((p) => !p.visible && p.hiddenByChild).map((p) => p.part)
  const movingStatic = staticParts.filter((p) => p.visible && p.score !== null && p.score < STATIC_MOVING_BELOW).map((p) => p.part)
  let extra: string | null = null
  if (hiddenStatic.length) extra = fillFeedback(EXTRA.staticNotVisible, { limb: limbWords(hiddenStatic) })
  else if (movingStatic.length) extra = fillFeedback(EXTRA.staticMoving, { limb: limbWords(movingStatic), activeLimb })
  else if (rho !== null && rho > T.okHi) extra = EXTRA.slower
  else if (rho !== null && rho < T.okLo) extra = EXTRA.faster
  else if (input.practiceMode === 'FOLLOW_ALONG' && input.lagSec !== null && input.lagSec > LAG_NOTE_SEC) extra = EXTRA.late
  else if (input.mirrorMode) extra = EXTRA.mirror

  // At most three lines: the opening always, then tip and extra, then the part praise if room is left.
  const child = [opening]
  if (bestLine && !(tip && extra)) child.push(bestLine)
  if (tip) child.push(tip)
  if (extra) child.push(extra)

  const parent: string[] = []
  for (const p of input.parts) {
    const Part = PARENT_PART_NAME[p.part]
    if (p.active && !p.visible) parent.push(fillFeedback(PARENT_LINE.activePartNotVisible, { Part }))
    else if (p.active && p.score !== null) {
      parent.push(
        fillFeedback(PARENT_LINE.activePart, {
          Part,
          score: String(Math.round(p.score)),
          ratio: formatNumber(p.ratio ?? 0),
        }),
      )
    } else if (!p.active && !p.visible) parent.push(fillFeedback(PARENT_LINE.staticNotVisible, { Part }))
    else if (!p.active && p.score !== null && p.score < STATIC_MOVING_BELOW) parent.push(fillFeedback(PARENT_LINE.staticMoving, { Part }))
  }
  if (rho !== null) {
    if (rho > T.okHi) parent.push(fillFeedback(PARENT_LINE.tempoSlower, { ratio: formatNumber(rho) }))
    else if (rho < T.okLo) parent.push(fillFeedback(PARENT_LINE.tempoFaster, { ratio: formatNumber(rho) }))
    else parent.push(PARENT_LINE.tempoClose)
  }
  if (input.practiceMode === 'FOLLOW_ALONG' && input.lagSec !== null) {
    if (input.lagSec > LAG_NOTE_SEC) parent.push(fillFeedback(PARENT_LINE.lagLate, { sec: formatNumber(input.lagSec) }))
    else if (input.lagSec < -LAG_NOTE_SEC) parent.push(fillFeedback(PARENT_LINE.lagEarly, { sec: formatNumber(-input.lagSec) }))
  }
  if (input.mirrorMode) parent.push(PARENT_LINE.mirror)

  return { child, parent }
}
