import { Fragment, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ChartLine, Table2 } from 'lucide-react'
import type { ExerciseProgressDto } from '../../lib/exerciseTypes'
import { EXERCISE_DISCLAIMER, SESSION_STATUS_LABEL } from '../../lib/exercises'
import { formatDateTime, formatDayMonth, formatTime } from '../../lib/format'

// Same chart system as GaitTrendChart: one validated brand-green series
// (>= 3:1 on white), hairline grid, recessive axes, tooltip + table mode.
const ACCENT = '#166534'
const GRID = '#E5E5E5'
const SURFACE = '#FFFFFF'
const PLOT_HEIGHT = 200
const MARGIN = { top: 24, right: 24, bottom: 30, left: 40 }
const EDGE_PAD = 18
const TOOLTIP_WIDTH = 210
const TOOLTIP_HEIGHT = 76
const TOOLTIP_GAP = 14
// Practice scores are always 0..100, so the axis is fixed: a moving domain
// would make a flat series look like progress.
const Y_TICKS = [0, 25, 50, 75, 100]

const BREAK_NOTE = 'Mẫu hoặc cách chấm đã cập nhật — điểm trước và sau không so sánh trực tiếp.'

/** One attempt of the child on this exercise; `attempt` numbers them chronologically. */
type Attempt = {
  sessionId: string
  attempt: number
  at: string
  overall: number | null
  stars: number | null
  status: 'SCORED' | 'INSUFFICIENT'
  hasWarnings: boolean
  seriesKey: string
  templateVersion: number
}

type Plotted = Attempt & { overall: number }

function flatten(progress: ExerciseProgressDto): Attempt[] {
  const all = progress.series.flatMap((s) =>
    s.points.map((p) => ({ ...p, seriesKey: s.key, templateVersion: s.templateVersion })),
  )
  all.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
  return all.map((p, i) => ({
    sessionId: p.sessionId,
    attempt: i + 1,
    at: p.at,
    overall: p.overall,
    stars: p.stars,
    status: p.status,
    hasWarnings: p.hasWarnings,
    seriesKey: p.seriesKey,
    templateVersion: p.templateVersion,
  }))
}

function isPlotted(a: Attempt): a is Plotted {
  return a.status === 'SCORED' && typeof a.overall === 'number' && Number.isFinite(a.overall)
}

/** "06/10"; an attempt on the same day as the previous one shows its time instead. */
function axisLabel(points: Plotted[], i: number) {
  if (i > 0 && new Date(points[i - 1].at).toDateString() === new Date(points[i].at).toDateString()) {
    return formatTime(points[i].at)
  }
  return formatDayMonth(points[i].at)
}

/** Indices of x labels that fit: every k-th plus the last, never two crowded together. */
function labelIndices(n: number, plotWidth: number) {
  const maxLabels = Math.max(2, Math.floor(plotWidth / 46))
  if (n <= maxLabels) return new Set(Array.from({ length: n }, (_, i) => i))
  const k = Math.ceil(n / maxLabels)
  const shown = new Set<number>()
  for (let i = 0; i < n; i += k) shown.add(i)
  const last = n - 1
  const previous = last - (last % k)
  if (previous !== last && last - previous < k * 0.6) shown.delete(previous)
  shown.add(last)
  return shown
}

function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setWidth(el.clientWidth)
    const observer = new ResizeObserver((entries) => setWidth(entries[0].contentRect.width))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return [ref, width] as const
}

function starsText(stars: number | null) {
  return stars ? `${stars}/3 sao` : '—'
}

function ProgressPlot({ title, points }: { title: string; points: Plotted[] }) {
  const [wrapRef, width] = useElementWidth<HTMLDivElement>()
  const [active, setActive] = useState<number | null>(null)
  const navigate = useNavigate()

  const n = points.length
  const plotWidth = Math.max(0, width - MARGIN.left - MARGIN.right)
  const height = MARGIN.top + PLOT_HEIGHT + MARGIN.bottom
  const xAt = (i: number) =>
    n === 1 ? MARGIN.left + plotWidth / 2 : MARGIN.left + EDGE_PAD + (i * (plotWidth - 2 * EDGE_PAD)) / (n - 1)
  const yAt = (v: number) => MARGIN.top + (1 - Math.min(100, Math.max(0, v)) / 100) * PLOT_HEIGHT
  const shownLabels = labelIndices(n, plotWidth)

  // Runs of comparable points (same algorithm version + template); never joined across a change.
  const runs: number[][] = []
  points.forEach((p, i) => {
    if (i === 0 || p.seriesKey !== points[i - 1].seriesKey) runs.push([i])
    else runs[runs.length - 1].push(i)
  })
  const breaks = runs.slice(1).map((run) => run[0])

  function nearest(clientX: number, rect: DOMRect) {
    const x = clientX - rect.left
    let best = 0
    for (let i = 1; i < n; i += 1) if (Math.abs(xAt(i) - x) < Math.abs(xAt(best) - x)) best = i
    return best
  }

  function onPointerMove(e: PointerEvent<SVGSVGElement>) {
    setActive(nearest(e.clientX, e.currentTarget.getBoundingClientRect()))
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'ArrowRight') setActive((a) => Math.min(n - 1, (a ?? -1) + 1))
    else if (e.key === 'ArrowLeft') setActive((a) => Math.max(0, (a ?? n) - 1))
    else if (e.key === 'Home') setActive(0)
    else if (e.key === 'End') setActive(n - 1)
    else if (e.key === 'Escape') setActive(null)
    else if (e.key === 'Enter' && active !== null) navigate(`/exercise-sessions/${points[active].sessionId}`)
    else return
    e.preventDefault()
  }

  const last = points[n - 1]
  const activePoint = active !== null ? points[active] : null

  let tooltipStyle: { left: number; top: number } | null = null
  if (activePoint && active !== null) {
    const x = xAt(active)
    const y = yAt(activePoint.overall)
    const besideTop = Math.min(Math.max(0, y - TOOLTIP_HEIGHT / 2), height - TOOLTIP_HEIGHT)
    if (x + TOOLTIP_GAP + TOOLTIP_WIDTH <= width) tooltipStyle = { left: x + TOOLTIP_GAP, top: besideTop }
    else if (x - TOOLTIP_GAP - TOOLTIP_WIDTH >= 0) tooltipStyle = { left: x - TOOLTIP_GAP - TOOLTIP_WIDTH, top: besideTop }
    else {
      const above = y - TOOLTIP_GAP - TOOLTIP_HEIGHT
      tooltipStyle = {
        left: Math.min(Math.max(0, x - TOOLTIP_WIDTH / 2), Math.max(0, width - TOOLTIP_WIDTH)),
        top: above >= 0 ? above : y + TOOLTIP_GAP,
      }
    }
  }

  return (
    <div
      ref={wrapRef}
      className="relative rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-duo-blue"
      tabIndex={0}
      aria-label={`Biểu đồ điểm luyện tập bài “${title}” qua ${n} lần được chấm. Dùng phím mũi tên trái phải để xem từng lần, Enter để mở chi tiết.`}
      onKeyDown={onKeyDown}
      onFocus={() => setActive((a) => a ?? n - 1)}
      onBlur={() => setActive(null)}
    >
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`Điểm luyện tập: lần gần nhất ${last.overall} trên 100`}
          onPointerMove={onPointerMove}
          onPointerDown={onPointerMove}
          onPointerLeave={(e) => e.pointerType === 'mouse' && setActive(null)}
          className="block touch-none select-none"
        >
          {Y_TICKS.map((t) => (
            <g key={t}>
              <line x1={MARGIN.left} x2={MARGIN.left + plotWidth} y1={yAt(t)} y2={yAt(t)} stroke={GRID} strokeWidth={1} />
              <text x={MARGIN.left - 8} y={yAt(t) + 4} textAnchor="end" className="fill-duo-mute text-[11px] font-bold tabular-nums">
                {t}
              </text>
            </g>
          ))}

          {points.map((p, i) =>
            shownLabels.has(i) ? (
              <text
                key={p.sessionId}
                x={xAt(i)}
                y={MARGIN.top + PLOT_HEIGHT + 20}
                textAnchor="middle"
                className="fill-duo-mute text-[11px] font-bold tabular-nums"
              >
                {axisLabel(points, i)}
              </text>
            ) : null,
          )}

          {/* Visible break: a dashed rule between the last point of one series and the first of the next. */}
          {breaks.map((i) => {
            const x = (xAt(i - 1) + xAt(i)) / 2
            return (
              <g key={`break-${i}`}>
                <line
                  x1={x}
                  x2={x}
                  y1={MARGIN.top - 6}
                  y2={MARGIN.top + PLOT_HEIGHT}
                  stroke="#777777"
                  strokeWidth={1}
                  strokeDasharray="3 3"
                />
                <text x={x} y={MARGIN.top - 10} textAnchor="middle" className="fill-duo-mute text-[10px] font-extrabold">
                  Mẫu mới
                </text>
              </g>
            )
          })}

          {activePoint && active !== null && (
            <line
              x1={xAt(active)}
              x2={xAt(active)}
              y1={MARGIN.top}
              y2={MARGIN.top + PLOT_HEIGHT}
              stroke="#3C3C3C"
              strokeOpacity={0.25}
              strokeWidth={1}
            />
          )}

          {runs
            .filter((run) => run.length > 1)
            .map((run) => (
              <path
                key={`run-${run[0]}`}
                d={run.map((i, k) => `${k ? 'L' : 'M'}${xAt(i).toFixed(1)},${yAt(points[i].overall).toFixed(1)}`).join(' ')}
                fill="none"
                stroke={ACCENT}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ))}

          {points.map((p, i) => {
            const r = active === i ? 6 : 5
            return (
              <g key={p.sessionId}>
                <circle cx={xAt(i)} cy={yAt(p.overall)} r={r + 2} fill={SURFACE} />
                <circle
                  cx={xAt(i)}
                  cy={yAt(p.overall)}
                  r={p.hasWarnings ? r - 1 : r}
                  fill={p.hasWarnings ? SURFACE : ACCENT}
                  stroke={ACCENT}
                  strokeWidth={p.hasWarnings ? 2 : 0}
                />
              </g>
            )
          })}

          {/* Direct label on the latest attempt only. */}
          <text
            x={Math.min(Math.max(xAt(n - 1), MARGIN.left + 24), MARGIN.left + plotWidth - 24)}
            y={Math.max(yAt(last.overall) - 12, 10)}
            textAnchor="middle"
            className="fill-duo-ink text-xs font-black"
          >
            {last.overall}
          </text>
        </svg>
      )}

      {activePoint && tooltipStyle && (
        <div
          role="status"
          className="pointer-events-none absolute z-10 rounded-2xl bg-white px-3 py-2 shadow-card-hover"
          style={{ ...tooltipStyle, width: TOOLTIP_WIDTH }}
        >
          <div className="flex items-center gap-2">
            <span className="h-0.5 w-3 rounded-full" style={{ background: ACCENT }} />
            <span className="text-sm font-black text-duo-ink">
              {activePoint.overall} điểm • {starsText(activePoint.stars)}
            </span>
          </div>
          <div className="mt-0.5 text-xs font-bold text-duo-mute">
            Lần {activePoint.attempt} • {formatDateTime(activePoint.at)}
          </div>
          <div className="text-xs font-bold text-duo-mute">
            Mẫu phiên bản {activePoint.templateVersion}
            {activePoint.hasWarnings ? ' • có lưu ý khi quay' : ''}
          </div>
        </div>
      )}
    </div>
  )
}

function ProgressTable({ attempts }: { attempts: Attempt[] }) {
  return (
    <div className="overflow-x-auto rounded-2xl bg-white shadow-card-inner">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="divider-duo text-xs font-extrabold uppercase tracking-wide text-duo-mute">
            <th className="px-3 py-2">Lần</th>
            <th className="px-3 py-2">Ngày tập</th>
            <th className="px-3 py-2 text-right">Điểm</th>
            <th className="px-3 py-2">Sao</th>
            <th className="px-3 py-2">Trạng thái</th>
            <th className="px-3 py-2">Mẫu</th>
            <th className="px-3 py-2">
              <span className="sr-only">Chi tiết</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-duo-line/70 font-bold text-duo-ink">
          {attempts.map((a, i) => (
            <Fragment key={a.sessionId}>
              {i > 0 && a.seriesKey !== attempts[i - 1].seriesKey && (
                <tr>
                  <td colSpan={7} className="bg-duo-mist px-3 py-2 text-xs font-bold text-duo-mute">
                    {BREAK_NOTE}
                  </td>
                </tr>
              )}
              <tr>
                <td className="px-3 py-2 tabular-nums">{a.attempt}</td>
                <td className="px-3 py-2 tabular-nums">{formatDateTime(a.at)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{a.overall ?? '—'}</td>
                <td className="px-3 py-2">{starsText(a.stars)}</td>
                <td className="px-3 py-2">
                  {SESSION_STATUS_LABEL[a.status]}
                  {a.hasWarnings && <span className="text-duo-mute"> • có lưu ý khi quay</span>}
                </td>
                <td className="px-3 py-2 tabular-nums">v{a.templateVersion}</td>
                <td className="px-3 py-2 text-right">
                  <Link to={`/exercise-sessions/${a.sessionId}`} className="link-duo text-xs">
                    Xem
                  </Link>
                </td>
              </tr>
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * Practice-score trend of one child on ONE exercise. Attempts the machine
 * could not see clearly (INSUFFICIENT) have no score and appear in table mode only.
 */
export function ExerciseProgressChart({
  progress,
  showDisclaimer = true,
}: {
  progress: ExerciseProgressDto
  /** Off when the surrounding card already shows the exercise disclaimer. */
  showDisclaimer?: boolean
}) {
  const attempts = useMemo(() => flatten(progress), [progress])
  const plotted = useMemo(() => attempts.filter(isPlotted), [attempts])
  const [view, setView] = useState<'chart' | 'table'>('chart')

  if (attempts.length === 0) {
    return (
      <div className="rounded-2xl bg-duo-mist px-4 py-6 text-center text-sm font-semibold text-duo-mute">
        Con chưa có lần tập nào được chấm cho bài này. Biểu đồ sẽ xuất hiện sau lần tập đầu tiên.
      </div>
    )
  }

  const unscored = attempts.length - plotted.length
  const hasWarnings = plotted.some((p) => p.hasWarnings)
  const hasBreak =
    view === 'chart'
      ? plotted.some((p, i) => i > 0 && p.seriesKey !== plotted[i - 1].seriesKey)
      : attempts.some((a, i) => i > 0 && a.seriesKey !== attempts[i - 1].seriesKey)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-extrabold text-duo-ink">Điểm luyện tập — {progress.exercise.title}</div>
          <div className="text-xs font-semibold text-duo-mute">Thang 0–100, chỉ so sánh các lần tập của cùng bài này.</div>
        </div>
        <div className="flex rounded-2xl bg-duo-mist p-1" role="group" aria-label="Kiểu hiển thị">
          {(
            [
              ['chart', 'Biểu đồ', ChartLine],
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
        <ProgressTable attempts={attempts} />
      ) : plotted.length > 0 ? (
        <ProgressPlot key={progress.exercise.id} title={progress.exercise.title} points={plotted} />
      ) : (
        <div className="rounded-2xl bg-duo-mist px-4 py-6 text-center text-sm font-semibold text-duo-mute">
          Các lần tập của bài này chưa có điểm (máy chưa nhìn rõ con). Xem từng lần ở chế độ Bảng.
        </div>
      )}

      <div className="space-y-1.5 text-xs font-semibold leading-relaxed text-duo-mute">
        {view === 'chart' && plotted.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-bold">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: ACCENT }} />
              Mỗi điểm là một lần tập được chấm
            </span>
            {hasWarnings && (
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-full border-2" style={{ borderColor: ACCENT }} />
                Lần tập có lưu ý khi quay (điểm có thể chưa chính xác)
              </span>
            )}
            {hasBreak && (
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-3 border-l border-dashed border-duo-mute" />
                Mẫu mới
              </span>
            )}
          </div>
        )}
        {hasBreak && <div className="text-yellow-800">{BREAK_NOTE}</div>}
        {view === 'chart' && plotted.length === 1 && <div>Cần ít nhất 2 lần tập được chấm để thấy xu hướng.</div>}
        {view === 'chart' && unscored > 0 && plotted.length > 0 && (
          <div>
            {unscored} lần “{SESSION_STATUS_LABEL.INSUFFICIENT}” không có điểm nên không vẽ trên biểu đồ — xem ở chế độ Bảng.
          </div>
        )}
        {showDisclaimer && <div>{EXERCISE_DISCLAIMER}</div>}
      </div>
    </div>
  )
}
