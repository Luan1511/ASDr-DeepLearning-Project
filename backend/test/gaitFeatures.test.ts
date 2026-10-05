import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { computeGaitFeatures, resolveFps } from '../src/services/gaitFeatures'
import { makeWalker } from './syntheticGait'

function near(actual: number | null, expected: number, tolerance: number, label: string) {
  assert.ok(actual !== null, `${label} should not be null`)
  assert.ok(
    Math.abs((actual as number) - expected) <= tolerance,
    `${label}: expected ${expected} ± ${tolerance}, got ${actual}`,
  )
}

describe('computeGaitFeatures — side view', () => {
  const features = computeGaitFeatures({ frames: makeWalker(), fps: 30, fpsSource: 'ml' })

  it('detects the camera view and good quality', () => {
    assert.equal(features.view, 'side')
    assert.equal(features.quality.level, 'good')
    assert.equal(features.quality.fps, 30)
    assert.equal(features.quality.fpsSource, 'ml')
    assert.equal(features.quality.durationSec, 6)
    assert.deepEqual(features.quality.warnings, [])
  })

  it('recovers cadence and step timing (0.4 s steps → 150 steps/min)', () => {
    near(features.metrics.cadenceStepsPerMin, 150, 5, 'cadence')
    near(features.metrics.stepTimeMeanSec, 0.4, 0.02, 'step time')
    assert.ok(features.metrics.stepCount >= 13 && features.metrics.stepCount <= 15, `steps ${features.metrics.stepCount}`)
    assert.ok((features.metrics.stepTimeCv as number) < 0.08, `cv ${features.metrics.stepTimeCv}`)
    assert.ok((features.metrics.stepTimeAsymmetry as number) < 0.08, `asym ${features.metrics.stepTimeAsymmetry}`)
  })

  it('recovers step length, speed, trunk lean and arm swing in body units', () => {
    // max inter-ankle distance 2 × 50 px over a 200 px leg
    near(features.metrics.stepLengthLegRatio, 0.5, 0.06, 'step length')
    // 150 px/s over a 200 px leg
    near(features.metrics.walkingSpeedLegPerSec, 0.75, 0.05, 'speed')
    near(features.metrics.trunkLeanDeg, 5, 1, 'trunk lean')
    // wrist range 2 × 40 px over a 200 px torso (p5–p95 of a sinusoid ≈ 0.99 × range)
    near(features.metrics.armSwingLeft, 0.4, 0.05, 'left arm swing')
    near(features.metrics.armSwingRight, 0.4, 0.05, 'right arm swing')
    assert.ok((features.metrics.armSwingAsymmetry as number) < 0.1)
  })

  it('reports a flat-footed gait as low heel raise and a raised heel as high', () => {
    assert.ok((features.metrics.heelRaiseRatio as number) < 0.1, `flat ${features.metrics.heelRaiseRatio}`)
    const toeWalker = computeGaitFeatures({ frames: makeWalker({ heelRaisedPx: 18 }), fps: 30 })
    assert.ok((toeWalker.metrics.heelRaiseRatio as number) > 0.9, `toe ${toeWalker.metrics.heelRaiseRatio}`)
  })

  it('gives the same answers when walking right-to-left', () => {
    const leftward = computeGaitFeatures({ frames: makeWalker({ direction: -1 }), fps: 30 })
    near(leftward.metrics.cadenceStepsPerMin, 150, 5, 'cadence')
    near(leftward.metrics.walkingSpeedLegPerSec, 0.75, 0.05, 'speed')
    near(leftward.metrics.trunkLeanDeg, 5, 1, 'forward lean')
  })
})

describe('computeGaitFeatures — asymmetry and robustness', () => {
  it('measures step-time asymmetry (0.35 s left vs 0.45 s right)', () => {
    const f = computeGaitFeatures({ frames: makeWalker({ leftStepSec: 0.35, rightStepSec: 0.45 }), fps: 30 })
    near(f.metrics.stepTimeMeanSec, 0.4, 0.02, 'mean step time')
    near(f.metrics.stepTimeAsymmetry, 0.25, 0.06, 'asymmetry')
  })

  it('tolerates keypoint noise and dropped frames', () => {
    const f = computeGaitFeatures({ frames: makeWalker({ noisePx: 2, dropRate: 0.05, seed: 3 }), fps: 30 })
    near(f.metrics.cadenceStepsPerMin, 150, 8, 'cadence')
    near(f.metrics.stepLengthLegRatio, 0.5, 0.08, 'step length')
    assert.notEqual(f.quality.level, 'poor')
  })

  it('keeps tracking the walking child when a still adult is in the frame', () => {
    const f = computeGaitFeatures({ frames: makeWalker({ extraPerson: true }), fps: 30 })
    near(f.metrics.cadenceStepsPerMin, 150, 5, 'cadence')
    assert.ok(f.quality.multiPersonRatio > 0.9)
    assert.equal(f.quality.level, 'fair')
    assert.ok(f.quality.warnings.some((w) => w.includes('nhiều người')))
  })

  it('marks clips with few visible frames as poor quality', () => {
    const f = computeGaitFeatures({ frames: makeWalker({ dropRate: 0.5, seed: 11 }), fps: 30 })
    assert.equal(f.quality.level, 'poor')
  })

  it('does not invent time-based metrics without a frame rate', () => {
    const f = computeGaitFeatures({ frames: makeWalker(), fps: null })
    assert.equal(f.quality.fps, null)
    assert.equal(f.metrics.cadenceStepsPerMin, null)
    assert.equal(f.metrics.walkingSpeedLegPerSec, null)
    assert.ok(f.metrics.stepCount >= 13)
    near(f.metrics.stepLengthLegRatio, 0.5, 0.06, 'step length')
    assert.ok(f.quality.warnings.some((w) => w.includes('tốc độ khung hình')))
  })

  it('handles empty input', () => {
    const f = computeGaitFeatures({ frames: [], fps: 30 })
    assert.equal(f.quality.level, 'poor')
    assert.equal(f.metrics.stepCount, 0)
    assert.equal(f.view, 'unknown')
  })
})

describe('computeGaitFeatures — frontal view', () => {
  const f = computeGaitFeatures({ frames: makeWalker({ view: 'frontal', fps: 25 }), fps: 25 })

  it('detects the frontal view and still counts steps while the child grows in the image', () => {
    assert.equal(f.view, 'frontal')
    near(f.metrics.cadenceStepsPerMin, 150, 6, 'cadence')
  })

  it('withholds metrics that need a side view', () => {
    assert.equal(f.metrics.stepLengthLegRatio, null)
    assert.equal(f.metrics.walkingSpeedLegPerSec, null)
    assert.equal(f.metrics.armSwingLeft, null)
    assert.equal(f.metrics.heelRaiseRatio, null)
    assert.ok(f.quality.warnings.some((w) => w.includes('chính diện')))
  })
})

describe('resolveFps', () => {
  it('prefers the ML probe, then the browser duration', () => {
    assert.deepEqual(resolveFps({ mlFps: 29.97, numFrames: 100, uploadDurationMs: 2000 }), { fps: 29.97, source: 'ml' })
    assert.deepEqual(resolveFps({ mlFps: null, numFrames: 180, uploadDurationMs: 6000 }), { fps: 30, source: 'upload' })
  })

  it('rejects implausible values', () => {
    assert.deepEqual(resolveFps({ mlFps: 0, numFrames: 10, uploadDurationMs: 60_000 }), { fps: null, source: null })
    assert.deepEqual(resolveFps({ mlFps: 1000 }), { fps: null, source: null })
  })
})
