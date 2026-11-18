import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Play, Sparkles } from 'lucide-react'
import { DIFFICULTY_LABEL } from '../../lib/exercises'
import { RECOMMENDATION_LABEL, fetchExercisePlan, type ExercisePlanDto } from '../../lib/personalization'

/**
 * "Gợi ý cho con": up to three exercises picked by simple rules from the
 * child's practice history and profile, each with its reason in plain words.
 * Renders nothing when the backend has no plan (older server, error).
 */
export function ExercisePlanSection({
  childId,
  childName,
  canPractise,
}: {
  childId: string
  childName: string
  /** False while the recording consent is missing: the suggestions show without a start button. */
  canPractise: boolean
}) {
  const [plan, setPlan] = useState<{ childId: string; value: ExercisePlanDto } | null>(null)

  useEffect(() => {
    let stale = false
    fetchExercisePlan(childId).then(
      (res) => !stale && setPlan({ childId, value: res.plan }),
      () => !stale && setPlan(null),
    )
    return () => {
      stale = true
    }
  }, [childId])

  const current = plan?.childId === childId ? plan.value : null
  if (!current || current.recommendations.length === 0) return null

  const name = current.nickname ?? childName
  const { goal, daysPractised } = current.weekly
  const reached = goal !== null && daysPractised >= goal

  return (
    <section className="card-duo p-5" aria-label={`Gợi ý bài tập cho ${name}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-extrabold uppercase tracking-wide text-duo-ink">
            <Sparkles className="h-4 w-4 text-duo-green-dark" />
            Gợi ý cho {name}
          </h2>
          <p className="mt-1 text-xs font-semibold text-duo-mute">
            Dựa trên các lần tập gần đây và hồ sơ của con. Mức đang tập: {DIFFICULTY_LABEL[current.level]}.
          </p>
        </div>

        {goal !== null && (
          <div className="min-w-[180px] rounded-2xl bg-duo-mist px-4 py-2.5">
            <div className="flex items-baseline justify-between gap-3 text-xs font-extrabold text-duo-ink">
              <span>Tuần này</span>
              <span className="tabular-nums">
                {daysPractised}/{goal} ngày tập
              </span>
            </div>
            <div
              className="mt-1.5 h-2 overflow-hidden rounded-full bg-white"
              role="meter"
              aria-label="Số ngày đã tập trong tuần so với mục tiêu"
              aria-valuemin={0}
              aria-valuemax={goal}
              aria-valuenow={Math.min(goal, daysPractised)}
            >
              <div className="h-2 rounded-full bg-duo-green" style={{ width: `${Math.min(100, (daysPractised / goal) * 100)}%` }} />
            </div>
            <div className="mt-1 text-[11px] font-bold text-duo-mute">
              {reached ? 'Đã đạt mục tiêu tuần này!' : `Còn ${goal - daysPractised} ngày nữa là đạt mục tiêu.`}
            </div>
          </div>
        )}
      </div>

      <ol className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-3">
        {current.recommendations.map((rec) => {
          const hints = [rec.settings.playbackRate < 1 ? 'Bin làm mẫu chậm hơn' : null].filter(Boolean)
          return (
            <li key={rec.exercise.id} className="flex flex-col rounded-2xl bg-duo-mist p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-duo-green-soft px-2.5 py-0.5 text-[11px] font-extrabold text-duo-green-dark">
                  {RECOMMENDATION_LABEL[rec.kind]}
                </span>
                <span className="text-[11px] font-extrabold text-duo-mute">{DIFFICULTY_LABEL[rec.exercise.difficulty]}</span>
              </div>
              <div className="mt-2 text-base font-black leading-snug text-duo-ink">{rec.exercise.title}</div>
              <p className="mt-1 text-sm font-semibold leading-relaxed text-duo-ink">{rec.reason}</p>
              {hints.length > 0 && <p className="mt-1 text-xs font-bold text-duo-mute">{hints.join(' • ')}</p>}
              <div className="mt-auto pt-3">
                {canPractise ? (
                  <Link to={`/exercises/${rec.exercise.id}/practice?childId=${encodeURIComponent(childId)}`} className="btn-duo w-full">
                    <Play className="h-4 w-4" />
                    Tập bài này
                  </Link>
                ) : (
                  <div className="text-xs font-bold text-duo-mute">Bật quyền ghi hình bài tập ở phía trên để bắt đầu tập.</div>
                )}
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
