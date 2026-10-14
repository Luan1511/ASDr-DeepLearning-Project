import type { GaitFeatures } from './types'
import { formatNumber, formatPercent } from './format'

export type GaitMetricKey = keyof GaitFeatures['metrics']

export type GaitMetricDef = {
  key: GaitMetricKey
  label: string
  hint: string
  format: (v: number) => string
  /**
   * Shown in the per-child trend chart: `unit` labels the value axis, whose
   * ticks are `value × scale`. Metrics that depend on the clip itself (step
   * count) or are covered by another row (left/right arm swing) have none.
   */
  trend?: { unit: string; scale: number }
}

/** Descriptive gait metrics in display order (backend/src/services/gaitFeatures.ts). */
export const GAIT_METRICS: GaitMetricDef[] = [
  { key: 'stepCount', label: 'Số bước phát hiện', hint: 'Số lần chạm đất nhận ra được trong video.', format: (v) => formatNumber(v, 0) },
  {
    key: 'cadenceStepsPerMin',
    label: 'Nhịp bước',
    hint: 'Số bước mỗi phút.',
    format: (v) => `${formatNumber(v, 0)} bước/phút`,
    trend: { unit: 'bước/phút', scale: 1 },
  },
  {
    key: 'stepTimeMeanSec',
    label: 'Thời gian mỗi bước',
    hint: 'Trung bình giữa hai lần chạm đất liên tiếp.',
    format: (v) => `${formatNumber(v, 2)} giây`,
    trend: { unit: 'giây', scale: 1 },
  },
  {
    key: 'stepTimeCv',
    label: 'Độ dao động nhịp bước',
    hint: 'Càng cao thì nhịp bước càng không đều.',
    format: (v) => formatPercent(v),
    trend: { unit: '%', scale: 100 },
  },
  {
    key: 'stepTimeAsymmetry',
    label: 'Chênh lệch bước trái – phải',
    hint: 'Khác biệt thời gian giữa bước chân trái và phải.',
    format: (v) => formatPercent(v),
    trend: { unit: '%', scale: 100 },
  },
  {
    key: 'stepLengthLegRatio',
    label: 'Độ dài bước',
    hint: 'So với chiều dài chân của chính trẻ.',
    format: (v) => `${formatNumber(v, 2)} × chiều dài chân`,
    trend: { unit: '× chiều dài chân', scale: 1 },
  },
  {
    key: 'walkingSpeedLegPerSec',
    label: 'Tốc độ đi',
    hint: 'Quãng đường mỗi giây, tính theo chiều dài chân.',
    format: (v) => `${formatNumber(v, 2)} chiều dài chân/giây`,
    trend: { unit: 'chiều dài chân/giây', scale: 1 },
  },
  {
    key: 'trunkLeanDeg',
    label: 'Độ nghiêng thân về trước',
    hint: 'Góc trung bình của thân so với phương thẳng đứng.',
    format: (v) => `${formatNumber(v, 1)}°`,
    trend: { unit: 'độ', scale: 1 },
  },
  {
    key: 'trunkSwayDeg',
    label: 'Độ lắc thân',
    hint: 'Mức thay đổi góc thân trong lúc đi.',
    format: (v) => `${formatNumber(v, 1)}°`,
    trend: { unit: 'độ', scale: 1 },
  },
  {
    key: 'armSwingLeft',
    label: 'Biên độ vung tay trái',
    hint: 'So với chiều dài thân.',
    format: (v) => `${formatNumber(v, 2)} × chiều dài thân`,
  },
  {
    key: 'armSwingRight',
    label: 'Biên độ vung tay phải',
    hint: 'So với chiều dài thân.',
    format: (v) => `${formatNumber(v, 2)} × chiều dài thân`,
  },
  {
    key: 'armSwingAsymmetry',
    label: 'Chênh lệch vung tay',
    hint: 'Khác biệt biên độ giữa hai tay.',
    format: (v) => formatPercent(v),
    trend: { unit: '%', scale: 100 },
  },
  {
    key: 'heelRaiseRatio',
    label: 'Tỉ lệ nhón gót (thử nghiệm)',
    hint: 'Tỉ lệ khung hình chân trụ có gót nhấc cao. Độ tin cậy thấp với video thường.',
    format: (v) => formatPercent(v),
    trend: { unit: '%', scale: 100 },
  },
]
