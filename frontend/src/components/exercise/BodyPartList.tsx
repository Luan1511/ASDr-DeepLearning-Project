import { CircleCheck, CircleDot, CircleHelp, EyeOff, Move, Sprout, ThumbsUp, TrendingUp, type LucideIcon } from 'lucide-react'
import { PART_LABEL } from '../../lib/exercises'
import type { PartId, PartResultDto } from '../../lib/exerciseTypes'
import { formatNumber } from '../../lib/format'

const PART_ORDER: PartId[] = ['leftArm', 'rightArm', 'leftLeg', 'rightLeg', 'trunk']

type PartStatus = { icon: LucideIcon; text: string; tone: string }

// Every status has its own icon and words, so the list reads the same in grayscale.
function partStatus(part: PartResultDto): PartStatus {
  if (part.status === 'not_visible') return { icon: EyeOff, text: 'Chưa thấy rõ trong video', tone: 'text-duo-mute' }
  if (part.score === null) return { icon: CircleHelp, text: 'Chưa đủ dữ liệu', tone: 'text-duo-mute' }
  if (!part.active) {
    return part.score >= 60
      ? { icon: CircleDot, text: 'Giữ yên tốt', tone: 'text-duo-green-dark' }
      : { icon: Move, text: 'Nên giữ yên hơn', tone: 'text-yellow-800' }
  }
  if (part.score >= 80) return { icon: CircleCheck, text: 'Rất giống mẫu', tone: 'text-duo-green-dark' }
  if (part.score >= 60) return { icon: ThumbsUp, text: 'Khá giống mẫu', tone: 'text-duo-green-dark' }
  if (part.score >= 40) return { icon: TrendingUp, text: 'Đang tiến bộ', tone: 'text-yellow-800' }
  return { icon: Sprout, text: 'Cần luyện thêm', tone: 'text-yellow-800' }
}

function partDetails(part: PartResultDto): string[] {
  if (part.status === 'not_visible' || !part.active) return []
  const details: string[] = []
  const r = part.amplitudeRatio
  if (r !== null && (r < 0.8 || r > 1.25)) {
    details.push(`Biên độ ${r < 1 ? 'nhỏ' : 'lớn'} hơn mẫu (khoảng ${formatNumber(r, 1)} lần so với mẫu).`)
  }
  const w = part.worstWindowSec
  if (w && part.score !== null && part.score < 80) {
    details.push(`Khác mẫu nhiều nhất ở giây ${formatNumber(w[0], 1)}–${formatNumber(w[1], 1)} của bài mẫu.`)
  }
  return details
}

/** Per-part result for parents: icon + words (+ the experimental number when `showScores`). */
export function BodyPartList({ parts, showScores = true }: { parts: Record<PartId, PartResultDto>; showScores?: boolean }) {
  const ordered = PART_ORDER.filter((id) => parts[id]).sort(
    (a, b) => Number(parts[b].active) - Number(parts[a].active),
  )

  return (
    <ul className="space-y-2">
      {ordered.map((id) => {
        const part = parts[id]
        const status = partStatus(part)
        const Icon = status.icon
        const details = partDetails(part)
        return (
          <li key={id} className="flex items-start gap-3 rounded-2xl bg-duo-mist px-4 py-3">
            <Icon className={['mt-0.5 h-5 w-5 flex-shrink-0 stroke-[2.5]', status.tone].join(' ')} aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <div className="text-sm font-extrabold text-duo-ink">
                  {PART_LABEL[id]}
                  <span className="ml-2 text-xs font-bold text-duo-mute">
                    {part.active ? 'cử động chính của bài' : 'đứng yên trong mẫu'}
                  </span>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className={['text-sm font-extrabold', status.tone].join(' ')}>{status.text}</span>
                  {showScores && part.status === 'ok' && part.score !== null && (
                    <span className="text-sm font-black tabular-nums text-duo-ink">{Math.round(part.score)}</span>
                  )}
                </div>
              </div>
              {details.map((d) => (
                <div key={d} className="mt-0.5 text-xs font-semibold leading-relaxed text-duo-mute">
                  {d}
                </div>
              ))}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
