import type { RiskLevel } from '../lib/types'

const RISK_STYLE: Record<RiskLevel, { label: string; cls: string; color: string }> = {
  LOW: { label: 'Thấp', cls: 'bg-duo-green-soft text-duo-green-dark', color: '#166534' },
  MEDIUM: { label: 'Trung bình', cls: 'bg-yellow-100 text-yellow-800', color: '#CA8A04' },
  HIGH: { label: 'Cao', cls: 'bg-red-100 text-duo-red', color: '#FF4B4B' },
}

export function RiskPill({ risk }: { risk: RiskLevel }) {
  const v = RISK_STYLE[risk]
  return (
    <span className={['inline-flex items-center rounded-full px-3 py-1 text-xs font-extrabold uppercase tracking-wide', v.cls].join(' ')}>
      {v.label}
    </span>
  )
}

/**
 * The ST-GCN score for the ASD class, with the decision thresholds marked.
 * Deliberately labelled "điểm sàng lọc", not a probability of having ASD.
 */
import { Tooltip, InfoTooltip } from './Tooltip'

export function ModelScoreBar({
  asdProbability,
  riskLevel,
  threshold,
  highRiskThreshold,
}: {
  asdProbability: number
  riskLevel: RiskLevel
  threshold?: number | null
  highRiskThreshold?: number | null
}) {
  const score = Math.round(Math.max(0, Math.min(1, asdProbability)) * 100)
  const color = RISK_STYLE[riskLevel].color
  const markers = [threshold, highRiskThreshold].filter(
    (t, i, all): t is number => typeof t === 'number' && t > 0 && t < 1 && all.indexOf(t) === i,
  )

  const explanation =
    'Điểm càng cao, chuyển động của trẻ càng giống nhóm trẻ có dấu hiệu ASD trong dữ liệu huấn luyện. Đây không phải xác suất chẩn đoán.'

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-sm font-extrabold text-duo-ink">
          <span>Điểm sàng lọc của mô hình</span>
          <InfoTooltip content={explanation} widthClass="w-72" />
        </span>
        <span className="text-sm font-black tabular-nums" style={{ color }}>
          {score}/100
        </span>
      </div>

      <Tooltip content={explanation} className="w-full" widthClass="w-72">
        <div className="relative h-4 w-full overflow-hidden rounded-full bg-duo-mist cursor-help">
          <div className="h-4 rounded-full transition-all" style={{ width: `${score}%`, background: color }} />
          {markers.map((t) => (
            <div
              key={t}
              className="absolute top-0 h-4 w-0.5 bg-duo-ink/40"
              style={{ left: `${t * 100}%` }}
              title={`Ngưỡng ${Math.round(t * 100)}`}
            />
          ))}
        </div>
      </Tooltip>
    </div>
  )
}
