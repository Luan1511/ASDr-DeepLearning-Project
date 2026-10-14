import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ChevronDown, Loader2, Pencil, RotateCcw, ShieldAlert, ShieldCheck, Trash2, Video } from 'lucide-react'
import { DashboardLayout } from '../layouts/DashboardLayout'
import { Card } from '../components/Card'
import { ChildAvatar } from '../components/ChildAvatar'
import { ChildForm, type ChildFormValues } from '../components/ChildForm'
import { GaitTrendChart } from '../components/GaitTrendChart'
import { RiskPill } from '../components/RiskPill'
import { ScreeningResultView } from '../components/ScreeningResultView'
import { ChildQuestionnairesSection } from '../components/children/ChildQuestionnairesSection'
import { ChildExercisesSection } from '../components/children/ChildExercisesSection'
import { api, apiErrorCode } from '../lib/api'
import { childApiErrorMessage } from '../lib/children'
import {
  GAIT_VIEW_LABEL,
  GENDER_LABEL,
  QUALITY_LABEL,
  SCREENING_STATUS_LABEL,
  formatAge,
  formatBirthDate,
  formatDate,
  formatDateTime,
} from '../lib/format'
import type { ChildDetail, ChildScreening } from '../lib/types'

const POLL_INTERVAL_MS = 4000

function loadFailure(error: unknown) {
  const code = apiErrorCode(error)
  return code === 'CHILD_NOT_FOUND' || code === 'VALIDATION_ERROR'
    ? { notFound: true, message: null }
    : { notFound: false, message: childApiErrorMessage(error, 'Không tải được hồ sơ trẻ.') }
}

function StatTile({ label, value, extra }: { label: string; value: string; extra?: ReactNode }) {
  return (
    <div className="card-duo px-5 py-4">
      <div className="text-xs font-extrabold uppercase tracking-wide text-duo-mute">{label}</div>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <span className="text-2xl font-black text-duo-ink">{value}</span>
        {extra}
      </div>
    </div>
  )
}

function SessionRow({
  screening,
  index,
  open,
  busy,
  onToggle,
  onDelete,
  onRetry,
}: {
  screening: ChildScreening
  index: number
  open: boolean
  busy: boolean
  onToggle: () => void
  onDelete: () => void
  onRetry: () => void
}) {
  const s = screening
  const gait = s.result?.gaitFeatures
  const status = s.result ? (
    <RiskPill risk={s.result.riskLevel} />
  ) : s.status === 'FAILED' ? (
    <span className="text-xs font-extrabold text-duo-red">Lỗi</span>
  ) : null
  return (
    <div className={['rounded-2xl transition-all', open ? 'shadow-card-inner' : ''].join(' ')}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left hover:bg-duo-mist"
      >
        <div className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-full bg-white text-xs font-black text-duo-mute shadow-chip">
          {index}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-extrabold text-duo-ink">{formatDateTime(s.createdAt)}</div>
          <div className="mt-0.5 text-xs font-bold text-duo-mute">
            {s.result ? SCREENING_STATUS_LABEL.COMPLETED : SCREENING_STATUS_LABEL[s.status]}
            {gait && ` • ${GAIT_VIEW_LABEL[gait.view]} • ${QUALITY_LABEL[gait.quality.level]}`}
          </div>
          {status && <div className="mt-1.5 sm:hidden">{status}</div>}
        </div>
        {s.status === 'PROCESSING' && <Loader2 className="h-4 w-4 animate-spin text-duo-green-dark" />}
        {status && <div className="hidden flex-shrink-0 sm:block">{status}</div>}
        <ChevronDown className={['h-4 w-4 flex-shrink-0 text-duo-mute transition-transform', open ? 'rotate-180' : ''].join(' ')} />
      </button>

      {open && (
        <div className="space-y-4 px-4 pb-4">
          {s.result && <ScreeningResultView result={s.result} />}

          {!s.result && s.status === 'PROCESSING' && (
            <div className="rounded-2xl bg-white px-4 py-3 text-sm font-bold text-duo-green-dark">
              {s.job?.status === 'QUEUED' ? 'Đang chờ đến lượt phân tích.' : 'Đang phân tích...'}
              {s.errorMessage && <div className="mt-1 text-xs font-semibold text-yellow-800">{s.errorMessage}</div>}
            </div>
          )}

          {!s.result && s.status === 'FAILED' && (
            <div className="space-y-3">
              <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-semibold text-duo-red">{s.errorMessage ?? 'Phân tích thất bại.'}</div>
              {!s.rawVideoDeleted && (
                <button type="button" className="btn-duo-secondary" disabled={busy} onClick={onRetry}>
                  <RotateCcw className="h-4 w-4" />
                  Thử phân tích lại
                </button>
              )}
            </div>
          )}

          {!s.result && s.status === 'UPLOADED' && (
            <div className="space-y-3">
              <div className="rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-duo-ink">
                Video đã tải lên nhưng chưa được gửi phân tích.
              </div>
              <button type="button" className="btn-duo-secondary" disabled={busy} onClick={onRetry}>
                Gửi phân tích
              </button>
            </div>
          )}

          <div className="flex justify-end">
            <button
              type="button"
              className="inline-flex items-center gap-1.5 text-xs font-extrabold text-duo-red hover:underline disabled:opacity-50"
              disabled={busy || s.status === 'PROCESSING'}
              title={s.status === 'PROCESSING' ? 'Đợi phân tích xong rồi mới xoá được.' : undefined}
              onClick={onDelete}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Xoá lượt sàng lọc này
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export function ChildDetailPage() {
  const { id = '' } = useParams()
  // Remount per child so no state leaks between profiles.
  return <ChildDetail key={id} id={id} />
}

function ChildDetail({ id }: { id: string }) {
  const navigate = useNavigate()
  const [data, setData] = useState<ChildDetail | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [confirmName, setConfirmName] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const applyFailure = useCallback((error: unknown) => {
    const failure = loadFailure(error)
    setNotFound(failure.notFound)
    setLoadError(failure.message)
  }, [])

  /** Refresh after an action or while a screening is being analysed. */
  const load = useCallback(async () => {
    try {
      const res = await api.get(`/children/${id}`)
      setData(res.data)
      setLoadError(null)
    } catch (e) {
      applyFailure(e)
    }
  }, [id, applyFailure])

  useEffect(() => {
    let stale = false
    api.get(`/children/${id}`).then(
      (res) => !stale && setData(res.data),
      (e) => !stale && applyFailure(e),
    )
    return () => {
      stale = true
    }
  }, [id, applyFailure])

  const processing = Boolean(data?.screenings.some((s) => s.status === 'PROCESSING'))
  useEffect(() => {
    if (!processing) return
    const timer = window.setInterval(() => void load(), POLL_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [processing, load])

  async function save(values: ChildFormValues) {
    setSaving(true)
    setFormError(null)
    try {
      await api.patch(`/children/${id}`, { ...values, note: values.note || null })
      await load()
      setEditing(false)
    } catch (e) {
      setFormError(childApiErrorMessage(e, 'Không lưu được thay đổi. Vui lòng thử lại.'))
    } finally {
      setSaving(false)
    }
  }

  async function deleteScreening(s: ChildScreening) {
    const when = formatDateTime(s.createdAt)
    if (
      !window.confirm(
        `Xoá vĩnh viễn lượt sàng lọc lúc ${when}?\n\nKết quả, dữ liệu khung xương trên máy chủ phân tích và video (nếu còn) sẽ bị xoá, không khôi phục được.`,
      )
    ) {
      return
    }
    setBusyId(s.id)
    setActionError(null)
    try {
      await api.delete(`/screenings/${s.id}`)
      setOpenId(null)
      await load()
    } catch (e) {
      setActionError(childApiErrorMessage(e, 'Không xoá được lượt sàng lọc. Vui lòng thử lại.'))
    } finally {
      setBusyId(null)
    }
  }

  async function retry(s: ChildScreening) {
    setBusyId(s.id)
    setActionError(null)
    try {
      await api.post(`/screenings/${s.id}/process`)
      await load()
    } catch (e) {
      setActionError(
        apiErrorCode(e) === 'CONSENT_REQUIRED'
          ? 'Cần xác nhận đồng ý của phụ huynh (ở trang Sàng lọc) trước khi phân tích lại.'
          : 'Không gửi lại được yêu cầu phân tích.',
      )
    } finally {
      setBusyId(null)
    }
  }

  async function deleteChild() {
    if (!data) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await api.delete(`/children/${id}`)
      navigate('/children', { replace: true, state: { deletedName: data.child.fullName } })
    } catch (e) {
      setDeleteError(childApiErrorMessage(e, 'Không xoá được hồ sơ. Vui lòng thử lại.'))
      setDeleting(false)
    }
  }

  if (notFound) {
    return (
      <DashboardLayout>
        <div className="card-duo mx-auto max-w-lg px-6 py-10 text-center">
          <div className="text-base font-black text-duo-ink">Không tìm thấy hồ sơ trẻ</div>
          <p className="mt-1 text-sm font-semibold text-duo-mute">Hồ sơ có thể đã bị xoá hoặc không thuộc tài khoản của bạn.</p>
          <Link to="/children" className="btn-duo mt-5">
            Về danh sách hồ sơ
          </Link>
        </div>
      </DashboardLayout>
    )
  }

  const child = data?.child
  const summary = child?.summary
  const screenings = data?.screenings ?? []
  const nameMatches = Boolean(child) && confirmName.trim().toLowerCase() === child!.fullName.trim().toLowerCase()

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <Link to="/children" className="link-duo inline-flex items-center gap-1.5 text-xs">
          <ArrowLeft className="h-4 w-4" />
          Hồ sơ trẻ
        </Link>

        {loadError && <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-bold text-duo-red">{loadError}</div>}
        {!data && !loadError && <div className="text-sm font-semibold text-duo-mute">Đang tải...</div>}

        {data && child && (
          <>
            <div className="card-duo p-6">
              {editing ? (
                <>
                  <div className="mb-4 text-sm font-extrabold uppercase tracking-wide text-duo-ink">Sửa hồ sơ</div>
                  <ChildForm
                    initial={child}
                    submitLabel="Lưu thay đổi"
                    submitting={saving}
                    error={formError}
                    onSubmit={save}
                    onCancel={() => {
                      setEditing(false)
                      setFormError(null)
                    }}
                  />
                </>
              ) : (
                <div className="flex flex-wrap items-start gap-4">
                  <ChildAvatar name={child.fullName} size="lg" />
                  <div className="min-w-0 flex-1">
                    <h1 className="text-2xl font-black text-duo-ink">{child.fullName}</h1>
                    <div className="mt-1 text-sm font-bold text-duo-mute">
                      {formatAge(child.dateOfBirth)} • sinh {formatBirthDate(child.dateOfBirth)}
                      {child.gender !== 'UNSPECIFIED' && ` • ${GENDER_LABEL[child.gender]}`}
                    </div>
                    {child.note && <p className="mt-2 whitespace-pre-line text-sm font-semibold text-duo-ink">{child.note}</p>}
                    <div
                      className={[
                        'mt-3 flex items-center gap-1.5 text-xs font-bold',
                        data.consent ? 'text-duo-green-dark' : 'text-yellow-800',
                      ].join(' ')}
                    >
                      {data.consent ? <ShieldCheck className="h-4 w-4" /> : <ShieldAlert className="h-4 w-4" />}
                      {data.consent
                        ? `Đã có đồng ý xử lý video từ ${formatDate(data.consent.grantedAt)}`
                        : 'Chưa có đồng ý xử lý video — xác nhận ở bước sàng lọc trước khi tải video.'}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Link to={`/screening?childId=${child.id}`} className="btn-duo">
                      <Video className="h-4 w-4" />
                      Sàng lọc mới
                    </Link>
                    <button type="button" className="btn-duo-secondary" onClick={() => setEditing(true)}>
                      <Pencil className="h-4 w-4" />
                      Sửa
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <StatTile label="Lần sàng lọc" value={String(summary?.screeningCount ?? screenings.length)} />
              <StatTile label="Có kết quả" value={String(summary?.completedCount ?? 0)} />
              <div className="col-span-2 sm:col-span-1">
                <StatTile
                  label="Kết quả gần nhất"
                  value={summary?.lastResult ? formatDate(summary.lastResult.screenedAt) : '—'}
                  extra={summary?.lastResult ? <RiskPill risk={summary.lastResult.riskLevel} /> : undefined}
                />
              </div>
            </div>

            <Card title="Xu hướng chỉ số dáng đi">
              <GaitTrendChart screenings={screenings} />
            </Card>

            <Card title="Các lần sàng lọc">
              {actionError && <div className="mb-3 rounded-2xl bg-red-50 px-4 py-3 text-sm font-bold text-duo-red">{actionError}</div>}
              {screenings.length === 0 ? (
                <div className="py-6 text-center text-sm font-semibold text-duo-mute">
                  Chưa có lần sàng lọc nào.{' '}
                  <Link to={`/screening?childId=${child.id}`} className="link-duo">
                    Bắt đầu sàng lọc
                  </Link>
                </div>
              ) : (
                <div className="space-y-1">
                  {screenings.map((s, i) => (
                    <SessionRow
                      key={s.id}
                      screening={s}
                      index={screenings.length - i}
                      open={openId === s.id}
                      busy={busyId === s.id}
                      onToggle={() => setOpenId((current) => (current === s.id ? null : s.id))}
                      onDelete={() => void deleteScreening(s)}
                      onRetry={() => void retry(s)}
                    />
                  ))}
                </div>
              )}
              <p className="mt-3 text-xs font-bold text-duo-mute">Kết quả chỉ tham khảo, không thay thế chẩn đoán y khoa.</p>
            </Card>

            {/* Each renders nothing while its feature is off for this user. */}
            <ChildQuestionnairesSection childId={child.id} childName={child.fullName} dateOfBirth={child.dateOfBirth} />
            <ChildExercisesSection childId={child.id} childName={child.fullName} />

            <div className="card-duo p-5">
              <div className="text-sm font-extrabold uppercase tracking-wide text-duo-red">Xoá hồ sơ và dữ liệu</div>
              <p className="mt-2 text-sm font-semibold leading-relaxed text-duo-ink">
                Xoá vĩnh viễn hồ sơ của trẻ cùng mọi lần sàng lọc, kết quả, lượt tập, câu trả lời bảng hỏi, xác nhận đồng ý, video
                còn lưu trên máy chủ và dữ liệu khung xương trên máy chủ phân tích. Không thể khôi phục.
              </p>
              {!confirmingDelete ? (
                <button
                  type="button"
                  className="btn-duo-secondary mt-4 !text-duo-red"
                  onClick={() => {
                    setConfirmingDelete(true)
                    setConfirmName('')
                    setDeleteError(null)
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                  Xoá hồ sơ…
                </button>
              ) : (
                <div className="mt-4 space-y-3 rounded-2xl bg-red-50 p-4">
                  <label className="block">
                    <span className="mb-1 block text-xs font-extrabold uppercase tracking-wide text-duo-red">
                      Nhập tên trẻ “{child.fullName}” để xác nhận
                    </span>
                    <input className="input-duo" value={confirmName} onChange={(e) => setConfirmName(e.target.value)} autoComplete="off" />
                  </label>
                  {deleteError && <div className="text-sm font-bold text-duo-red">{deleteError}</div>}
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="inline-flex items-center justify-center gap-2 rounded-2xl bg-duo-red px-5 py-3 text-sm font-extrabold uppercase tracking-wide text-white transition-all disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={!nameMatches || deleting || processing}
                      onClick={() => void deleteChild()}
                    >
                      {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                      {deleting ? 'Đang xoá...' : 'Xoá vĩnh viễn'}
                    </button>
                    <button type="button" className="btn-duo-secondary" disabled={deleting} onClick={() => setConfirmingDelete(false)}>
                      Huỷ
                    </button>
                  </div>
                  {processing && (
                    <div className="text-xs font-bold text-duo-red">Đang có video được phân tích; đợi phân tích xong rồi mới xoá được.</div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  )
}
