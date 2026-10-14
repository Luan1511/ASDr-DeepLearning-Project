import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { ChartLine, Table2 } from 'lucide-react'
import type { ChildScreening, GaitView, QualityLevel } from '../lib/types'
import { GAIT_METRICS, type GaitMetricDef, type GaitMetricKey } from '../lib/gaitMetrics'
import { GAIT_VIEW_LABEL, QUALITY_LABEL, formatDateTime, formatDayMonth, formatNumber, formatTime } from '../lib/format'

// Single series: the brand green (validated: >= 3:1 on white). Grid = duo-line.
const ACCENT = '#166534'
const GRID = '#E5E5E5'
const SURFACE = '#FFFFFF'
const PLOT_HEIGHT = 200
const MARGIN = { top: 24, right: 24, bottom: 30, left: 52 }
const EDGE_PAD = 18
const TOOLTIP_WIDTH = 200
const TOOLTIP_HEIGHT = 72
const TOOLTIP_GAP = 14

/** `session` numbers screenings of the child chronologically, as in the session list. */
type TrendPoint = { id: string; session: number; at: string; value: number; view: GaitView; quality: QualityLevel }
type TrendMetric = GaitMetricDef & { trend: NonNullable<GaitMetricDef['trend']> }

const TREND_METRICS = GAIT_METRICS.filter((m): m is TrendMetric => Boolean(m.trend))

function chronological(screenings: ChildScreening[]) {
  return [...screenings].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
}

function pointsFor(sorted: ChildScreening[], key: GaitMetricKey): TrendPoint[] {
  const points: TrendPoint[] = []
  sorted.forEach((s, i) => {
    const features = s.result?.gaitFeatures
    const value = features?.metrics[key]
    if (!features || typeof value !== 'number' || !Number.isFinite(value)) return
    points.push({ id: s.id, session: i + 1, at: s.createdAt, value, view: features.view, quality: features.quality.level })
  })
  return points
}

/** Clean ticks (1/2/5 × 10^k) for a domain that always includes zero. */
function valueAxis(values: number[]) {
  let lo = Math.min(0, ...values)
  let hi = Math.max(0, ...values)
  if (hi === lo) hi = lo + 1
  const raw = (hi - lo) / 4
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const norm = raw / magnitude
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * magnitude
  lo = Math.floor(lo / step) * step
  hi = Math.ceil(hi / step) * step
  const ticks: number[] = []
  for (let t = lo; t <= hi + step / 2; t += step) ticks.push(Number(t.toFixed(10)))
  return { lo, hi, ticks, decimals: Math.max(0, -Math.floor(Math.log10(step))) }
}

function unitSuffix(unit: string) {
  if (unit === '%') return '%'
  if (unit === 'độ') return '°'
  return ''
}

/** "06/10"; a session on the same day as the previous one shows its time instead. */
function axisLabel(points: TrendPoint[], i: number) {
  const day = formatDayMonth(points[i].at)
  if (i > 0 && new Date(points[i - 1].at).toDateString() === new Date(points[i].at).toDateString()) {
    return formatTime(points[i].at)
  }
  return day
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

function TrendPlot({ metric, points }: { metric: TrendMetric; points: TrendPoint[] }) {
  const [wrapRef, width] = useElementWidth<HTMLDivElement>()
  const [active, setActive] = useState<number | null>(null)
  const { unit, scale } = metric.trend
  const suffix = unitSuffix(unit)
  const axis = useMemo(() => valueAxis(points.map((p) => p.value * scale)), [points, scale])

  const n = points.length
  const plotWidth = Math.max(0, width - MARGIN.left - MARGIN.right)
  const height = MARGIN.top + PLOT_HEIGHT + MARGIN.bottom
  const xAt = (i: number) =>
    n === 1 ? MARGIN.left + plotWidth / 2 : MARGIN.left + EDGE_PAD + (i * (plotWidth - 2 * EDGE_PAD)) / (n - 1)
  const yAt = (v: number) => MARGIN.top + (1 - (v * scale - axis.lo) / (axis.hi - axis.lo)) * PLOT_HEIGHT
  const tickText = (t: number) => `${formatNumber(t, axis.decimals)}${suffix}`
  const valueText = (v: number) => `${formatNumber(v * scale, axis.decimals + 1)}${suffix}`
  const shownLabels = labelIndices(n, plotWidth)

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
    else return
    e.preventDefault()
  }

  const last = points[n - 1]
  const activePoint = active !== null ? points[active] : null
  const linePath = points.map((p, i) => `${i ? 'L' : 'M'}${xAt(i).toFixed(1)},${yAt(p.value).toFixed(1)}`).join(' ')

  // Beside the point when there is room, otherwise above (or below) it, so the
  // tooltip never hides the mark it describes (narrow phone screens).
  let tooltipStyle: { left: number; top: number } | null = null
  if (activePoint && active !== null) {
    const x = xAt(active)
    const y = yAt(activePoint.value)
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
      aria-label={`Biểu đồ ${metric.label} qua ${n} lần quay. Dùng phím mũi tên trái phải để xem từng lần.`}
      onKeyDown={onKeyDown}
      onFocus={() => setActive((a) => a ?? n - 1)}
      onBlur={() => setActive(null)}
    >
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`${metric.label}: lần gần nhất ${valueText(last.value)}`}
          onPointerMove={onPointerMove}
          onPointerDown={onPointerMove}
          onPointerLeave={(e) => e.pointerType === 'mouse' && setActive(null)}
          className="block touch-none select-none"
        >
          {unit !== '%' && unit !== 'độ' && (
            <text x={MARGIN.left - 8} y={12} textAnchor="start" className="fill-duo-mute text-[11px] font-bold">
              {unit}
            </text>
          )}

          {axis.ticks.map((t) => {
            const y = MARGIN.top + (1 - (t - axis.lo) / (axis.hi - axis.lo)) * PLOT_HEIGHT
            return (
              <g key={t}>
                <line x1={MARGIN.left} x2={MARGIN.left + plotWidth} y1={y} y2={y} stroke={GRID} strokeWidth={1} />
                <text x={MARGIN.left - 8} y={y + 4} textAnchor="end" className="fill-duo-mute text-[11px] font-bold tabular-nums">
                  {tickText(t)}
                </text>
              </g>
            )
          })}

          {points.map((p, i) =>
            shownLabels.has(i) ? (
              <text
                key={p.id}
                x={xAt(i)}
                y={MARGIN.top + PLOT_HEIGHT + 20}
                textAnchor="middle"
                className="fill-duo-mute text-[11px] font-bold tabular-nums"
              >
                {axisLabel(points, i)}
              </text>
            ) : null,
          )}

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

          {n > 1 && <path d={linePath} fill="none" stroke={ACCENT} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}

          {points.map((p, i) => {
            const poor = p.quality === 'poor'
            const r = active === i ? 6 : 5
            return (
              <g key={p.id}>
                <circle cx={xAt(i)} cy={yAt(p.value)} r={r + 2} fill={SURFACE} />
                <circle
                  cx={xAt(i)}
                  cy={yAt(p.value)}
                  r={poor ? r - 1 : r}
                  fill={poor ? SURFACE : ACCENT}
                  stroke={ACCENT}
                  strokeWidth={poor ? 2 : 0}
                />
              </g>
            )
          })}

          {/* Direct label on the latest session only. */}
          <text
            x={Math.min(Math.max(xAt(n - 1), MARGIN.left + 24), MARGIN.left + plotWidth - 24)}
            y={Math.max(yAt(last.value) - 12, 10)}
            textAnchor="middle"
            className="fill-duo-ink text-xs font-black"
          >
            {valueText(last.value)}
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
            <span className="text-sm font-black text-duo-ink">{metric.format(activePoint.value)}</span>
          </div>
          <div className="mt-0.5 text-xs font-bold text-duo-mute">
            Lần {activePoint.session} • {formatDateTime(activePoint.at)}
          </div>
          <div className="text-xs font-bold text-duo-mute">
            {GAIT_VIEW_LABEL[activePoint.view]} • {QUALITY_LABEL[activePoint.quality]}
          </div>
        </div>
      )}
    </div>
  )
}

function TrendTable({ metric, points }: { metric: TrendMetric; points: TrendPoint[] }) {
  return (
    <div className="overflow-x-auto rounded-2xl bg-white shadow-card-inner">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="divider-duo text-xs font-extrabold uppercase tracking-wide text-duo-mute">
            <th className="px-3 py-2">Lần</th>
            <th className="px-3 py-2">Ngày quay</th>
            <th className="px-3 py-2 text-right">{metric.label}</th>
            <th className="px-3 py-2">Góc quay</th>
            <th className="px-3 py-2">Chất lượng</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-duo-line/70 font-bold text-duo-ink">
          {points.map((p) => (
            <tr key={p.id}>
              <td className="px-3 py-2 tabular-nums">{p.session}</td>
              <td className="px-3 py-2 tabular-nums">{formatDateTime(p.at)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{metric.format(p.value)}</td>
              <td className="px-3 py-2">{GAIT_VIEW_LABEL[p.view]}</td>
              <td className="px-3 py-2">{QUALITY_LABEL[p.quality]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Per-child trend of one descriptive gait metric across screenings. */
export function GaitTrendChart({ screenings }: { screenings: ChildScreening[] }) {
  const available = useMemo(() => {
    const sorted = chronological(screenings)
    return TREND_METRICS.map((metric) => ({ metric, points: pointsFor(sorted, metric.key) })).filter((m) => m.points.length > 0)
  }, [screenings])
  const [selectedKey, setSelectedKey] = useState<GaitMetricKey | null>(null)
  const [view, setView] = useState<'chart' | 'table'>('chart')

  if (available.length === 0) {
    return (
      <div className="rounded-2xl bg-duo-mist px-4 py-6 text-center text-sm font-semibold text-duo-mute">
        Chưa có lần sàng lọc nào tính được chỉ số dáng đi. Biểu đồ xu hướng sẽ xuất hiện sau khi có kết quả.
      </div>
    )
  }

  const fallback = available.find((m) => m.points.length >= 2) ?? available[0]
  const current = available.find((m) => m.metric.key === selectedKey) ?? fallback
  const { metric, points } = current
  const views = new Set(points.map((p) => p.view))
  const mixedViews = views.has('side') && (views.has('frontal') || views.has('oblique'))
  const hasPoor = points.some((p) => p.quality === 'poor')

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Chọn chỉ số">
        {available.map(({ metric: m, points: pts }) => {
          const selected = m.key === metric.key
          return (
            <button
              key={m.key}
              type="button"
              aria-pressed={selected}
              onClick={() => setSelectedKey(m.key)}
              className={[
                'rounded-full px-3 py-1.5 text-xs font-extrabold transition-all',
                selected ? 'bg-duo-green-soft text-duo-green-dark shadow-ring-green' : 'bg-duo-mist text-duo-mute hover:text-duo-ink',
              ].join(' ')}
            >
              {m.label}
              <span className="ml-1 font-bold opacity-70">({pts.length})</span>
            </button>
          )
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-extrabold text-duo-ink">{metric.label}</div>
          <div className="text-xs font-semibold text-duo-mute">{metric.hint}</div>
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

      {view === 'chart' ? <TrendPlot key={metric.key} metric={metric} points={points} /> : <TrendTable metric={metric} points={points} />}

      <div className="space-y-1.5 text-xs font-semibold leading-relaxed text-duo-mute">
        {view === 'chart' && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-bold">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: ACCENT }} />
              Mỗi điểm là một lần quay
            </span>
            {hasPoor && (
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-full border-2" style={{ borderColor: ACCENT }} />
                Chất lượng video thấp (kém tin cậy)
              </span>
            )}
          </div>
        )}
        {points.length === 1 && <div>Cần ít nhất 2 lần quay có chỉ số này để thấy xu hướng.</div>}
        {mixedViews && (
          <div className="text-yellow-800">
            Các lần quay có góc quay khác nhau (ngang / chính diện) nên giá trị có thể không so sánh trực tiếp được.
          </div>
        )}
        <div>
          Chỉ số mô tả chuyển động, chưa có ngưỡng chuẩn cho trẻ em và không dùng để tính mức sàng lọc. Nên so sánh các lần
          quay có cùng góc quay và điều kiện tương tự.
        </div>
      </div>
    </div>
  )
}
