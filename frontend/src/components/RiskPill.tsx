import type { RiskLevel } from '../lib/types'

export function RiskPill({ risk }: { risk: RiskLevel }) {
  const map: Record<RiskLevel, { label: string; cls: string }> = {
    LOW: { label: 'Thấp', cls: 'bg-duo-green-soft text-duo-green-dark' },
    MEDIUM: { label: 'Trung bình', cls: 'bg-yellow-100 text-yellow-800' },
    HIGH: { label: 'Cao', cls: 'bg-red-100 text-duo-red' },
  }
  const v = map[risk]
  return (
    <span className={['inline-flex items-center rounded-full px-3 py-1 text-xs font-extrabold uppercase tracking-wide', v.cls].join(' ')}>
      {v.label}
    </span>
  )
}

export function ConfidenceGauge({ confidenceScore, riskLevel }: { confidenceScore: number; riskLevel: RiskLevel }) {
  const asdPct = Math.round(confidenceScore * 100)
  const typicalPct = 100 - asdPct
  const asdColor = riskLevel === 'HIGH' ? '#FF4B4B' : riskLevel === 'MEDIUM' ? '#FFC800' : '#166534'

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-sm font-extrabold text-duo-ink">Khả năng ASD</span>
          <span className="text-sm font-black tabular-nums" style={{ color: asdColor }}>
            {asdPct}%
          </span>
        </div>
        <div className="h-4 w-full overflow-hidden rounded-full bg-duo-mist">
          <div className="h-4 rounded-full" style={{ width: `${asdPct}%`, background: asdColor }} />
        </div>
      </div>
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-sm font-extrabold text-duo-ink">Phát triển điển hình</span>
          <span className="text-sm font-black tabular-nums text-duo-blue">{typicalPct}%</span>
        </div>
        <div className="h-4 w-full overflow-hidden rounded-full bg-duo-mist">
          <div className="h-4 rounded-full bg-duo-blue" style={{ width: `${typicalPct}%` }} />
        </div>
      </div>
    </div>
  )
}
