import { Link } from 'react-router-dom'
import { Clock, Footprints, Hand, PersonStanding, Play, type LucideIcon } from 'lucide-react'
import { BODY_FOCUS_LABEL, DIFFICULTY_LABEL } from '../../lib/exercises'
import type { BodyFocus, ExerciseSummaryDto } from '../../lib/exerciseTypes'
import { formatDate, formatNumber } from '../../lib/format'
import { StarRating } from './StarRating'

const FOCUS_ICON: Record<BodyFocus, LucideIcon> = { ARMS: Hand, LEGS: Footprints, TRUNK: PersonStanding }

/** Library card: what the exercise trains, how long it is, and the child's stars so far. */
export function ExerciseCard({
  exercise,
  childId,
  disabledReason,
}: {
  exercise: ExerciseSummaryDto
  childId: string | null
  /** Shown instead of the practice button (e.g. consent missing). */
  disabledReason?: string | null
}) {
  const Icon = FOCUS_ICON[exercise.bodyFocus[0] ?? 'TRUNK']
  const stats = exercise.child
  const practiceHref = `/exercises/${exercise.id}/practice${childId ? `?childId=${encodeURIComponent(childId)}` : ''}`

  return (
    <div className="card-duo flex flex-col p-5">
      <div className="flex items-start gap-3">
        <div className="grid h-12 w-12 flex-shrink-0 place-items-center rounded-2xl bg-duo-green-soft text-duo-green-dark">
          <Icon className="h-6 w-6 stroke-[2.2]" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-base font-black leading-snug text-duo-ink">{exercise.title}</div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-bold text-duo-mute">
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" />
              khoảng {formatNumber(Math.max(1, Math.round(exercise.template.durationSec)), 0)} giây
            </span>
            <span className="inline-flex items-center gap-1" aria-label={`Độ khó: ${DIFFICULTY_LABEL[exercise.difficulty]}`}>
              {[1, 2, 3].map((i) => (
                <span
                  key={i}
                  aria-hidden
                  className={['h-1.5 w-1.5 rounded-full', i <= exercise.difficulty ? 'bg-duo-green' : 'bg-duo-line'].join(' ')}
                />
              ))}
              <span className="ml-0.5">{DIFFICULTY_LABEL[exercise.difficulty]}</span>
            </span>
          </div>
        </div>
      </div>

      <p className="mt-3 text-sm font-semibold leading-relaxed text-duo-ink">{exercise.description}</p>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {exercise.bodyFocus.map((f) => (
          <span key={f} className="rounded-full bg-duo-mist px-2.5 py-0.5 text-[11px] font-extrabold text-duo-mute">
            {BODY_FOCUS_LABEL[f]}
          </span>
        ))}
      </div>

      {stats && stats.attempts > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-2xl bg-duo-mist px-3 py-2 text-xs font-bold text-duo-mute">
          <span>{stats.attempts} lần tập</span>
          {stats.bestStars !== null && (
            <span className="inline-flex items-center gap-1.5">
              Tốt nhất <StarRating stars={stats.bestStars} size="sm" animate={false} />
            </span>
          )}
          {stats.lastAt && <span>Gần nhất {formatDate(stats.lastAt)}</span>}
        </div>
      )}

      <div className="mt-auto pt-4">
        {disabledReason ? (
          <div className="text-xs font-bold text-duo-mute">{disabledReason}</div>
        ) : (
          <Link to={practiceHref} className="btn-duo w-full">
            <Play className="h-4 w-4" />
            Tập với bạn Mầm
          </Link>
        )}
      </div>
    </div>
  )
}
