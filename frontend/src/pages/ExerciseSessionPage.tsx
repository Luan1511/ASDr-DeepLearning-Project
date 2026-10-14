import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Loader2, PersonStanding, RefreshCw, Trash2 } from 'lucide-react'
import { DashboardLayout } from '../layouts/DashboardLayout'
import { Card } from '../components/Card'
import { ImitationResultView } from '../components/exercise/ImitationResultView'
import { apiErrorCode } from '../lib/api'
import {
  EXERCISE_DISCLAIMER,
  PRACTICE_MODE_LABEL,
  SESSION_STATUS_LABEL,
  deleteExerciseSession,
  exerciseApiErrorMessage,
  fetchExerciseSession,
  retryExerciseSession,
} from '../lib/exercises'
import type { ExerciseSessionDto } from '../lib/exerciseTypes'
import { formatDateTime, formatNumber } from '../lib/format'

const POLL_INTERVAL_MS = 3000

const isPending = (s: ExerciseSessionDto) => s.status === 'QUEUED' || s.status === 'PROCESSING'

function StatusPill({ session }: { session: ExerciseSessionDto }) {
  const cls = isPending(session)
    ? 'bg-duo-green-soft text-duo-green-dark'
    : session.status === 'SCORED'
      ? 'bg-duo-green-soft text-duo-green-dark'
      : session.status === 'FAILED'
        ? 'bg-red-50 text-duo-red'
        : 'bg-duo-mist text-duo-mute'
  return (
    <span className={['inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-extrabold', cls].join(' ')}>
      {isPending(session) && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      {SESSION_STATUS_LABEL[session.status]}
    </span>
  )
}

/** Parent detail of one practice attempt: experimental score, per-part result, retry and delete. */
export function ExerciseSessionPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [session, setSession] = useState<ExerciseSessionDto | null>(null)
  const [loadError, setLoadError] = useState<{ notFound: boolean; message: string } | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'retry' | 'delete' | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let stale = false
    fetchExerciseSession(id).then(
      (s) => {
        if (stale) return
        setSession(s)
        setLoadError(null)
      },
      (e: unknown) => {
        if (stale) return
        const notFound = apiErrorCode(e) === 'SESSION_NOT_FOUND'
        // A failed background refresh keeps the attempt on screen.
        setSession((prev) => (prev && !notFound ? prev : null))
        setLoadError({ notFound, message: exerciseApiErrorMessage(e, 'Không tải được lượt tập.') })
      },
    )
    return () => {
      stale = true
    }
  }, [id, tick])

  const pending = session ? isPending(session) : false
  useEffect(() => {
    if (!pending) return
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') setTick((t) => t + 1)
    }, POLL_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [pending])

  async function retry() {
    if (!session) return
    setBusy('retry')
    setActionError(null)
    try {
      setSession(await retryExerciseSession(session.id))
    } catch (e) {
      setActionError(exerciseApiErrorMessage(e, 'Chưa gửi lại được yêu cầu chấm. Vui lòng thử lại.'))
    } finally {
      setBusy(null)
    }
  }

  async function remove() {
    if (!session) return
    if (!window.confirm('Xoá lượt tập này? Điểm, nhận xét và dữ liệu còn lại trên máy chủ phân tích sẽ bị xoá vĩnh viễn.')) return
    setBusy('delete')
    setActionError(null)
    try {
      await deleteExerciseSession(session.id)
      navigate(`/children/${session.childId}`, { replace: true })
    } catch (e) {
      setActionError(exerciseApiErrorMessage(e, 'Không xoá được lượt tập. Vui lòng thử lại.'))
      setBusy(null)
    }
  }

  const childHref = session ? `/children/${session.childId}` : '/children'

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-3">
          <Link to={childHref} className="btn-duo-ghost !px-3 !py-2" aria-label="Về hồ sơ của con">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-2xl font-black text-duo-ink">{session ? session.exercise.title : 'Lượt tập'}</h1>
            {session && <div className="text-sm font-semibold text-duo-mute">{formatDateTime(session.createdAt)}</div>}
          </div>
          {session && <StatusPill session={session} />}
        </div>

        {!session && !loadError && (
          <div className="flex items-center gap-2 text-sm font-semibold text-duo-mute">
            <Loader2 className="h-4 w-4 animate-spin" />
            Đang tải...
          </div>
        )}

        {loadError && (
          <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-bold text-duo-red">
            {loadError.message}
            {!loadError.notFound && !session && (
              <button type="button" className="btn-duo-secondary ml-3 !px-3 !py-2" onClick={() => setTick((t) => t + 1)}>
                Thử lại
              </button>
            )}
          </div>
        )}

        {session && (
          <>
            <Card title="Kết quả luyện tập">
              {session.score ? (
                <ImitationResultView score={session.score} view="parent" />
              ) : pending ? (
                <div className="space-y-2 text-sm font-semibold leading-relaxed text-duo-ink">
                  <div className="flex items-center gap-2 font-extrabold">
                    <Loader2 className="h-4 w-4 animate-spin text-duo-green" />
                    Bạn Mầm đang xem con tập… (thường mất 1–3 phút)
                  </div>
                  {session.status === 'QUEUED' && (session.queuePosition || session.mlBusy) && (
                    <div className="text-duo-mute">
                      {session.queuePosition
                        ? `Máy phân tích đang bận xử lý video khác, bài của con đang chờ (còn ${session.queuePosition} video trước).`
                        : 'Máy phân tích đang bận xử lý video khác, bài của con đang chờ.'}
                    </div>
                  )}
                  {session.errorMessage && <div className="text-yellow-800">{session.errorMessage}</div>}
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="rounded-2xl bg-duo-mist px-4 py-3 text-sm font-semibold leading-relaxed text-duo-ink">
                    {session.errorMessage ?? 'Chưa chấm được do sự cố kỹ thuật. Bấm “Thử chấm lại” hoặc tập lại sau.'}
                  </div>
                  {session.retryable ? (
                    <button type="button" className="btn-duo-secondary" disabled={busy !== null} onClick={() => void retry()}>
                      {busy === 'retry' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                      Thử chấm lại
                    </button>
                  ) : (
                    <div className="text-xs font-bold text-duo-mute">Video không còn trên máy chủ; hãy cho con tập lại lần mới.</div>
                  )}
                  <p className="text-xs font-semibold leading-relaxed text-duo-mute">{EXERCISE_DISCLAIMER}</p>
                </div>
              )}
            </Card>

            <Card title="Thông tin lượt tập">
              <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                <div className="flex justify-between gap-3">
                  <dt className="font-bold text-duo-mute">Cách tập</dt>
                  <dd className="text-right font-extrabold text-duo-ink">{PRACTICE_MODE_LABEL[session.practiceMode]}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="font-bold text-duo-mute">Nguồn video</dt>
                  <dd className="text-right font-extrabold text-duo-ink">
                    {session.recordedVia === 'WEBCAM' ? 'Quay bằng camera' : 'Video tải lên'}
                  </dd>
                </div>
                {session.practiceMode === 'FOLLOW_ALONG' && (
                  <div className="flex justify-between gap-3">
                    <dt className="font-bold text-duo-mute">Tốc độ bạn Mầm</dt>
                    <dd className="text-right font-extrabold text-duo-ink">{session.playbackRate < 1 ? 'Chậm hơn' : 'Bình thường'}</dd>
                  </div>
                )}
                {session.durationMs !== null && (
                  <div className="flex justify-between gap-3">
                    <dt className="font-bold text-duo-mute">Độ dài video</dt>
                    <dd className="text-right font-extrabold text-duo-ink">{formatNumber(session.durationMs / 1000, 0)} giây</dd>
                  </div>
                )}
                <div className="flex justify-between gap-3">
                  <dt className="font-bold text-duo-mute">Phiên bản bài mẫu</dt>
                  <dd className="text-right font-extrabold text-duo-ink">v{session.templateVersion}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="font-bold text-duo-mute">Video gốc</dt>
                  <dd className="text-right font-extrabold text-duo-ink">{session.rawVideoDeleted ? 'Đã xoá' : 'Đang giữ tạm để chấm'}</dd>
                </div>
              </dl>
              <p className="mt-3 text-xs font-semibold leading-relaxed text-duo-mute">
                Điểm chỉ so sánh được giữa các lần tập cùng một bài và cùng phiên bản bài mẫu.
              </p>
            </Card>

            {actionError && <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-bold text-duo-red">{actionError}</div>}

            <div className="flex flex-wrap items-center gap-3">
              <Link
                to={`/exercises/${session.exercise.id}/practice?childId=${encodeURIComponent(session.childId)}`}
                className="btn-duo"
              >
                <PersonStanding className="h-4 w-4" />
                Tập lại bài này
              </Link>
              <Link to={childHref} className="btn-duo-secondary">
                Về hồ sơ của con
              </Link>
              <button
                type="button"
                className="btn-duo-ghost !text-duo-red"
                disabled={busy !== null || session.status === 'PROCESSING'}
                title={session.status === 'PROCESSING' ? 'Đợi chấm xong rồi xoá' : undefined}
                onClick={() => void remove()}
              >
                {busy === 'delete' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                Xoá lượt tập
              </button>
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  )
}
