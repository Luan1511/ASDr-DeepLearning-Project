import type { RiskLevel } from '../lib/types'

export function RiskPill({ risk }: { risk: RiskLevel }) {
  const map: Record<RiskLevel, { label: string; cls: string }> = {
    LOW: {
      label: 'Nguy cơ thấp',
      cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    },
    MEDIUM: {
      label: 'Nguy cơ trung bình',
      cls: 'bg-amber-50 text-amber-700 ring-amber-200',
    },
    HIGH: {
      label: 'Nguy cơ cao',
      cls: 'bg-rose-50 text-rose-700 ring-rose-200',
    },
  }

  const v = map[risk]
  return (
    <span
      className={[
        'inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ring-1 whitespace-nowrap',
        v.cls,
      ].join(' ')}
    >
      {v.label}
    </span>
  )
}

/** Confidence gauge: shows ASD confidence % vs Typical % */
export function ConfidenceGauge({ confidenceScore, riskLevel }: { confidenceScore: number; riskLevel: RiskLevel }) {
  const asdPct = Math.round(confidenceScore * 100)
  const typicalPct = 100 - asdPct

  const asdColor = riskLevel === 'HIGH' ? '#F43F5E' : riskLevel === 'MEDIUM' ? '#F59E0B' : '#10B981'
  const typicalColor = '#6C63FF'

  return (
    <div className="space-y-4">
      {/* ASD confidence */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-sm font-medium text-slate-700">Khả năng ASD</span>
          <span
            className="text-sm font-bold tabular-nums"
            style={{ color: asdColor }}
          >
            {asdPct}%
          </span>
        </div>
        <div className="h-3 w-full rounded-full bg-slate-100 overflow-hidden">
          <div
            className="h-3 rounded-full transition-all duration-700"
            style={{ width: `${asdPct}%`, background: asdColor }}
          />
        </div>
      </div>

      {/* Typical confidence */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-sm font-medium text-slate-700">Phát triển điển hình</span>
          <span className="text-sm font-bold tabular-nums" style={{ color: typicalColor }}>
            {typicalPct}%
          </span>
        </div>
        <div className="h-3 w-full rounded-full bg-slate-100 overflow-hidden">
          <div
            className="h-3 rounded-full transition-all duration-700"
            style={{ width: `${typicalPct}%`, background: typicalColor }}
          />
        </div>
      </div>
    </div>
  )
}
