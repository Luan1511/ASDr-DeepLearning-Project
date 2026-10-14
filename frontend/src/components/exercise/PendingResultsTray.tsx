import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, Loader2, Sparkles } from 'lucide-react'
import { SESSION_STATUS_LABEL, fetchExerciseSessions } from '../../lib/exercises'
import type { ExerciseSessionDto } from '../../lib/exerciseTypes'
import { formatTime } from '../../lib/format'

const POLL_INTERVAL_MS = 4000
/** Finished attempts stay in the tray for this long so the parent notices them. */
const RECENT_MS = 30 * 60 * 1000
const FETCH_LIMIT = 10

const isPending = (s: ExerciseSessionDto) => s.status === 'QUEUED' || s.status === 'PROCESSING'

type TrayItems = { pending: ExerciseSessionDto[]; recent: ExerciseSessionDto[] }

function splitSessions(sessions: ExerciseSessionDto[], now: number): TrayItems {
  return {
    pending: sessions.filter(isPending),
    recent: sessions.filter((s) => !isPending(s) && s.completedAt && now - new Date(s.completedAt).getTime() < RECENT_MS),
  }
}

/**
 * Attempts of one child that are still being scored, plus those finished in the
 * last 30 minutes, with links to their results. Polls while something is pending.
 */
export function PendingResultsTray({ childId }: { childId: string }) {
  const [items, setItems] = useState<{ childId: string; value: TrayItems } | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let stale = false
    fetchExerciseSessions({ childId, limit: FETCH_LIMIT }).then(
      (sessions) => !stale && setItems({ childId, value: splitSessions(sessions, Date.now()) }),
      () => {
        // The tray is a convenience; the library and the child dashboard show the same data.
      },
    )
    return () => {
      stale = true
    }
  }, [childId, tick])

  const current = items?.childId === childId ? items.value : null
  const hasPending = Boolean(current?.pending.length)

  useEffect(() => {
    if (!hasPending) return
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') setTick((t) => t + 1)
    }, POLL_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [hasPending])

  if (!current || (current.pending.length === 0 && current.recent.length === 0)) return null

  return (
    <div className="card-duo space-y-2 p-4" aria-live="polite">
      {current.pending.length > 0 && (
        <div className="flex items-center gap-2 text-sm font-extrabold text-duo-ink">
          <Loader2 className="h-4 w-4 animate-spin text-duo-green" />
          Bạn Mầm đang chấm {current.pending.length} bài…
        </div>
      )}
      {current.recent.length > 0 && (
        <div className="flex items-center gap-2 text-sm font-extrabold text-duo-ink">
          <Sparkles className="h-4 w-4 text-duo-green" />
          Vừa có kết quả
        </div>
      )}
      <div className="space-y-1">
        {[...current.pending, ...current.recent].map((s) => (
          <Link
            key={s.id}
            to={`/exercise-sessions/${s.id}`}
            className="flex items-center gap-3 rounded-2xl px-3 py-2 hover:bg-duo-mist"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-extrabold text-duo-ink">{s.exercise.title}</div>
              <div className="text-xs font-bold text-duo-mute">
                {formatTime(s.createdAt)} • {SESSION_STATUS_LABEL[s.status]}
                {s.status === 'QUEUED' && s.queuePosition ? ` • còn ${s.queuePosition} video trước` : ''}
              </div>
            </div>
            <ChevronRight className="h-4 w-4 flex-shrink-0 text-duo-mute" />
          </Link>
        ))}
      </div>
    </div>
  )
}
