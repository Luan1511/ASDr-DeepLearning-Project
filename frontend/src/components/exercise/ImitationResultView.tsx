import { AlertTriangle, FlaskConical, Info } from 'lucide-react'
import { BAND_LABEL, EXERCISE_DISCLAIMER, REASON_MESSAGE, WARNING_MESSAGE } from '../../lib/exercises'
import type { ImitationReasonCode, PartId, SessionScoreDto } from '../../lib/exerciseTypes'
import { formatNumber } from '../../lib/format'
import { BodyPartList } from './BodyPartList'
import { StarRating } from './StarRating'

const MAX_CHILD_LINES = 3

/** "tay", "chân", "người" for the active parts the camera did not see. */
function hiddenPartNoun(score: SessionScoreDto): string | null {
  const hidden = (Object.keys(score.parts) as PartId[]).filter(
    (id) => score.parts[id].active && score.parts[id].status === 'not_visible',
  )
  const nouns: string[] = []
  if (hidden.some((id) => id === 'leftArm' || id === 'rightArm')) nouns.push('tay')
  if (hidden.some((id) => id === 'leftLeg' || id === 'rightLeg')) nouns.push('chân')
  if (hidden.includes('trunk')) nouns.push('người')
  return nouns.length ? nouns.join(' và ') : null
}

function reasonMessage(code: ImitationReasonCode, score: SessionScoreDto): string {
  if (code === 'ACTIVE_PART_NOT_VISIBLE') {
    const noun = hiddenPartNoun(score)
    if (noun) return `Chưa thấy rõ ${noun} của con. Đặt máy xa hơn để thấy cả người nhé.`
  }
  return REASON_MESSAGE[code]
}

function tempoLines(score: SessionScoreDto): string[] {
  const lines: string[] = []
  const { ratio, lagSec } = score.tempo
  if (ratio !== null && ratio > 0) {
    if (ratio >= 1.2) lines.push(`Con làm chậm hơn mẫu khoảng ${formatNumber(ratio, 1)} lần.`)
    else if (ratio <= 0.83) lines.push(`Con làm nhanh hơn mẫu khoảng ${formatNumber(1 / ratio, 1)} lần.`)
    else lines.push('Nhịp làm của con gần giống mẫu.')
  }
  if (lagSec !== null && lagSec > 1.5) lines.push(`Con bắt đầu sau bạn Mầm khoảng ${formatNumber(lagSec, 1)} giây.`)
  return lines
}

function ChildView({ score }: { score: SessionScoreDto }) {
  if (score.movement) {
    const hasMeasurement = score.movement.checks.some(check => check.status === 'evaluated')
    const suggestion = score.movement.events[0]?.feedback
    return (
      <div className="space-y-4 text-center">
        {score.stars !== null && <StarRating stars={score.stars} />}
        <p className="text-xl font-black text-duo-ink">Con đã cố gắng rất tốt!</p>
        {suggestion && (
          <p className="mx-auto max-w-xl rounded-2xl bg-duo-green-soft px-4 py-3 text-lg font-bold leading-relaxed text-duo-green-dark">
            {suggestion}
          </p>
        )}
        {!hasMeasurement && (
          <p className="mx-auto max-w-xl text-base font-bold text-duo-ink">
            Lần sau mình đặt máy sao cho Mầm thấy cả tay và chân nhé.
          </p>
        )}
      </div>
    )
  }
  if (score.status === 'INSUFFICIENT') {
    const reasons = [...new Set(score.reasonCodes)].slice(0, 2)
    return (
      <div className="space-y-3 text-center">
        <div className="text-2xl font-black text-duo-ink md:text-3xl">Mầm chưa nhìn rõ con lần này</div>
        {reasons.map((code) => (
          <p key={code} className="mx-auto max-w-xl text-lg font-bold leading-relaxed text-duo-ink">
            {reasonMessage(code, score)}
          </p>
        ))}
      </div>
    )
  }
  const lines = score.feedback.child.slice(0, MAX_CHILD_LINES)
  return (
    <div className="space-y-4 text-center">
      <StarRating stars={score.stars ?? 1} />
      {score.band && <div className="text-3xl font-black text-duo-green md:text-4xl">{BAND_LABEL[score.band]}</div>}
      <div className="text-lg font-extrabold text-duo-ink">Con đã cố gắng rất tốt!</div>
      {lines.length > 0 && (
        <ul className="mx-auto max-w-xl space-y-2">
          {lines.map((line) => (
            <li key={line} className="rounded-2xl bg-duo-green-soft px-4 py-3 text-lg font-bold leading-relaxed text-duo-green-dark">
              {line}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function MovementFeedback({ movement }: { movement: NonNullable<SessionScoreDto['movement']> }) {
  const unavailable = movement.checks.filter(check => check.status === 'unmeasurable')
  const evaluated = movement.checks.length - unavailable.length
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-black text-duo-ink">Góp ý động tác</h3>
        <span className="text-xs font-bold text-duo-mute">{evaluated}/{movement.checks.length} tiêu chí đo được</span>
      </div>
      {movement.events.length ? (
        <ul className="space-y-2">
          {movement.events.map((event, index) => (
            <li key={`${event.code}-${event.startSec}-${index}`} className="rounded-2xl bg-duo-green-soft px-4 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="text-sm font-extrabold text-duo-ink">{event.label}</span>
                <span className="text-xs font-bold tabular-nums text-duo-green-dark">
                  {formatNumber(event.startSec, 1)}–{formatNumber(event.endSec, 1)} giây
                </span>
              </div>
              <p className="mt-1 text-sm font-semibold leading-relaxed text-duo-green-dark">{event.feedback}</p>
              {event.repetitions !== null && (
                <p className="mt-1 text-xs font-bold text-duo-mute">Quan sát qua {event.repetitions} lượt liên tiếp</p>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-2xl bg-duo-mist px-4 py-3 text-sm font-semibold text-duo-ink">
          {evaluated ? 'Chưa thấy lỗi lặp lại ở những tiêu chí đo được.' : 'Cần thêm các nhịp rõ tay và chân để góp ý.'}
        </p>
      )}
      {unavailable.length > 0 && (
        <details className="rounded-xl bg-duo-mist px-3 py-2 text-sm text-duo-ink">
          <summary className="cursor-pointer font-bold">Tiêu chí chưa đo được</summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">
            {unavailable.map(check => <li key={check.code}>{check.label}</li>)}
          </ul>
        </details>
      )}
      <p className="text-xs font-semibold text-duo-mute">Góp ý thử nghiệm dựa trên chuyển động nhìn thấy trong video.</p>
    </section>
  )
}

function ParentView({ score }: { score: SessionScoreDto }) {
  const scored = score.status === 'SCORED' && score.overall !== null
  const tempo = scored ? tempoLines(score) : []
  const warnings = [...new Set(score.warnings)]
  return (
    <div className="space-y-4">
      {scored ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div>
            <div className="text-xs font-extrabold uppercase tracking-wide text-duo-mute">Điểm luyện tập</div>
            <div className="flex items-baseline gap-1">
              <span className="text-4xl font-black tabular-nums text-duo-green">{score.overall}</span>
              <span className="text-sm font-extrabold text-duo-mute">/100</span>
            </div>
          </div>
          <span className="inline-flex items-center gap-1 rounded-full bg-yellow-50 px-2.5 py-1 text-xs font-extrabold text-yellow-900">
            <FlaskConical className="h-3.5 w-3.5 stroke-[2.5]" />
            Thử nghiệm
          </span>
          {score.band && (
            <span className="flex items-center gap-2">
              <StarRating stars={score.stars ?? 1} size="sm" animate={false} />
              <span className="text-sm font-extrabold text-duo-ink">{BAND_LABEL[score.band]}</span>
            </span>
          )}
        </div>
      ) : (
        <div className="rounded-2xl bg-duo-mist px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-extrabold text-duo-ink">
            <Info className="h-4 w-4 flex-shrink-0 stroke-[2.5]" />
            Lần này chưa đủ hình ảnh để tính điểm luyện tập
          </div>
          <ul className="mt-1.5 list-disc space-y-0.5 pl-6 text-sm font-semibold leading-relaxed text-duo-ink">
            {[...new Set(score.reasonCodes)].map((code) => (
              <li key={code}>{reasonMessage(code, score)}</li>
            ))}
          </ul>
        </div>
      )}

      {scored && score.mode && (
        <div className="text-sm font-semibold text-duo-ink">
          {score.mode === 'mirror'
            ? 'Con làm theo kiểu soi gương (đổi bên so với mẫu) — cách này vẫn được tính.'
            : 'Con làm đúng tay/chân như mẫu.'}
        </div>
      )}

      {tempo.length > 0 && (
        <div className="space-y-0.5 text-sm font-semibold text-duo-ink">
          {tempo.map((line) => (
            <div key={line}>{line}</div>
          ))}
        </div>
      )}

      <div>
        <div className="mb-2 text-xs font-extrabold uppercase tracking-wide text-duo-mute">Từng bộ phận</div>
        <BodyPartList parts={score.parts} showScores={scored} />
      </div>

      {score.feedback.parent.length > 0 && (
        <div>
          <div className="mb-1.5 text-xs font-extrabold uppercase tracking-wide text-duo-mute">Gợi ý cho lần sau</div>
          <ul className="list-disc space-y-1 pl-5 text-sm font-semibold leading-relaxed text-duo-ink">
            {score.feedback.parent.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      )}

      {warnings.length > 0 && (
        <div className="rounded-2xl bg-yellow-50 px-4 py-3 text-sm font-semibold leading-relaxed text-yellow-900">
          <div className="flex items-center gap-2 font-extrabold">
            <AlertTriangle className="h-4 w-4 flex-shrink-0 stroke-[2.5]" />
            Lưu ý về video
          </div>
          <ul className="mt-1.5 list-disc space-y-0.5 pl-6 text-xs font-bold">
            {warnings.map((code) => (
              <li key={code}>{WARNING_MESSAGE[code]}</li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-xs font-semibold leading-relaxed text-duo-mute">
        {EXERCISE_DISCLAIMER} Phiên bản cách chấm: {score.algorithmVersion}.
      </p>
    </div>
  )
}

/**
 * Result of one practice attempt. The child view shows stars and at most three
 * encouraging lines, never a number; the parent view shows the experimental
 * score with its band, per-part list, warnings and the disclaimer.
 */
export function ImitationResultView({ score, view }: { score: SessionScoreDto; view: 'child' | 'parent' }) {
  if (view === 'child') return <ChildView score={score} />
  if (!score.movement) return <ParentView score={score} />
  return (
    <div className="space-y-4">
      <MovementFeedback movement={score.movement} />
      <details className="rounded-2xl border border-duo-mist px-4 py-3">
        <summary className="cursor-pointer text-sm font-extrabold text-duo-ink">Điểm bắt chước tham khảo</summary>
        <div className="mt-3"><ParentView score={score} /></div>
      </details>
    </div>
  )
}
