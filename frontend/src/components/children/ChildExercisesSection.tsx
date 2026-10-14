import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import axios from 'axios'
import { ChevronRight, Info, Loader2, PersonStanding, Star } from 'lucide-react'
import { Card } from '../Card'
import { ExerciseProgressChart } from '../exercise/ExerciseProgressChart'
import { apiErrorCode } from '../../lib/api'
import {
  EXERCISE_DISCLAIMER,
  SESSION_STATUS_LABEL,
  exerciseApiErrorMessage,
  fetchExerciseProgress,
  fetchExerciseSessions,
} from '../../lib/exercises'
import type { ExerciseProgressDto, ExerciseSessionDto } from '../../lib/exerciseTypes'
import { formatDateTime } from '../../lib/format'

const RECENT_LIMIT = 5
const POLL_INTERVAL_MS = 5000

type SectionState =
  | { kind: 'loading' }
  | { kind: 'hidden' }
  | { kind: 'migration' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; progress: ExerciseProgressDto[]; sessions: ExerciseSessionDto[] }

function failureState(error: unknown): SectionState {
  const code = apiErrorCode(error)
  if (code === 'EXERCISES_DISABLED') return { kind: 'hidden' }
  // A backend without the exercise routes answers a bare 404: nothing to show.
  if (!code && axios.isAxiosError(error) && error.response?.status === 404) return { kind: 'hidden' }
  if (code === 'DATABASE_MIGRATION_REQUIRED') return { kind: 'migration' }
  return { kind: 'error', message: exerciseApiErrorMessage(error, 'Không tải được bài tập của trẻ.') }
}

function Stars({ value }: { value: number | null }) {
  if (!value) return null
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${value}/3 sao`}>
      {[1, 2, 3].map((i) => (
        <Star
          key={i}
          aria-hidden
          className={['h-3.5 w-3.5', i <= value ? 'fill-duo-gold text-duo-gold' : 'text-duo-line'].join(' ')}
        />
      ))}
    </span>
  )
}

function SessionOutcome({ session }: { session: ExerciseSessionDto }) {
  const score = session.score
  if (session.status === 'SCORED' && score?.overall !== null && score?.overall !== undefined) {
    return (
      <span className="flex items-center gap-2">
        <Stars value={score.stars} />
        <span className="text-sm font-black tabular-nums text-duo-ink">{score.overall}</span>
      </span>
    )
  }
  if (session.status === 'QUEUED' || session.status === 'PROCESSING') {
    return (
      <span className="flex items-center gap-1.5 text-xs font-extrabold text-duo-mute">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        {SESSION_STATUS_LABEL[session.status]}
      </span>
    )
  }
  return <span className="text-xs font-extrabold text-duo-mute">{SESSION_STATUS_LABEL[session.status]}</span>
}

/** Dashboard section of a child's practice exercises (experimental, never a screening result). */
export function ChildExercisesSection({ childId, childName }: { childId: string; childName: string }) {
  const [state, setState] = useState<SectionState>({ kind: 'loading' })
  const [reloadKey, setReloadKey] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    Promise.all([fetchExerciseProgress(childId), fetchExerciseSessions({ childId, limit: RECENT_LIMIT })]).then(
      ([progress, sessions]) => active && setState({ kind: 'ready', progress, sessions }),
      (error: unknown) => {
        if (!active) return
        // Keep showing loaded data when a background refresh fails.
        setState((prev) => (prev.kind === 'ready' && reloadKey > 0 ? prev : failureState(error)))
      },
    )
    return () => {
      active = false
    }
  }, [childId, reloadKey])

  const pending =
    state.kind === 'ready' && state.sessions.some((s) => s.status === 'QUEUED' || s.status === 'PROCESSING')

  useEffect(() => {
    if (!pending) return
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') setReloadKey((k) => k + 1)
    }, POLL_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [pending])

  if (state.kind === 'hidden') return null

  const practiceLink = `/exercises?childId=${encodeURIComponent(childId)}`
  const header = (
    <span className="flex items-center gap-2">
      <span className="rounded-full bg-yellow-50 px-2 py-0.5 text-[11px] font-extrabold text-yellow-900">Thử nghiệm</span>
    </span>
  )

  if (state.kind === 'loading') {
    return (
      <Card title="Bài tập bắt chước" right={header}>
        <div className="flex items-center gap-2 text-sm font-semibold text-duo-mute">
          <Loader2 className="h-4 w-4 animate-spin" />
          Đang tải bài tập...
        </div>
      </Card>
    )
  }

  if (state.kind === 'migration') {
    return (
      <Card title="Bài tập bắt chước" right={header}>
        <div className="flex items-start gap-2 rounded-2xl bg-duo-mist px-4 py-3 text-sm font-semibold text-duo-mute">
          <Info className="mt-0.5 h-4 w-4 flex-shrink-0" />
          Tính năng bài tập đang được chuẩn bị trên máy chủ và sẽ sớm mở. Các thông tin khác của hồ sơ không bị ảnh hưởng.
        </div>
      </Card>
    )
  }

  if (state.kind === 'error') {
    return (
      <Card title="Bài tập bắt chước" right={header}>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-red-50 px-4 py-3 text-sm font-bold text-duo-red">
          <span>{state.message}</span>
          <button type="button" className="btn-duo-secondary !px-3 !py-2" onClick={() => setReloadKey((k) => k + 1)}>
            Thử lại
          </button>
        </div>
      </Card>
    )
  }

  const practiced = state.progress.filter((p) => p.attempts > 0 || p.series.length > 0)
  const fallback = practiced.find((p) => p.scoredAttempts >= 2) ?? practiced[0] ?? null
  const selected = practiced.find((p) => p.exercise.id === selectedId) ?? fallback

  return (
    <Card title="Bài tập bắt chước" right={header}>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-semibold leading-relaxed text-duo-ink">
            {practiced.length === 0
              ? `${childName} chưa tập bài nào. Cùng con làm theo bạn Mầm các động tác vận động vui nhộn nhé!`
              : `Các bài ${childName} đã tập cùng bạn Mầm.`}
          </p>
          <Link to={practiceLink} className="btn-duo">
            <PersonStanding className="h-4 w-4" />
            Tập với bạn Mầm
          </Link>
        </div>

        {practiced.length > 0 && (
          <>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Chọn bài tập">
              {practiced.map((p) => {
                const isSelected = selected?.exercise.id === p.exercise.id
                return (
                  <button
                    key={p.exercise.id}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => setSelectedId(p.exercise.id)}
                    className={[
                      'rounded-full px-3 py-1.5 text-xs font-extrabold transition-all',
                      isSelected ? 'bg-duo-green-soft text-duo-green-dark shadow-ring-green' : 'bg-duo-mist text-duo-mute hover:text-duo-ink',
                    ].join(' ')}
                  >
                    {p.exercise.title}
                    <span className="ml-1 font-bold opacity-70">({p.attempts})</span>
                  </button>
                )
              })}
            </div>

            {selected && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <div className="rounded-2xl bg-duo-mist px-4 py-3">
                  <div className="text-xs font-extrabold uppercase tracking-wide text-duo-mute">Số lần tập</div>
                  <div className="mt-1 text-xl font-black text-duo-ink">
                    {selected.attempts}
                    <span className="ml-1 text-xs font-bold text-duo-mute">({selected.scoredAttempts} được chấm)</span>
                  </div>
                </div>
                <div className="rounded-2xl bg-duo-mist px-4 py-3">
                  <div className="text-xs font-extrabold uppercase tracking-wide text-duo-mute">Điểm cao nhất</div>
                  <div className="mt-1 flex items-center gap-2 text-xl font-black text-duo-ink">
                    {selected.best ? selected.best.overall : '—'}
                    {selected.best && <Stars value={selected.best.stars} />}
                  </div>
                </div>
                <div className="col-span-2 rounded-2xl bg-duo-mist px-4 py-3 sm:col-span-1">
                  <div className="text-xs font-extrabold uppercase tracking-wide text-duo-mute">Lần gần nhất</div>
                  <div className="mt-1 text-sm font-black text-duo-ink">
                    {selected.last ? formatDateTime(selected.last.at) : '—'}
                  </div>
                  {selected.last && (
                    <div className="text-xs font-bold text-duo-mute">
                      {selected.last.overall !== null ? `${selected.last.overall} điểm` : SESSION_STATUS_LABEL[selected.last.status]}
                    </div>
                  )}
                </div>
              </div>
            )}

            {selected && <ExerciseProgressChart key={selected.exercise.id} progress={selected} showDisclaimer={false} />}
          </>
        )}

        {state.sessions.length > 0 && (
          <div>
            <div className="mb-2 text-xs font-extrabold uppercase tracking-wide text-duo-mute">Lượt tập gần đây</div>
            <div className="space-y-1">
              {state.sessions.map((s) => (
                <Link
                  key={s.id}
                  to={`/exercise-sessions/${s.id}`}
                  className="flex items-center gap-3 rounded-2xl px-3 py-2.5 hover:bg-duo-mist"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-extrabold text-duo-ink">{s.exercise.title}</div>
                    <div className="text-xs font-bold text-duo-mute">
                      {formatDateTime(s.createdAt)}
                      {s.status === 'QUEUED' && s.queuePosition ? ` • còn ${s.queuePosition} video trước` : ''}
                    </div>
                  </div>
                  <SessionOutcome session={s} />
                  <ChevronRight className="h-4 w-4 flex-shrink-0 text-duo-mute" />
                </Link>
              ))}
            </div>
          </div>
        )}

        <p className="text-xs font-semibold leading-relaxed text-duo-mute">{EXERCISE_DISCLAIMER}</p>
      </div>
    </Card>
  )
}
