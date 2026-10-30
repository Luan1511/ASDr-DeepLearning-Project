import { AlertTriangle, FlaskConical } from 'lucide-react'
import type { ScreeningResult } from '../lib/types'
import { ModelScoreBar, RiskPill } from './RiskPill'
import { GaitFeaturesCard } from './GaitFeaturesCard'
import { InfoTooltip } from './Tooltip'

function QualityNotice({ result }: { result: ScreeningResult }) {
  const quality = result.gaitFeatures?.quality
  if (!quality || quality.level === 'good') return null
  const poor = quality.level === 'poor'
  return (
    <div
      className={[
        'rounded-2xl px-4 py-3 text-sm font-semibold leading-relaxed',
        poor ? 'bg-red-50 text-duo-red' : 'bg-yellow-50 text-yellow-900',
      ].join(' ')}
    >
      <div className="flex items-center gap-2 font-extrabold">
        <AlertTriangle className="h-4 w-4 flex-shrink-0 stroke-[2.5]" />
        {poor ? 'Chất lượng video thấp — kết quả không đáng tin cậy' : 'Chất lượng video trung bình'}
      </div>
      {quality.warnings.length > 0 && (
        <ul className="mt-1.5 list-disc space-y-0.5 pl-6 text-xs font-bold">
          {quality.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Shared result block for the upload panel and the history detail. */
export function ScreeningResultView({ result, showGaitByDefault = false }: { result: ScreeningResult; showGaitByDefault?: boolean }) {
  const mock = result.provider === 'mock'
  return (
    <div className="space-y-4">
      {mock && (
        <div className="flex items-center gap-2 rounded-2xl bg-duo-mist px-4 py-2.5 text-xs font-extrabold text-duo-mute">
          <FlaskConical className="h-4 w-4 stroke-[2.5]" />
          Chế độ mô phỏng: kết quả ngẫu nhiên để thử giao diện, không phải kết quả của mô hình.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-extrabold text-duo-ink">Mức cần theo dõi:</span>
        <RiskPill risk={result.riskLevel} />
        <InfoTooltip
          content={
            <span>
              Kết quả chỉ tham khảo, không thay thế chẩn đoán y khoa.
              {result.calibrated === false && !mock && (
                <>
                  {' '}— Ngưỡng phân mức hiện chưa được hiệu chỉnh trên dữ liệu kiểm định độc lập.
                </>
              )}
            </span>
          }
          position="top"
          widthClass="w-72"
        />
      </div>

      {result.asdProbability !== null && !mock && (
        <ModelScoreBar
          asdProbability={result.asdProbability}
          riskLevel={result.riskLevel}
          threshold={result.decisionThreshold}
          highRiskThreshold={result.highRiskThreshold}
        />
      )}

      <QualityNotice result={result} />

      <div className="rounded-2xl bg-duo-mist px-4 py-3 text-sm font-semibold leading-relaxed text-duo-ink">
        {result.recommendation}
      </div>

      {result.gaitFeatures && <GaitFeaturesCard features={result.gaitFeatures} defaultOpen={showGaitByDefault} />}


    </div>
  )
}
