import { useState } from 'react'
import { ChevronDown, Footprints } from 'lucide-react'
import type { GaitFeatures } from '../lib/types'
import { GAIT_VIEW_LABEL, formatNumber, formatPercent } from '../lib/format'

type Metrics = GaitFeatures['metrics']

type Row = {
  key: keyof Metrics
  label: string
  hint: string
  format: (v: number) => string
}

const ROWS: Row[] = [
  { key: 'stepCount', label: 'Số bước phát hiện', hint: 'Số lần chạm đất nhận ra được trong video.', format: (v) => formatNumber(v, 0) },
  { key: 'cadenceStepsPerMin', label: 'Nhịp bước', hint: 'Số bước mỗi phút.', format: (v) => `${formatNumber(v, 0)} bước/phút` },
  { key: 'stepTimeMeanSec', label: 'Thời gian mỗi bước', hint: 'Trung bình giữa hai lần chạm đất liên tiếp.', format: (v) => `${formatNumber(v, 2)} giây` },
  { key: 'stepTimeCv', label: 'Độ dao động nhịp bước', hint: 'Càng cao thì nhịp bước càng không đều.', format: (v) => formatPercent(v) },
  { key: 'stepTimeAsymmetry', label: 'Chênh lệch bước trái – phải', hint: 'Khác biệt thời gian giữa bước chân trái và phải.', format: (v) => formatPercent(v) },
  { key: 'stepLengthLegRatio', label: 'Độ dài bước', hint: 'So với chiều dài chân của chính trẻ.', format: (v) => `${formatNumber(v, 2)} × chiều dài chân` },
  { key: 'walkingSpeedLegPerSec', label: 'Tốc độ đi', hint: 'Quãng đường mỗi giây, tính theo chiều dài chân.', format: (v) => `${formatNumber(v, 2)} chiều dài chân/giây` },
  { key: 'trunkLeanDeg', label: 'Độ nghiêng thân về trước', hint: 'Góc trung bình của thân so với phương thẳng đứng.', format: (v) => `${formatNumber(v, 1)}°` },
  { key: 'trunkSwayDeg', label: 'Độ lắc thân', hint: 'Mức thay đổi góc thân trong lúc đi.', format: (v) => `${formatNumber(v, 1)}°` },
  { key: 'armSwingLeft', label: 'Biên độ vung tay trái', hint: 'So với chiều dài thân.', format: (v) => `${formatNumber(v, 2)} × chiều dài thân` },
  { key: 'armSwingRight', label: 'Biên độ vung tay phải', hint: 'So với chiều dài thân.', format: (v) => `${formatNumber(v, 2)} × chiều dài thân` },
  { key: 'armSwingAsymmetry', label: 'Chênh lệch vung tay', hint: 'Khác biệt biên độ giữa hai tay.', format: (v) => formatPercent(v) },
  { key: 'heelRaiseRatio', label: 'Tỉ lệ nhón gót (thử nghiệm)', hint: 'Tỉ lệ khung hình chân trụ có gót nhấc cao. Độ tin cậy thấp với video thường.', format: (v) => formatPercent(v) },
]

export function GaitFeaturesCard({ features, defaultOpen = false }: { features: GaitFeatures; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  const rows = ROWS.filter((r) => features.metrics[r.key] !== null && features.metrics[r.key] !== undefined)
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
