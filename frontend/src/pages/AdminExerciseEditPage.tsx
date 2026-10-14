import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import axios from 'axios'
import {
  Archive,
  ArrowLeft,
  ChartColumn,
  CheckCircle2,
  Eye,
  FileVideo,
  Loader2,
  Pause,
  Play,
  Rocket,
  Table2,
  Trash2,
  Undo2,
  XCircle,
} from 'lucide-react'
import { DashboardLayout } from '../layouts/DashboardLayout'
import { Card } from '../components/Card'
import { UploadDropzone } from '../components/UploadDropzone'
import { GuidePuppet, type GuidePuppetProps } from '../components/exercise/GuidePuppet'
import { TemplateGateList } from '../components/exercise/TemplateGateList'
import { TemplateTrimTimeline, type TrimRange } from '../components/exercise/TemplateTrimTimeline'
import { ExerciseMetadataForm, ExerciseStatusPill } from '../components/exercise/ExerciseMetadataForm'
import { apiErrorCode } from '../lib/api'
import {
  MIRROR_POLICY_LABEL,
  PART_LABEL,
  adminCompileTemplate,
  adminDeleteExercise,
  adminDeleteTemplateSource,
  adminFetchExerciseStats,
  adminFetchExercises,
  adminFetchTemplateGuide,
  adminPublishTemplate,
  adminUpdateExercise,
  adminUploadTemplateSource,
  exerciseApiErrorMessage,
  type CompileTemplateInput,
  type ExerciseMetadataInput,
} from '../lib/exercises'
import type {
  AdminExerciseDto,
  AdminExerciseStatsDto,
  AdminTemplateDto,
  BuildTemplateResultDto,
  MirrorPolicy,
  TemplateGateDto,
} from '../lib/exerciseTypes'
import { useExerciseCapabilities } from '../lib/useExerciseCapabilities'
import { formatDateTime, formatNumber, formatPercent } from '../lib/format'
import { readVideoMetadata } from '../lib/video'

const ATTESTATION_TEXT =
  'Người trong video mẫu là thành viên nhóm (người lớn) đã đồng ý cho dùng khung xương làm động tác mẫu; không phải trẻ em.'
const PUBLISH_TEXT = 'Phiên bản mới áp dụng cho các lần tập sau; điểm cũ giữ theo phiên bản cũ và không so sánh trực tiếp.'

const MIRROR_POLICIES: MirrorPolicy[] = ['EITHER', 'ANATOMICAL_ONLY', 'MIRROR_ONLY']
const BASE_ACCEPT = 'video/mp4,video/quicktime,video/x-matroska,video/x-msvideo,.mp4,.mov,.mkv,.avi'
const WEBM_ACCEPT = ',video/webm,.webm'
const FPS_MIN = 5
const FPS_MAX = 120

const SOURCE_LABEL: Record<string, string> = { ML_SUBJECT: 'Video người lớn làm mẫu', BUILTIN_SYNTHETIC: 'Mẫu tổng hợp' }
const FPS_SOURCE_LABEL: Record<string, string> = { ml: 'máy phân tích', duration: 'theo thời lượng', admin: 'admin nhập', synthetic: 'tổng hợp' }
const REASON_LABEL: Record<string, string> = {
  TOO_FEW_FRAMES: 'Thấy trẻ quá ít khung hình',
  VIDEO_TOO_SHORT: 'Video ngắn hơn bài mẫu',
  ACTIVE_PART_NOT_VISIBLE: 'Bộ phận cử động bị che',
}
const ACCENT = '#166534'
const GRID = '#E5E5E5'

type LoadState = { kind: 'loading' } | { kind: 'notFound' } | { kind: 'error'; message: string } | { kind: 'ready'; exercise: AdminExerciseDto }

type TemplateSource = {
  sourceSubjectId: string
  numFrames: number | null
  fps: number | null
  fpsSource: string | null
  /** Clip length from the browser decoder or frames ÷ fps; null when reusing an older source. */
  clipDurationSec: number | null
  label: string
}

type Preview = { templateId: string; version: number; guide: GuidePuppetProps['guide'] }

const secText = (sec: number) => `${formatNumber(sec, 2)} s`

function errorGates(error: unknown): TemplateGateDto[] | null {
  if (!axios.isAxiosError(error)) return null
  const gates = (error.response?.data as { gates?: unknown } | undefined)?.gates
  return Array.isArray(gates) ? (gates as TemplateGateDto[]) : null
}

function parseFps(text: string): number | null {
  const value = Number(text.replace(',', '.'))
  return text.trim() && Number.isFinite(value) && value >= FPS_MIN && value <= FPS_MAX ? value : null
}

function Section({ step, title, children }: { step: number; title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="grid h-6 w-6 place-items-center rounded-full bg-duo-green-soft text-xs font-black text-duo-green-dark">{step}</span>
        <h3 className="text-sm font-extrabold text-duo-ink">{title}</h3>
      </div>
      <div className="pl-8">{children}</div>
    </section>
  )
}

function ConfirmPublishDialog({
  version,
  hasCurrent,
  busy,
  onConfirm,
  onCancel,
}: {
  version: number
  hasCurrent: boolean
  busy: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4"
      onKeyDown={(e) => e.key === 'Escape' && !busy && onCancel()}
    >
      <div role="dialog" aria-modal="true" aria-labelledby="publish-title" className="card-duo w-full max-w-md space-y-4 p-6">
        <div id="publish-title" className="text-lg font-black text-duo-ink">
          Xuất bản phiên bản {version}?
        </div>
        <p className="text-sm font-semibold leading-relaxed text-duo-ink">{PUBLISH_TEXT}</p>
        {hasCurrent && (
          <p className="text-xs font-bold text-duo-mute">
            Các lượt tập đang chờ chấm vẫn được chấm theo phiên bản trẻ đã tập; ứng dụng phụ huynh sẽ yêu cầu tải lại bài.
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="btn-duo-secondary" disabled={busy} onClick={onCancel}>
            Huỷ
          </button>
          <button type="button" className="btn-duo" disabled={busy} onClick={onConfirm} autoFocus>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
            Xuất bản
          </button>
        </div>
      </div>
    </div>
  )
}

function TemplateCard({
  template,
  busy,
  previewing,
  onPreview,
  onPublish,
  onDeleteSource,
}: {
  template: AdminTemplateDto
  busy: boolean
  previewing: boolean
  onPreview: () => void
  onPublish: () => void
  onDeleteSource: () => void
}) {
  const [showGates, setShowGates] = useState(false)
  const t = template
  const failed = t.quality.filter((g) => !g.ok).length
  return (
    <div className={['rounded-2xl px-4 py-3', t.isCurrent ? 'bg-duo-green-soft/40 shadow-ring-green' : 'bg-duo-mist'].join(' ')}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-black text-duo-ink">Phiên bản {t.version}</span>
            {t.isCurrent && (
              <span className="rounded-full bg-duo-green px-2 py-0.5 text-[11px] font-extrabold text-white">Đang dùng</span>
            )}
            <span
              className={[
                'flex items-center gap-1 text-xs font-extrabold',
                failed === 0 ? 'text-duo-green-dark' : 'text-duo-red',
              ].join(' ')}
            >
              {failed === 0 ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
              {failed === 0 ? 'Đạt chất lượng' : `Chưa đạt ${failed} tiêu chí`}
            </span>
          </div>
          <div className="text-xs font-bold text-duo-mute">
            {SOURCE_LABEL[t.source] ?? t.source} • {MIRROR_POLICY_LABEL[t.mirrorPolicy]}
            {t.lateralized ? ' • động tác một bên' : ''}
          </div>
          <div className="text-xs font-bold tabular-nums text-duo-mute">
            Đoạn {secText(t.activeStartSec)} → {secText(t.activeEndSec)} • dài {secText(t.durationSec)} • {formatNumber(t.sourceFps, 2)} fps (
            {FPS_SOURCE_LABEL[t.fpsSource] ?? t.fpsSource})
          </div>
          <div className="text-xs font-bold text-duo-mute">
            Bộ phận cử động: {t.activeParts.map((p) => PART_LABEL[p]).join(', ') || '—'}
          </div>
          {t.selfTest && (
            <div className="text-xs font-bold tabular-nums text-duo-mute">
              Tự kiểm tra: chính mẫu {t.selfTest.identical ?? '—'} • lật gương {t.selfTest.mirrored ?? '—'} • đứng yên{' '}
              {t.selfTest.still ?? '—'}
            </div>
          )}
          <div className="text-xs font-semibold text-duo-mute">
            Tạo {formatDateTime(t.createdAt)} • mã <span className="font-mono">{t.templateHash.slice(0, 12)}</span>
            {t.sourceSubjectId && (
              <>
                {' • nguồn '}
                <span className="font-mono">{t.sourceSubjectId.slice(0, 12)}…</span>
                {t.sourceMlSubjectDeleted ? ' (đã xoá trên máy phân tích)' : ' (còn trên máy phân tích)'}
              </>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-duo-secondary !px-3 !py-2" disabled={busy} onClick={onPreview} aria-pressed={previewing}>
            <Eye className="h-4 w-4" />
            Xem trước
          </button>
          {!t.isCurrent && (
            <button
              type="button"
              className="btn-duo !px-3 !py-2"
              disabled={busy || failed > 0}
              title={failed > 0 ? 'Phiên bản chưa đạt chất lượng nên không xuất bản được.' : undefined}
              onClick={onPublish}
            >
              <Rocket className="h-4 w-4" />
              Xuất bản
            </button>
          )}
          {t.sourceSubjectId && !t.sourceMlSubjectDeleted && (
            <button type="button" className="btn-duo-secondary !px-3 !py-2 !text-duo-red" disabled={busy} onClick={onDeleteSource}>
              <Trash2 className="h-4 w-4" />
              Xoá nguồn
            </button>
          )}
        </div>
      </div>
      <button type="button" className="link-duo mt-2 text-xs" aria-expanded={showGates} onClick={() => setShowGates((v) => !v)}>
        {showGates ? 'Ẩn chi tiết kiểm tra' : 'Chi tiết kiểm tra'}
      </button>
      {showGates && (
        <div className="mt-3">
          <TemplateGateList gates={t.quality} selfTest={t.selfTest} compact />
        </div>
      )}
    </div>
  )
}

function niceStep(max: number) {
  const raw = Math.max(1, max) / 4
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const norm = raw / magnitude
  return Math.max(1, (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * magnitude)
}

const binLabel = (i: number) => (i === 9 ? '90–100' : `${i * 10}–${i * 10 + 9}`)

/** Distribution of overall scores in 10-point bins: one series, hairline grid, tooltip + table. */
function ScoreHistogram({ bins }: { bins: number[] }) {
  const [active, setActive] = useState<number | null>(null)
  const [view, setView] = useState<'chart' | 'table'>('chart')
  const max = Math.max(0, ...bins)
  const step = niceStep(max)
  const top = Math.max(step, Math.ceil(max / step) * step)
  const ticks: number[] = []
  for (let t = 0; t <= top; t += step) ticks.push(t)
  const total = bins.reduce((a, b) => a + b, 0)

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-extrabold text-duo-ink">Phân bố điểm ({total} lượt được chấm)</div>
        <div className="flex rounded-2xl bg-duo-mist p-1" role="group" aria-label="Kiểu hiển thị">
          {(
            [
              ['chart', 'Biểu đồ', ChartColumn],
              ['table', 'Bảng', Table2],
            ] as const
          ).map(([value, label, Icon]) => (
            <button
              key={value}
              type="button"
              aria-pressed={view === value}
              onClick={() => setView(value)}
              className={[
                'flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-extrabold transition-all',
                view === value ? 'bg-white text-duo-ink shadow-chip' : 'text-duo-mute hover:text-duo-ink',
              ].join(' ')}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {view === 'table' ? (
        <div className="overflow-x-auto rounded-2xl bg-white shadow-card-inner">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="divider-duo text-xs font-extrabold uppercase tracking-wide text-duo-mute">
                <th className="px-3 py-2">Khoảng điểm</th>
                <th className="px-3 py-2 text-right">Số lượt</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-duo-line/70 font-bold text-duo-ink">
              {bins.map((count, i) => (
                <tr key={i}>
                  <td className="px-3 py-2 tabular-nums">{binLabel(i)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="flex gap-2">
          <div className="relative h-40 w-8 flex-shrink-0">
            {ticks.map((t) => (
              <span
                key={t}
                className="absolute right-0 text-[11px] font-bold tabular-nums text-duo-mute"
                style={{ bottom: `${(t / top) * 100}%`, transform: 'translateY(50%)' }}
              >
                {t}
              </span>
            ))}
          </div>
          <div className="min-w-0 flex-1">
            <div className="relative h-40" onPointerLeave={() => setActive(null)}>
              {ticks.map((t) => (
                <div key={t} className="absolute inset-x-0 h-px" style={{ bottom: `${(t / top) * 100}%`, background: GRID }} />
              ))}
              <div className="absolute inset-0 flex items-end gap-[2px]">
                {bins.map((count, i) => (
                  <div
                    key={i}
                    tabIndex={0}
                    role="img"
                    aria-label={`Điểm ${binLabel(i)}: ${count} lượt`}
                    className="relative flex h-full flex-1 items-end outline-none focus-visible:ring-2 focus-visible:ring-duo-blue"
                    onPointerEnter={() => setActive(i)}
                    onPointerDown={() => setActive(i)}
                    onFocus={() => setActive(i)}
                    onBlur={() => setActive(null)}
                  >
                    <div
                      className="w-full"
                      style={{
                        height: `${(count / top) * 100}%`,
                        minHeight: count > 0 ? 2 : 0,
                        background: ACCENT,
                        borderRadius: '4px 4px 0 0',
                        opacity: active === null || active === i ? 1 : 0.55,
                      }}
                    />
                    {active === i && (
                      <div
                        role="status"
                        className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 w-max -translate-x-1/2 rounded-xl bg-white px-2.5 py-1.5 text-xs font-bold text-duo-ink shadow-card-hover"
                      >
                        Điểm {binLabel(i)}: <span className="font-black">{count}</span> lượt
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-1 flex gap-[2px]">
              {bins.map((_, i) => (
                <span key={i} className="flex-1 text-center text-[10px] font-bold tabular-nums text-duo-mute">
                  {i * 10}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function StatsPanel({ stats }: { stats: AdminExerciseStatsDto }) {
  const reasons = Object.entries(stats.reasonCounts).filter(([, n]) => n > 0)
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {(
          [
            ['Lượt tập', String(stats.attempts)],
            ['Được chấm', String(stats.scored)],
            ['Chưa nhìn rõ', String(stats.insufficient)],
            ['Tỉ lệ chưa nhìn rõ', stats.attempts > 0 ? formatPercent(stats.insufficientRate) : '—'],
          ] as const
        ).map(([label, value]) => (
          <div key={label} className="rounded-2xl bg-duo-mist px-3 py-2.5">
            <div className="text-[11px] font-extrabold uppercase tracking-wide text-duo-mute">{label}</div>
            <div className="text-xl font-black tabular-nums text-duo-ink">{value}</div>
          </div>
        ))}
      </div>
      {stats.scored > 0 ? (
        <ScoreHistogram bins={stats.histogram10} />
      ) : (
        <div className="text-sm font-semibold text-duo-mute">Chưa có lượt tập nào được chấm.</div>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <div className="mb-1 text-xs font-extrabold uppercase tracking-wide text-duo-mute">Cách làm theo (bài một bên)</div>
          <div className="text-sm font-bold text-duo-ink">
            Soi gương {stats.modeSplit.mirror} • Đúng tay/chân {stats.modeSplit.anatomical} • Không phân biệt {stats.modeSplit.none}
          </div>
        </div>
        <div>
          <div className="mb-1 text-xs font-extrabold uppercase tracking-wide text-duo-mute">Lý do chưa nhìn rõ</div>
          {reasons.length === 0 ? (
            <div className="text-sm font-semibold text-duo-mute">Không có.</div>
          ) : (
            <ul className="space-y-0.5 text-sm font-bold text-duo-ink">
              {reasons.map(([code, n]) => (
                <li key={code}>
                  {REASON_LABEL[code] ?? code}: <span className="tabular-nums">{n}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <p className="text-xs font-semibold text-duo-mute">Số liệu tổng hợp, không kèm tên trẻ. Điểm luyện tập không phải kết quả sàng lọc.</p>
    </div>
  )
}

export function AdminExerciseEditPage() {
  const { id = '' } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const caps = useExerciseCapabilities()
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' })
  const [reloadKey, setReloadKey] = useState(0)
  const [stats, setStats] = useState<AdminExerciseStatsDto | null>(null)
  const [statsError, setStatsError] = useState<string | null>(null)

  const [metaSaving, setMetaSaving] = useState(false)
  const [metaError, setMetaError] = useState<string | null>(null)
  const [metaSaved, setMetaSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [actionMessage, setActionMessage] = useState<{ ok: boolean; text: string } | null>(null)

  const [preview, setPreview] = useState<Preview | null>(null)
  const [previewPlaying, setPreviewPlaying] = useState(false)
  const [previewRun, setPreviewRun] = useState(0)
  const [previewMirrored, setPreviewMirrored] = useState(true)
  const [publishTarget, setPublishTarget] = useState<{ templateId: string; version: number } | null>(null)

  // New-version wizard
  const [attested, setAttested] = useState(false)
  const [source, setSource] = useState<TemplateSource | null>(null)
  const [uploadPct, setUploadPct] = useState<number | null>(null)
  const [fpsInput, setFpsInput] = useState('')
  const [mirrorPolicy, setMirrorPolicy] = useState<MirrorPolicy>('EITHER')
  const [trim, setTrim] = useState<TrimRange | null>(null)
  const [trimTouched, setTrimTouched] = useState(false)
  const [dryResult, setDryResult] = useState<BuildTemplateResultDto | null>(null)
  const [dryInputsKey, setDryInputsKey] = useState<string | null>(null)
  const [compiling, setCompiling] = useState<'dry' | 'save' | null>(null)
  const [wizardError, setWizardError] = useState<string | null>(null)
  const [rejectedGates, setRejectedGates] = useState<TemplateGateDto[] | null>(null)
  const [savedTemplate, setSavedTemplate] = useState<AdminTemplateDto | null>(null)

  useEffect(() => {
    let active = true
    adminFetchExercises().then(
      (list) => {
        if (!active) return
        const found = list.find((e) => e.id === id)
        setLoad(found ? { kind: 'ready', exercise: found } : { kind: 'notFound' })
      },
      (err: unknown) => active && setLoad({ kind: 'error', message: exerciseApiErrorMessage(err, 'Không tải được bài tập.') }),
    )
    adminFetchExerciseStats(id).then(
      (s) => {
        if (!active) return
        setStats(s)
        setStatsError(null)
      },
      (err: unknown) => active && setStatsError(exerciseApiErrorMessage(err, 'Không tải được thống kê.')),
    )
    return () => {
      active = false
    }
  }, [id, reloadKey])

  const exercise = load.kind === 'ready' ? load.exercise : null
  const reload = () => setReloadKey((k) => k + 1)

  const reusableSources = useMemo(() => {
    const seen = new Set<string>()
    return (exercise?.templates ?? [])
      .filter((t) => t.sourceSubjectId && !t.sourceMlSubjectDeleted)
      .sort((a, b) => b.version - a.version)
      .filter((t) => {
        if (seen.has(t.sourceSubjectId as string)) return false
        seen.add(t.sourceSubjectId as string)
        return true
      })
  }, [exercise])

  const fpsValue = parseFps(fpsInput)
  const fpsOverride = fpsValue !== null && (source?.fps === null || source?.fps === undefined || Math.abs(fpsValue - source.fps) > 0.005)
  const compileInput: CompileTemplateInput | null =
    source && (source.fps !== null || fpsValue !== null)
      ? {
          sourceSubjectId: source.sourceSubjectId,
          mirrorPolicy,
          ...(fpsOverride ? { fps: fpsValue } : {}),
          ...(trimTouched && trim ? { trim: { startSec: trim.startSec, endSec: trim.endSec } } : {}),
        }
      : null
  const inputsKey = compileInput ? JSON.stringify(compileInput) : null
  const dryIsCurrent = dryResult !== null && dryInputsKey === inputsKey

  function resetWizardResult() {
    setTrim(null)
    setTrimTouched(false)
    setDryResult(null)
    setDryInputsKey(null)
    setRejectedGates(null)
    setSavedTemplate(null)
    setWizardError(null)
  }

  async function saveMetadata(values: Required<ExerciseMetadataInput>) {
    if (!exercise) return
    setMetaSaving(true)
    setMetaError(null)
    setMetaSaved(false)
    try {
      const updated = await adminUpdateExercise(exercise.id, values)
      setLoad({ kind: 'ready', exercise: updated })
      setMetaSaved(true)
    } catch (err) {
      setMetaError(exerciseApiErrorMessage(err, 'Không lưu được thông tin bài tập.'))
    } finally {
      setMetaSaving(false)
    }
  }

  async function changeStatus(status: 'DRAFT' | 'ARCHIVED') {
    if (!exercise) return
    const question =
      status === 'ARCHIVED'
        ? 'Lưu trữ bài tập này? Bài sẽ ẩn khỏi phụ huynh; điểm đã có vẫn được giữ.'
        : 'Chuyển bài tập về nháp? Bài sẽ ẩn khỏi phụ huynh cho tới khi xuất bản lại một phiên bản.'
    if (!window.confirm(question)) return
    setBusy(true)
    setActionMessage(null)
    try {
      const updated = await adminUpdateExercise(exercise.id, { status })
      setLoad({ kind: 'ready', exercise: updated })
      setActionMessage({ ok: true, text: status === 'ARCHIVED' ? 'Đã lưu trữ bài tập.' : 'Đã chuyển bài tập về nháp.' })
    } catch (err) {
      setActionMessage({ ok: false, text: exerciseApiErrorMessage(err, 'Không đổi được trạng thái.') })
    } finally {
      setBusy(false)
    }
  }

  async function deleteExercise() {
    if (!exercise) return
    if (!window.confirm(`Xoá vĩnh viễn bài tập “${exercise.title}” và mọi phiên bản mẫu? Chỉ xoá được khi chưa có lượt tập.`)) return
    setBusy(true)
    setActionMessage(null)
    try {
      await adminDeleteExercise(exercise.id)
      navigate('/admin/exercises')
    } catch (err) {
      setActionMessage({ ok: false, text: exerciseApiErrorMessage(err, 'Không xoá được bài tập.') })
      setBusy(false)
    }
  }

  async function openPreview(template: AdminTemplateDto) {
    if (!exercise) return
    if (preview?.templateId === template.id) {
      setPreview(null)
      setPreviewPlaying(false)
      return
    }
    setBusy(true)
    setActionMessage(null)
    try {
      const guide = await adminFetchTemplateGuide(exercise.id, template.id)
      setPreview({ templateId: template.id, version: template.version, guide })
      setPreviewPlaying(false)
    } catch (err) {
      setActionMessage({ ok: false, text: exerciseApiErrorMessage(err, 'Không tải được bản xem trước.') })
    } finally {
      setBusy(false)
    }
  }

  async function publish() {
    if (!exercise || !publishTarget) return
    setBusy(true)
    setActionMessage(null)
    try {
      const updated = await adminPublishTemplate(exercise.id, publishTarget.templateId)
      setLoad({ kind: 'ready', exercise: updated })
      setActionMessage({ ok: true, text: `Đã xuất bản phiên bản ${publishTarget.version}.` })
      setPublishTarget(null)
      if (savedTemplate?.id === publishTarget.templateId) setSavedTemplate(null)
      reload()
    } catch (err) {
      setActionMessage({ ok: false, text: exerciseApiErrorMessage(err, 'Không xuất bản được phiên bản này.') })
      setPublishTarget(null)
    } finally {
      setBusy(false)
    }
  }

  async function deleteSource(template: AdminTemplateDto) {
    if (!exercise) return
    if (
      !window.confirm(
        `Xoá dữ liệu khung xương nguồn của phiên bản ${template.version} trên máy phân tích? Phiên bản mẫu đã lưu vẫn dùng được, nhưng không tạo được phiên bản mới từ nguồn này.`,
      )
    )
      return
    setBusy(true)
    setActionMessage(null)
    try {
      await adminDeleteTemplateSource(exercise.id, template.id)
      setActionMessage({ ok: true, text: 'Đã xoá dữ liệu nguồn trên máy phân tích.' })
      if (source?.sourceSubjectId === template.sourceSubjectId) {
        setSource(null)
        resetWizardResult()
      }
      reload()
    } catch (err) {
      setActionMessage({ ok: false, text: exerciseApiErrorMessage(err, 'Không xoá được dữ liệu nguồn.') })
    } finally {
      setBusy(false)
    }
  }

  async function uploadSource(file: File) {
    if (!exercise || !attested) return
    setWizardError(null)
    setUploadPct(0)
    try {
      const meta = await readVideoMetadata(file)
      const res = await adminUploadTemplateSource(exercise.id, file, meta?.durationMs ?? null, setUploadPct)
      const clip = meta ? meta.durationMs / 1000 : res.fps ? res.numFrames / res.fps : null
      setSource({
        sourceSubjectId: res.sourceSubjectId,
        numFrames: res.numFrames,
        fps: res.fps,
        fpsSource: res.fpsSource,
        clipDurationSec: clip,
        label: 'video vừa tải lên',
      })
      setFpsInput(res.fps ? String(Math.round(res.fps * 100) / 100) : '')
      resetWizardResult()
    } catch (err) {
      setWizardError(exerciseApiErrorMessage(err, 'Không trích xuất được khung xương từ video mẫu.'))
    } finally {
      setUploadPct(null)
    }
  }

  function reuseSource(templateId: string) {
    const t = exercise?.templates.find((x) => x.id === templateId)
    if (!t?.sourceSubjectId) return
    setSource({
      sourceSubjectId: t.sourceSubjectId,
      numFrames: null,
      fps: t.sourceFps,
      fpsSource: t.fpsSource,
      clipDurationSec: null,
      label: `nguồn của phiên bản ${t.version}`,
    })
    setFpsInput(String(Math.round(t.sourceFps * 100) / 100))
    setMirrorPolicy(t.mirrorPolicy)
    resetWizardResult()
  }

  async function compile(dryRun: boolean) {
    if (!exercise || !compileInput || !attested) return
    setCompiling(dryRun ? 'dry' : 'save')
    setWizardError(null)
    setRejectedGates(null)
    const key = inputsKey
    try {
      const res = await adminCompileTemplate(exercise.id, { ...compileInput, dryRun })
      setDryResult(res.result)
      setDryInputsKey(key)
      if (!trimTouched) {
        const t = res.result.template
        setTrim(res.result.suggestedTrim ?? (t ? { startSec: t.activeStartSec, endSec: t.activeEndSec } : null))
      }
      if (!dryRun && res.template) {
        setSavedTemplate(res.template)
        reload()
      }
    } catch (err) {
      const gates = apiErrorCode(err) === 'TEMPLATE_QUALITY_FAILED' ? errorGates(err) : null
      setRejectedGates(gates)
      setWizardError(exerciseApiErrorMessage(err, 'Không tạo được phiên bản mẫu.'))
    } finally {
      setCompiling(null)
    }
  }

  if (load.kind !== 'ready' || !exercise) {
    return (
      <DashboardLayout>
        <div className="space-y-4">
          <Link to="/admin/exercises" className="link-duo inline-flex items-center gap-1 text-sm">
            <ArrowLeft className="h-4 w-4" />
            Danh sách bài tập
          </Link>
          <Card title="Bài tập">
            {load.kind === 'loading' && <div className="text-sm font-semibold text-duo-mute">Đang tải...</div>}
            {load.kind === 'notFound' && <div className="text-sm font-semibold text-duo-mute">Không tìm thấy bài tập này.</div>}
            {load.kind === 'error' && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-red-50 px-4 py-3 text-sm font-bold text-duo-red">
                {load.message}
                <button type="button" className="btn-duo-secondary !px-3 !py-2" onClick={reload}>
                  Thử lại
                </button>
              </div>
            )}
          </Card>
        </div>
      </DashboardLayout>
    )
  }

  const templates = [...exercise.templates].sort((a, b) => b.version - a.version)
  const current = templates.find((t) => t.isCurrent) ?? null
  const accept = BASE_ACCEPT + (caps?.acceptsWebm ? WEBM_ACCEPT : '')
  const resultTemplate = dryResult?.template ?? null
  const clipDurationSec =
    source?.clipDurationSec ??
    Math.max(dryResult?.suggestedTrim?.endSec ?? 0, resultTemplate?.activeEndSec ?? 0, trim?.endSec ?? 0)
  const wizardPreview =
    resultTemplate && resultTemplate.guideTrack.frames.length > 0
      ? {
          guide: {
            ...resultTemplate.guideTrack,
            durationSec: resultTemplate.guideTrack.frames.length / resultTemplate.guideTrack.hz,
          },
          range: { startSec: resultTemplate.activeStartSec, endSec: resultTemplate.activeEndSec },
          title: exercise.title,
        }
      : null
  const shownGates = rejectedGates ?? dryResult?.gates ?? null

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <Link to="/admin/exercises" className="link-duo inline-flex items-center gap-1 text-sm">
          <ArrowLeft className="h-4 w-4" />
          Danh sách bài tập
        </Link>

        <div className="card-duo p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-black text-duo-ink">{exercise.title}</h1>
                <ExerciseStatusPill status={exercise.status} />
              </div>
              <div className="mt-1 text-sm font-bold text-duo-mute">
                {exercise.slug} • {exercise.source === 'BUILTIN_SYNTHETIC' ? 'Mẫu tổng hợp' : 'Do admin tạo'} •{' '}
                {current ? `đang dùng phiên bản ${current.version}` : 'chưa xuất bản phiên bản nào'}
              </div>
              {exercise.status === 'PUBLISHED' && caps && caps.mode !== 'on' && (
                <div className="mt-2 text-xs font-bold text-yellow-900">
                  Bài đã xuất bản nhưng phụ huynh chưa thấy vì EXERCISE_MODE đang là “{caps.mode}”.
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {exercise.status !== 'DRAFT' && (
                <button type="button" className="btn-duo-secondary" disabled={busy} onClick={() => void changeStatus('DRAFT')}>
                  <Undo2 className="h-4 w-4" />
                  Về nháp
                </button>
              )}
              {exercise.status !== 'ARCHIVED' && (
                <button type="button" className="btn-duo-secondary" disabled={busy} onClick={() => void changeStatus('ARCHIVED')}>
                  <Archive className="h-4 w-4" />
                  Lưu trữ
                </button>
              )}
              <button type="button" className="btn-duo-secondary !text-duo-red" disabled={busy} onClick={() => void deleteExercise()}>
                <Trash2 className="h-4 w-4" />
                Xoá
              </button>
            </div>
          </div>
          {actionMessage && (
            <div
              className={[
                'mt-4 rounded-2xl px-4 py-3 text-sm font-bold',
                actionMessage.ok ? 'bg-duo-green-soft text-duo-green-dark' : 'bg-red-50 text-duo-red',
              ].join(' ')}
              role="status"
            >
              {actionMessage.text}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_400px]">
          <Card title="Các phiên bản mẫu">
            {templates.length === 0 ? (
              <div className="text-sm font-semibold text-duo-mute">Chưa có phiên bản nào. Tạo phiên bản đầu tiên ở bên dưới.</div>
            ) : (
              <div className="space-y-3">
                {templates.map((t) => (
                  <TemplateCard
                    key={t.id}
                    template={t}
                    busy={busy}
                    previewing={preview?.templateId === t.id}
                    onPreview={() => void openPreview(t)}
                    onPublish={() => setPublishTarget({ templateId: t.id, version: t.version })}
                    onDeleteSource={() => void deleteSource(t)}
                  />
                ))}
              </div>
            )}
          </Card>

          <Card title={preview ? `Xem trước phiên bản ${preview.version}` : 'Xem trước'}>
            {preview ? (
              <div className="space-y-3">
                <div className="mx-auto w-fit overflow-hidden rounded-2xl bg-duo-mist">
                  <GuidePuppet
                    key={previewRun}
                    guide={preview.guide}
                    playing={previewPlaying}
                    mirrored={previewMirrored}
                    pose={previewPlaying ? 'demo' : 'idle'}
                    title={exercise.title}
                    size={280}
                    onEnded={() => setPreviewPlaying(false)}
                  />
                </div>
                <div className="flex flex-wrap items-center justify-center gap-3">
                  <button
                    type="button"
                    className="btn-duo !px-4 !py-2"
                    onClick={() => {
                      if (!previewPlaying) setPreviewRun((r) => r + 1)
                      setPreviewPlaying((p) => !p)
                    }}
                  >
                    {previewPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                    {previewPlaying ? 'Dừng' : 'Phát'}
                  </button>
                  <label className="flex cursor-pointer items-center gap-2 text-xs font-bold text-duo-ink">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-duo-green"
                      checked={previewMirrored}
                      onChange={(e) => setPreviewMirrored(e.target.checked)}
                    />
                    Kiểu soi gương
                  </label>
                </div>
                <div className="text-center text-xs font-bold text-duo-mute">
                  Dài {secText(preview.guide.durationSec)} • {preview.guide.frames.length} khung hình ở {preview.guide.hz} Hz
                </div>
              </div>
            ) : (
              <div className="text-sm font-semibold text-duo-mute">Bấm “Xem trước” ở một phiên bản để xem bạn Mầm làm mẫu.</div>
            )}
          </Card>
        </div>

        <Card title="Tạo phiên bản mẫu mới">
          <div className="space-y-6">
            <Section step={1} title="Xác nhận người làm mẫu">
              <label className="flex cursor-pointer items-start gap-2 rounded-2xl bg-duo-mist p-3 text-sm font-bold text-duo-ink">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 accent-duo-green"
                  checked={attested}
                  onChange={(e) => setAttested(e.target.checked)}
                />
                <span>{ATTESTATION_TEXT}</span>
              </label>
            </Section>

            <Section step={2} title="Video làm mẫu">
              <div className="space-y-3">
                <ul className="list-disc space-y-0.5 pl-5 text-xs font-semibold text-duo-mute">
                  <li>Một người lớn, quay chính diện, thấy cả người từ đầu đến chân, đủ sáng.</li>
                  <li>Đứng yên khoảng 1 giây trước khi bắt đầu, làm động tác 2–30 giây rồi đứng yên lại.</li>
                  <li>Video chỉ dùng để trích xuất khung xương; tệp trên máy chủ ứng dụng được xoá ngay sau đó.</li>
                </ul>
                {source ? (
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-duo-mist px-4 py-3">
                    <div className="flex min-w-0 items-center gap-2 text-sm font-bold text-duo-ink">
                      <FileVideo className="h-4 w-4 flex-shrink-0 text-duo-green-dark" />
                      <span className="min-w-0">
                        Dùng {source.label}: <span className="font-mono text-xs">{source.sourceSubjectId}</span>
                        <span className="block text-xs font-bold text-duo-mute">
                          {source.numFrames !== null ? `${source.numFrames} khung hình • ` : ''}
                          {source.fps !== null
                            ? `${formatNumber(source.fps, 2)} fps (${FPS_SOURCE_LABEL[source.fpsSource ?? ''] ?? source.fpsSource})`
                            : 'chưa rõ fps'}
                          {source.clipDurationSec !== null ? ` • dài ${secText(source.clipDurationSec)}` : ''}
                        </span>
                      </span>
                    </div>
                    <button
                      type="button"
                      className="btn-duo-secondary !px-3 !py-2"
                      disabled={compiling !== null}
                      onClick={() => {
                        setSource(null)
                        resetWizardResult()
                      }}
                    >
                      Đổi video
                    </button>
                  </div>
                ) : (
                  <>
                    <UploadDropzone
                      disabled={!attested || uploadPct !== null}
                      accept={accept}
                      helperText={
                        !attested
                          ? 'Đánh dấu xác nhận ở bước 1 trước khi tải video.'
                          : uploadPct !== null
                            ? uploadPct < 100
                              ? `Đang tải lên ${uploadPct}%...`
                              : 'Đang trích xuất khung xương bằng OpenPose (có thể mất vài phút)...'
                            : `Hỗ trợ .mp4, .mov, .mkv, .avi${caps?.acceptsWebm ? ', .webm' : ''}`
                      }
                      onFileSelected={(file) => void uploadSource(file)}
                    />
                    {reusableSources.length > 0 && (
                      <label className="flex flex-wrap items-center gap-2 text-sm font-bold text-duo-ink">
                        Hoặc dùng lại nguồn đã tải:
                        <select
                          className="rounded-xl bg-white px-2 py-2 text-xs font-bold text-duo-ink shadow-chip outline-none"
                          value=""
                          disabled={!attested || uploadPct !== null}
                          onChange={(e) => e.target.value && reuseSource(e.target.value)}
                        >
                          <option value="">Chọn phiên bản…</option>
                          {reusableSources.map((t) => (
                            <option key={t.id} value={t.id}>
                              Nguồn của phiên bản {t.version}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                  </>
                )}
              </div>
            </Section>

            <Section step={3} title="Thiết lập và kiểm tra (chạy thử, chưa lưu)">
              {!source ? (
                <div className="text-sm font-semibold text-duo-mute">Cần có video làm mẫu ở bước 2.</div>
              ) : (
                <div className="space-y-4">
                  <div className="grid gap-4 md:grid-cols-[1fr_160px]">
                    <label className="block">
                      <span className="mb-1 block text-xs font-extrabold uppercase tracking-wide text-duo-mute">Làm theo kiểu soi gương</span>
                      <select
                        className="input-duo"
                        value={mirrorPolicy}
                        onChange={(e) => setMirrorPolicy(e.target.value as MirrorPolicy)}
                        disabled={compiling !== null}
                      >
                        {MIRROR_POLICIES.map((p) => (
                          <option key={p} value={p}>
                            {MIRROR_POLICY_LABEL[p]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-xs font-extrabold uppercase tracking-wide text-duo-mute">
                        Fps {source.fps === null ? '(bắt buộc)' : ''}
                      </span>
                      <input
                        className="input-duo"
                        inputMode="decimal"
                        value={fpsInput}
                        onChange={(e) => setFpsInput(e.target.value)}
                        placeholder="30"
                        disabled={compiling !== null}
                      />
                    </label>
                  </div>
                  {fpsInput.trim() !== '' && fpsValue === null && (
                    <div className="text-xs font-bold text-duo-red">
                      Fps phải nằm trong khoảng {FPS_MIN}–{FPS_MAX}.
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="btn-duo-secondary"
                      disabled={!compileInput || !attested || compiling !== null || dryIsCurrent}
                      onClick={() => void compile(true)}
                    >
                      {compiling === 'dry' && <Loader2 className="h-4 w-4 animate-spin" />}
                      {dryResult ? 'Kiểm tra lại' : 'Kiểm tra (chạy thử)'}
                    </button>
                    {dryResult && !dryIsCurrent && (
                      <span className="self-center text-xs font-bold text-yellow-900">
                        Thiết lập đã thay đổi — bấm “Kiểm tra lại” trước khi lưu.
                      </span>
                    )}
                  </div>

                  {shownGates && (
                    <TemplateGateList gates={shownGates} selfTest={rejectedGates ? null : dryResult?.selfTest ?? null} />
                  )}

                  {trim && (
                    <TemplateTrimTimeline
                      clipDurationSec={clipDurationSec}
                      clipDurationKnown={source.clipDurationSec !== null}
                      suggested={dryResult?.suggestedTrim ?? null}
                      value={trim}
                      onChange={(next) => {
                        setTrim(next)
                        setTrimTouched(true)
                      }}
                      disabled={compiling !== null}
                      preview={wizardPreview}
                    />
                  )}
                </div>
              )}
            </Section>

            <Section step={4} title="Lưu phiên bản và xuất bản">
              <div className="space-y-3">
                {wizardError && <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-bold text-duo-red">{wizardError}</div>}
                {savedTemplate && dryIsCurrent ? (
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-duo-green-soft px-4 py-3">
                    <div className="text-sm font-bold text-duo-green-dark">
                      Đã lưu phiên bản {savedTemplate.version} (chưa xuất bản).
                    </div>
                    <button
                      type="button"
                      className="btn-duo !px-4 !py-2"
                      disabled={busy || savedTemplate.quality.some((g) => !g.ok)}
                      onClick={() => setPublishTarget({ templateId: savedTemplate.id, version: savedTemplate.version })}
                    >
                      <Rocket className="h-4 w-4" />
                      Xuất bản ngay
                    </button>
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      className="btn-duo"
                      disabled={!attested || !dryIsCurrent || !dryResult?.ok || compiling !== null}
                      onClick={() => void compile(false)}
                    >
                      {compiling === 'save' && <Loader2 className="h-4 w-4 animate-spin" />}
                      Lưu phiên bản mới
                    </button>
                    <div className="text-xs font-semibold text-duo-mute">
                      {dryResult && !dryResult.ok
                        ? 'Video mẫu chưa đạt các tiêu chí chất lượng nên chưa lưu được.'
                        : 'Lưu được sau khi lần kiểm tra mới nhất đạt mọi tiêu chí. Mỗi lần lưu tạo một phiên bản mới, không sửa phiên bản cũ.'}
                    </div>
                  </>
                )}
              </div>
            </Section>
          </div>
        </Card>

        <Card title="Thông tin bài tập">
          <ExerciseMetadataForm
            key={exercise.id}
            initial={{
              slug: exercise.slug,
              title: exercise.title,
              description: exercise.description,
              childPrompt: exercise.childPrompt,
              difficulty: exercise.difficulty,
              bodyFocus: exercise.bodyFocus,
              sortOrder: exercise.sortOrder,
            }}
            submitLabel="Lưu thông tin"
            submitting={metaSaving}
            error={metaError}
            onSubmit={(values) => void saveMetadata(values)}
          />
          {metaSaved && <div className="mt-3 text-sm font-bold text-duo-green-dark">Đã lưu thông tin bài tập.</div>}
        </Card>

        <Card title="Thống kê lượt tập">
          {statsError && <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-bold text-duo-red">{statsError}</div>}
          {!statsError && !stats && <div className="text-sm font-semibold text-duo-mute">Đang tải...</div>}
          {stats && <StatsPanel stats={stats} />}
        </Card>
      </div>

      {publishTarget && (
        <ConfirmPublishDialog
          version={publishTarget.version}
          hasCurrent={current !== null}
          busy={busy}
          onConfirm={() => void publish()}
          onCancel={() => setPublishTarget(null)}
        />
      )}
    </DashboardLayout>
  )
}
