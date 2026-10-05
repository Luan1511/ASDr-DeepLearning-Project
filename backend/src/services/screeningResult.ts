/**
 * Turns an ML prediction into what we store and show: a 3-level risk tier,
 * the model score, and a careful Vietnamese recommendation. Pure functions so
 * the mapping can be unit-tested without the ML server.
 */
import { RiskLevel } from '@prisma/client'
import type { OpenPosePrediction } from './openposeService'
import type { QualityLevel } from './gaitFeatures'

export type ScreeningThresholds = {
  threshold: number
  highRiskThreshold: number
  calibrated: boolean
}

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n))
}

function isProbability(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1
}

/**
 * Thresholds come from the ML server (which reads calibration.json); backend
 * env values only fill gaps for older ML servers that do not send them.
 */
export function resolveThresholds(
  prediction: Pick<OpenPosePrediction, 'threshold' | 'high_risk_threshold' | 'calibrated'> | undefined,
  defaults: { threshold?: number; highRiskThreshold: number },
): ScreeningThresholds {
  const threshold = isProbability(prediction?.threshold)
    ? prediction!.threshold!
    : isProbability(defaults.threshold)
      ? defaults.threshold!
      : 0.5
  const highRaw = isProbability(prediction?.high_risk_threshold)
    ? prediction!.high_risk_threshold!
    : defaults.highRiskThreshold
  return {
    threshold,
    // A HIGH tier below the decision threshold would be meaningless.
    highRiskThreshold: Math.max(highRaw, threshold),
    calibrated: prediction?.calibrated === true,
  }
}

export function riskFromProbability(pAsd: number, thresholds: ScreeningThresholds): RiskLevel {
  if (pAsd >= thresholds.highRiskThreshold) return RiskLevel.HIGH
  if (pAsd >= thresholds.threshold) return RiskLevel.MEDIUM
  return RiskLevel.LOW
}

const QUALITY_NOTE: Record<QualityLevel, string> = {
  good: '',
  fair: ' Chất lượng video ở mức trung bình nên kết quả kém chắc chắn hơn; có thể quay lại theo hướng dẫn để so sánh.',
  poor: ' Lưu ý: chất lượng video thấp nên kết quả này KHÔNG đáng tin cậy. Vui lòng quay lại video theo hướng dẫn rồi sàng lọc lại.',
}

/**
 * Wording rules: describe what the model observed, never say the child "has"
 * ASD, and always point to professionals for an actual assessment.
 */
export function buildRecommendation(riskLevel: RiskLevel, pAsd: number, quality?: QualityLevel | null): string {
  const score = Math.round(clamp01(pAsd) * 100)
  let text: string
  if (riskLevel === RiskLevel.HIGH) {
    text = `Mô hình ghi nhận nhiều đặc điểm vận động tương đồng với nhóm trẻ có dấu hiệu ASD trong dữ liệu huấn luyện (điểm sàng lọc ${score}/100). Gia đình nên sớm trao đổi với bác sĩ nhi hoặc chuyên gia phát triển để được đánh giá trực tiếp.`
  } else if (riskLevel === RiskLevel.MEDIUM) {
    text = `Mô hình ghi nhận một số đặc điểm vận động cần theo dõi (điểm sàng lọc ${score}/100). Gia đình nên tiếp tục quan sát và cân nhắc tham vấn chuyên gia nếu còn lo lắng.`
  } else {
    text = `Mô hình ghi nhận ít đặc điểm vận động tương đồng với nhóm trẻ có dấu hiệu ASD (điểm sàng lọc ${score}/100). Kết quả chỉ mang tính tham khảo; gia đình vẫn nên tiếp tục theo dõi sự phát triển của trẻ.`
  }
  return text + (quality ? QUALITY_NOTE[quality] : '')
}

export type NormalizedScreening = {
  riskLevel: RiskLevel
  asdProbability: number
  confidenceScore: number
  /**
   * Values for the deprecated eyeContact/motorPattern/responseBehavior/
   * repetitiveBehavior columns, derived exactly as before (p_typical ×3,
   * p_asd). Written only so older backends sharing the database can still read
   * new rows (Prisma fails with P2032 on NULL in a field it thinks is required).
   * Never exposed by the API or shown in the UI.
   */
  legacyScores: {
    eyeContactScore: number
    motorPatternScore: number
    responseBehaviorScore: number
    repetitiveBehaviorScore: number
  }
  decisionThreshold: number
  highRiskThreshold: number
  calibrated: boolean
  modelVersion: string | null
  recommendation: string
}

export function normalizePrediction(
  prediction: OpenPosePrediction,
  defaults: { threshold?: number; highRiskThreshold: number },
  quality?: QualityLevel | null,
): NormalizedScreening {
  if (!isProbability(prediction?.p_asd)) {
    throw new Error(`ML response has no valid p_asd: ${JSON.stringify(prediction?.p_asd)}`)
  }
  const pAsd = prediction.p_asd
  const pTypical = isProbability(prediction.p_typical) ? prediction.p_typical : 1 - pAsd
  const thresholds = resolveThresholds(prediction, defaults)
  const riskLevel = riskFromProbability(pAsd, thresholds)
  const sha = prediction.model?.sha256
  const modelVersion = prediction.model?.checkpoint
    ? `${prediction.model.checkpoint}${sha ? `@${sha.slice(0, 12)}` : ''}`
    : null

  return {
    riskLevel,
    asdProbability: pAsd,
    confidenceScore: clamp01(Math.max(pAsd, pTypical)),
    legacyScores: {
      eyeContactScore: pTypical,
      motorPatternScore: pTypical,
      responseBehaviorScore: pTypical,
      repetitiveBehaviorScore: pAsd,
    },
    decisionThreshold: thresholds.threshold,
    highRiskThreshold: thresholds.highRiskThreshold,
    calibrated: thresholds.calibrated,
    modelVersion,
    recommendation: buildRecommendation(riskLevel, pAsd, quality),
  }
}

/**
 * Older rows only kept p_asd inside rawAiResponse; expose it uniformly so the
 * UI never has to fall back to confidenceScore (which is max(p_asd, p_typical)
 * and was wrongly displayed as "khả năng ASD").
 */
export function asdProbabilityFromRaw(raw: unknown): number | null {
  const r = raw as any
  const candidate = r?.response?.prediction?.p_asd ?? r?.prediction?.p_asd
  return isProbability(candidate) ? candidate : null
}
