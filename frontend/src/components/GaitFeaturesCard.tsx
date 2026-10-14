import { useState } from 'react'
import { ChevronDown, Footprints } from 'lucide-react'
import type { GaitFeatures } from '../lib/types'
import { GAIT_VIEW_LABEL, formatNumber, formatPercent } from '../lib/format'
import { GAIT_METRICS } from '../lib/gaitMetrics'

export function GaitFeaturesCard({ features, defaultOpen = false }: { features: GaitFeatures; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  const rows = GAIT_METRICS.filter((r) => features.metrics[r.key] !== null && features.metrics[r.key] !== undefined)
  const q = features.quality

  return (
    <div className="rounded-2xl bg-duo-mist shadow-card-inner">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="flex items-center gap-2 text-sm font-extrabold text-duo-ink">
          <Footprints className="h-4 w-4 stroke-[2.5] text-duo-green-dark" />
          Chỉ số dáng đi (tham khảo)
        </span>
        <ChevronDown className={['h-4 w-4 text-duo-mute transition-transform', open ? 'rotate-180' : ''].join(' ')} />
      </button>

      {open && (
        <div className="space-y-3 px-4 pb-4">
          <div className="flex flex-wrap gap-2 text-xs font-bold text-duo-mute">
            <span className="rounded-full bg-white px-2.5 py-1 shadow-chip">{GAIT_VIEW_LABEL[features.view]}</span>
            {q.durationSec !== null && (
              <span className="rounded-full bg-white px-2.5 py-1 shadow-chip">{formatNumber(q.durationSec, 1)} giây</span>
            )}
            <span className="rounded-full bg-white px-2.5 py-1 shadow-chip">
              Thấy trẻ trong {formatPercent(q.personCoverage)} khung hình
            </span>
          </div>

          {rows.length > 0 ? (
            <dl className="divide-y divide-duo-line/70 rounded-2xl bg-white px-3 shadow-card-inner">
              {rows.map((r) => (
                <div key={r.key} className="flex items-start justify-between gap-4 py-2.5">
                  <dt className="min-w-0">
                    <div className="text-sm font-extrabold text-duo-ink">{r.label}</div>
                    <div className="text-xs font-semibold text-duo-mute">{r.hint}</div>
                  </dt>
                  <dd className="flex-shrink-0 text-right text-sm font-black tabular-nums text-duo-ink">
                    {r.format(features.metrics[r.key] as number)}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <div className="rounded-2xl bg-white px-3 py-3 text-sm font-semibold text-duo-mute shadow-card-inner">
              Chưa đủ dữ liệu để tính chỉ số dáng đi.
            </div>
          )}

          <p className="text-xs font-semibold leading-relaxed text-duo-mute">
            Các chỉ số mô tả chuyển động, chưa có ngưỡng chuẩn cho trẻ em và không được dùng để tính mức sàng lọc. Có thể dùng để so
            sánh giữa các lần quay của cùng một trẻ.
          </p>
        </div>
      )}
    </div>
  )
}
