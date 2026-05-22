import { RiskLevel } from '@prisma/client'

export type MockAiResult = {
  risk_level: 'low' | 'medium' | 'high'
  confidence_score: number
  behavioral_scores: {
    eye_contact: number
    motor_pattern: number
    response_behavior: number
    repetitive_behavior: number
  }
  recommendation: string
}

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n))
}

export function generateMockAiResult(): MockAiResult {
  // Higher score => more typical behavior; lower => higher risk.
  const eye = clamp01(0.4 + Math.random() * 0.6)
  const motor = clamp01(0.4 + Math.random() * 0.6)
  const response = clamp01(0.4 + Math.random() * 0.6)
  const repetitive = clamp01(0.4 + Math.random() * 0.6)

  const avg = (eye + motor + response + repetitive) / 4

  let risk: MockAiResult['risk_level']
  if (avg >= 0.75) risk = 'low'
  else if (avg >= 0.6) risk = 'medium'
  else risk = 'high'

  const confidence = clamp01(0.65 + Math.random() * 0.3)

  const recommendation =
    'Kết quả mang tính tham khảo và không thay thế chẩn đoán y khoa. Nếu bạn lo lắng về sự phát triển của trẻ, hãy trao đổi với bác sĩ nhi/ chuyên gia tâm lý phát triển để được đánh giá trực tiếp.'

  return {
    risk_level: risk,
    confidence_score: Number(confidence.toFixed(2)),
    behavioral_scores: {
      eye_contact: Number(eye.toFixed(2)),
      motor_pattern: Number(motor.toFixed(2)),
      response_behavior: Number(response.toFixed(2)),
      repetitive_behavior: Number(repetitive.toFixed(2)),
    },
    recommendation,
  }
}

export function toRiskEnum(risk: MockAiResult['risk_level']): RiskLevel {
  if (risk === 'low') return RiskLevel.LOW
  if (risk === 'medium') return RiskLevel.MEDIUM
  return RiskLevel.HIGH
}
