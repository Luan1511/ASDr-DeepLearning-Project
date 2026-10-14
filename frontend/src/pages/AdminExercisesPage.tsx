import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronRight, Loader2, Plus, RefreshCw, Sparkles, Video } from 'lucide-react'
import { DashboardLayout } from '../layouts/DashboardLayout'
import { Card } from '../components/Card'
import {
  BODY_FOCUS_LABEL,
  DIFFICULTY_LABEL,
  adminCreateExercise,
  adminFetchExerciseQueue,
  adminFetchExercises,
  adminSyncBuiltins,
  exerciseApiErrorMessage,
  type ExerciseMetadataInput,
} from '../lib/exercises'
import type { AdminExerciseDto, AdminExerciseQueueDto, ExerciseMode } from '../lib/exerciseTypes'
import { useExerciseCapabilities } from '../lib/useExerciseCapabilities'
import { ExerciseMetadataForm, ExerciseStatusPill } from '../components/exercise/ExerciseMetadataForm'
import { formatDateTime, formatPercent } from '../lib/format'

const MODE_TEXT: Record<ExerciseMode, string> = {
  off: 'Tắt — không ai dùng được bài tập và hàng đợi chấm điểm dừng.',
  admin_only: 'Chỉ admin — phụ huynh chưa thấy bài tập (mặc định cho tới khi hiệu chỉnh C1 đạt).',
  on: 'Mở cho phụ huynh — chỉ các bài đã xuất bản hiển thị.',
}

function QueueStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl bg-duo-mist px-3 py-2.5">
      <div className="text-[11px] font-extrabold uppercase tracking-wide text-duo-mute">{label}</div>
      <div className="text-xl font-black tabular-nums text-duo-ink">{value}</div>
    </div>
  )
}

function ExerciseRow({ exercise }: { exercise: AdminExerciseDto }) {
  const current = exercise.templates.find((t) => t.isCurrent)
  return (
    <Link to={`/admin/exercises/${exercise.id}`} className="card-duo-interactive flex items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-extrabold text-duo-ink">{exercise.title}</span>
          <ExerciseStatusPill status={exercise.status} />
          {exercise.source === 'BUILTIN_SYNTHETIC' && (
            <span className="rounded-full bg-duo-mist px-2 py-0.5 text-[11px] font-extrabold text-duo-mute">Tổng hợp</span>
          )}
        </div>
        <div className="mt-0.5 text-xs font-bold text-duo-mute">
          {exercise.slug} • {DIFFICULTY_LABEL[exercise.difficulty]} • {exercise.bodyFocus.map((f) => BODY_FOCUS_LABEL[f]).join(', ') || '—'}
          {' • '}thứ tự {exercise.sortOrder}
        </div>
        <div className="text-xs font-bold text-duo-mute">
          {current ? `Đang dùng phiên bản ${current.version}` : 'Chưa có phiên bản xuất bản'} • {exercise.templates.length} phiên bản •{' '}
          {exercise.stats.attempts} lượt tập
          {exercise.stats.attempts > 0 && ` • chưa nhìn rõ ${formatPercent(exercise.stats.insufficientRate)}`}
        </div>
      </div>
      <ChevronRight className="h-4 w-4 flex-shrink-0 text-duo-mute" />
    </Link>
  )
}

export function AdminExercisesPage() {
  const navigate = useNavigate()
  const caps = useExerciseCapabilities()
  const [exercises, setExercises] = useState<AdminExerciseDto[] | null>(null)
  const [queue, setQueue] = useState<AdminExerciseQueueDto | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [queueError, setQueueError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [creating, setCreating] = useState(false)
  const [createBusy, setCreateBusy] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncMessage, setSyncMessage] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    let active = true
    adminFetchExercises().then(
      (list) => {
        if (!active) return
        setExercises([...list].sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title, 'vi')))
        setLoadError(null)
      },
      (err: unknown) => active && setLoadError(exerciseApiErrorMessage(err, 'Không tải được danh sách bài tập.')),
    )
    adminFetchExerciseQueue().then(
      (q) => {
        if (!active) return
        setQueue(q)
        setQueueError(null)
      },
      (err: unknown) => active && setQueueError(exerciseApiErrorMessage(err, 'Không tải được hàng đợi chấm điểm.')),
    )
    return () => {
      active = false
    }
  }, [reloadKey])

  async function create(values: Required<ExerciseMetadataInput>) {
    setCreateBusy(true)
    setCreateError(null)
    try {
      const exercise = await adminCreateExercise(values)
      navigate(`/admin/exercises/${exercise.id}`)
    } catch (err) {
      setCreateError(exerciseApiErrorMessage(err, 'Không tạo được bài tập.'))
      setCreateBusy(false)
    }
  }

  async function syncBuiltins() {
    setSyncing(true)
    setSyncMessage(null)
    try {
      const r = await adminSyncBuiltins()
      setSyncMessage({
        ok: true,
        text: `Đã đồng bộ: ${r.created} bài mới, ${r.newVersions} phiên bản mới, ${r.unchanged} không đổi. Bài mẫu tổng hợp ở trạng thái nháp — cần xuất bản thủ công.`,
      })
      setReloadKey((k) => k + 1)
    } catch (err) {
      setSyncMessage({ ok: false, text: exerciseApiErrorMessage(err, 'Không đồng bộ được bài mẫu tổng hợp.') })
    } finally {
      setSyncing(false)
    }
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <Card
          title="Admin – Bài tập bắt chước"
          right={
            <button type="button" className="link-duo text-xs" onClick={() => setReloadKey((k) => k + 1)}>
              Tải lại
            </button>
          }
        >
          <div className="space-y-4">
            <div className="rounded-2xl bg-duo-mist px-4 py-3 text-sm font-semibold text-duo-ink">
              <span className="font-extrabold">Chế độ EXERCISE_MODE: </span>
              {caps ? MODE_TEXT[caps.mode] : 'Đang kiểm tra...'}
              {caps && !caps.mlReachable && (
                <div className="mt-1 text-xs font-bold text-duo-red">Không kết nối được máy chủ phân tích.</div>
              )}
              {caps?.mlReachable && caps.mlLegacy && (
                <div className="mt-1 text-xs font-bold text-yellow-900">
                  Máy phân tích đang chạy bản cũ (không báo fps, không nhận .webm). Cần nhập fps cho video mẫu nếu được hỏi.
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-duo" onClick={() => setCreating((v) => !v)}>
                <Plus className="h-4 w-4" />
                Tạo bài tập
              </button>
              <button type="button" className="btn-duo-secondary" disabled={syncing} onClick={() => void syncBuiltins()}>
                {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                Đồng bộ bài mẫu tổng hợp
              </button>
              <Link to="/admin/exercises/recorder-probe" className="btn-duo-secondary">
                <Video className="h-4 w-4" />
                Thử ghi hình (G0)
              </Link>
            </div>
            {syncMessage && (
              <div
                className={[
                  'rounded-2xl px-4 py-3 text-sm font-bold',
                  syncMessage.ok ? 'bg-duo-green-soft text-duo-green-dark' : 'bg-red-50 text-duo-red',
                ].join(' ')}
              >
                {syncMessage.text}
              </div>
            )}
            <p className="text-xs font-semibold leading-relaxed text-duo-mute">
              Điểm luyện tập chỉ để khích lệ trẻ, không phải kết quả sàng lọc. Video mẫu chỉ được quay với người lớn trong nhóm đã
              đồng ý; không dùng video trẻ em làm mẫu.
            </p>
          </div>
        </Card>

        {creating && (
          <Card title="Tạo bài tập mới (nháp)">
            <ExerciseMetadataForm
              submitLabel="Tạo bài tập"
              submitting={createBusy}
              error={createError}
              onSubmit={(values) => void create(values)}
              onCancel={() => setCreating(false)}
            />
          </Card>
        )}

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_380px]">
          <Card title="Danh sách bài tập">
            {loadError && <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-bold text-duo-red">{loadError}</div>}
            {!loadError && exercises === null && <div className="text-sm font-semibold text-duo-mute">Đang tải...</div>}
            {exercises?.length === 0 && (
              <div className="py-6 text-center text-sm font-semibold text-duo-mute">
                Chưa có bài tập. Tạo bài mới hoặc đồng bộ 6 bài mẫu tổng hợp.
              </div>
            )}
            <div className="space-y-2">
              {(exercises ?? []).map((e) => (
                <ExerciseRow key={e.id} exercise={e} />
              ))}
            </div>
          </Card>

          <Card
            title="Hàng đợi chấm điểm"
            right={
              <button type="button" className="link-duo inline-flex items-center gap-1 text-xs" onClick={() => setReloadKey((k) => k + 1)}>
                <RefreshCw className="h-3.5 w-3.5" />
                Làm mới
              </button>
            }
          >
            {queueError && <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-bold text-duo-red">{queueError}</div>}
            {!queueError && !queue && <div className="text-sm font-semibold text-duo-mute">Đang tải...</div>}
            {queue && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-2">
                  <QueueStat label="Đang chờ" value={queue.queued} />
                  <QueueStat label="Đang chấm" value={queue.processing} />
                  <QueueStat label="Lỗi trong 24 giờ" value={queue.failed24h} />
                  <QueueStat label="Chờ dọn trên ML" value={queue.mlCleanupPending} />
                </div>
                {queue.mlCleanupPending > 0 && (
                  <div className="text-xs font-bold text-yellow-900">
                    Có dữ liệu trên máy phân tích chưa xoá được; hệ thống sẽ tự thử lại khi máy phân tích hoạt động.
                  </div>
                )}
                <div>
                  <div className="mb-2 text-xs font-extrabold uppercase tracking-wide text-duo-mute">Lỗi gần đây</div>
                  {queue.recentFailures.length === 0 ? (
                    <div className="text-sm font-semibold text-duo-mute">Không có.</div>
                  ) : (
                    <div className="space-y-2">
                      {queue.recentFailures.map((f) => (
                        <div key={f.id} className="rounded-2xl bg-duo-mist px-3 py-2">
                          <div className="text-xs font-bold text-duo-mute">
                            <span className="font-mono">{f.id.slice(0, 8)}</span> • {formatDateTime(f.createdAt)}
                          </div>
                          {f.lastError && (
                            <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap break-words text-[11px] font-semibold text-duo-red">
                              {f.lastError}
                            </pre>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </Card>
        </div>
      </div>
    </DashboardLayout>
  )
}
