import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { RiskLevel } from '@prisma/client'
import {
  asdProbabilityFromRaw,
  buildRecommendation,
  normalizePrediction,
  resolveThresholds,
  riskFromProbability,
} from '../src/services/screeningResult'
import type { OpenPosePrediction } from '../src/services/openposeService'

const basePrediction: OpenPosePrediction = {
  file: 'subject',
  T_in: 120,
  J: 18,
  p_typical: 0.2,
  p_asd: 0.8,
  threshold: 0.5,
}

describe('resolveThresholds', () => {
  it('uses the ML server thresholds when present', () => {
    assert.deepEqual(
      resolveThresholds({ threshold: 0.42, high_risk_threshold: 0.8, calibrated: true }, { highRiskThreshold: 0.7 }),
      { threshold: 0.42, highRiskThreshold: 0.8, calibrated: true },
    )
  })

  it('falls back to backend defaults for older ML servers', () => {
    assert.deepEqual(resolveThresholds(undefined, { threshold: 0.6, highRiskThreshold: 0.7 }), {
      threshold: 0.6,
      highRiskThreshold: 0.7,
      calibrated: false,
    })
    assert.equal(resolveThresholds({}, { highRiskThreshold: 0.7 }).threshold, 0.5)
  })

  it('never puts the HIGH tier below the decision threshold', () => {
    assert.equal(resolveThresholds({ threshold: 0.8 }, { highRiskThreshold: 0.7 }).highRiskThreshold, 0.8)
  })
})

describe('riskFromProbability', () => {
  const t = { threshold: 0.5, highRiskThreshold: 0.7, calibrated: false }
  it('maps tier boundaries inclusively', () => {
    assert.equal(riskFromProbability(0.49, t), RiskLevel.LOW)
    assert.equal(riskFromProbability(0.5, t), RiskLevel.MEDIUM)
    assert.equal(riskFromProbability(0.69, t), RiskLevel.MEDIUM)
    assert.equal(riskFromProbability(0.7, t), RiskLevel.HIGH)
  })
})

describe('normalizePrediction', () => {
  it('stores p_asd as the model score (not max(p_asd, p_typical))', () => {
    const low = normalizePrediction({ ...basePrediction, p_asd: 0.04, p_typical: 0.96 }, { highRiskThreshold: 0.7 })
    assert.equal(low.riskLevel, RiskLevel.LOW)
    assert.equal(low.asdProbability, 0.04)
    assert.equal(low.confidenceScore, 0.96)
    assert.match(low.recommendation, /4\/100/)
    // Legacy columns keep the old derivation for older readers of the shared DB.
    assert.deepEqual(low.legacyScores, {
      eyeContactScore: 0.96,
      motorPatternScore: 0.96,
      responseBehaviorScore: 0.96,
      repetitiveBehaviorScore: 0.04,
    })
  })

  it('formats the model version from the checkpoint name and hash', () => {
    const n = normalizePrediction(
      { ...basePrediction, model: { checkpoint: 'finetuned_best_model.pth', sha256: 'abcdef0123456789abcdef' } },
      { highRiskThreshold: 0.7 },
    )
    assert.equal(n.modelVersion, 'finetuned_best_model.pth@abcdef012345')
    assert.equal(n.riskLevel, RiskLevel.HIGH)
  })

  it('rejects responses without a valid probability', () => {
    assert.throws(() => normalizePrediction({ ...basePrediction, p_asd: Number.NaN }, { highRiskThreshold: 0.7 }))
    assert.throws(() => normalizePrediction({ ...basePrediction, p_asd: 1.5 }, { highRiskThreshold: 0.7 }))
  })
})

describe('buildRecommendation', () => {
  it('never phrases the result as a diagnosis', () => {
    for (const risk of [RiskLevel.LOW, RiskLevel.MEDIUM, RiskLevel.HIGH]) {
      const text = buildRecommendation(risk, 0.66).toLowerCase()
      assert.ok(!/(chẩn đoán là|bị tự kỷ|mắc asd|mắc tự kỷ)/.test(text), text)
      assert.match(text, /66\/100/)
    }
  })

  it('warns loudly when the video quality is poor', () => {
    assert.match(buildRecommendation(RiskLevel.HIGH, 0.9, 'poor'), /KHÔNG đáng tin cậy/)
    assert.doesNotMatch(buildRecommendation(RiskLevel.HIGH, 0.9, 'good'), /đáng tin cậy/)
  })
})

describe('asdProbabilityFromRaw', () => {
  it('reads p_asd from stored ML responses', () => {
    assert.equal(asdProbabilityFromRaw({ response: { prediction: { p_asd: 0.12 } } }), 0.12)
    assert.equal(asdProbabilityFromRaw({ prediction: { p_asd: 0.3 } }), 0.3)
    assert.equal(asdProbabilityFromRaw({ provider: 'mock', confidence_score: 0.8 }), null)
    assert.equal(asdProbabilityFromRaw(null), null)
  })
})
