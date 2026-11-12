'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { analyze } = require('../../src/services/exerciseMovement/twists.js')

function recording({ duration = 10, period = 1.2, arm = 0.24, leg = 0.14, delay = 0,
  sameSide = false, inverted = false, reflected = false, offset = 0, hiddenLegs = false,
  ankleOnly = false } = {}) {
  return Array.from({ length: Math.round(duration * 15) }, (_, index) => {
    const timeSec = index / 15
    const swing = phase => sameSide ? Math.max(0, Math.sin(phase)) : Math.sin(phase)
    const armX = arm * swing(2 * Math.PI * timeSec / period)
    const legSwing = leg * swing(2 * Math.PI * (timeSec / period - delay))
    const kneeX = ankleOnly ? 0 : legSwing * (inverted ? 1 : -1)
    const ankleX = ankleOnly ? legSwing : -kneeX
    const pose = Array(25).fill(null)
    const confidence = Array(25).fill(0.9)
    const joints = {
      2: [-0.25, 1], 5: [0.25, 1], 4: [-0.28 + armX, 0.7], 7: [0.28 + armX, 0.7],
      9: [-0.15, 0], 12: [0.15, 0], 10: [-0.15 + kneeX, -0.7], 13: [0.15 + kneeX, -0.7],
      11: [-0.15 + ankleX, -1.4], 14: [0.15 - ankleX, -1.4],
    }
    for (const [joint, [x, y]] of Object.entries(joints)) pose[joint] = [(x + offset) * (reflected ? -1 : 1), y]
    if (hiddenLegs) for (const joint of [10, 11, 13, 14]) confidence[joint] = 0.1
    return { timeSec, pose, confidence }
  })
}

const guide = recording()
const neutral = recording({ duration: 0.6, arm: 0, leg: 0 })
const options = { neutralFrames: neutral }
const codes = result => result.events.map(item => item.code)
const status = (result, code) => result.checks.find(item => item.code === code).status

test('counts repeated complete same-direction strokes even if the child never changes sides', () => {
  const result = analyze(recording({ sameSide: true }), guide, options)
  const repeated = result.events.find(item => item.code === 'TWIST_REPEAT_DIRECTION')
  assert.ok(repeated.evidence.repeatedStrokes >= 3)
  assert.ok(repeated.startSec > 0 && repeated.endSec <= 10)
})

test('detects arm motion with both legs still, and distinguishes missing knees from still legs', () => {
  const still = analyze(recording({ leg: 0 }), guide, options)
  assert.ok(codes(still).includes('TWIST_LEGS_STILL'))
  const occluded = analyze(recording({ leg: 0, hiddenLegs: true }), guide, options)
  assert.equal(codes(occluded).length, 0)
  assert.equal(status(occluded, 'TWIST_LEGS_STILL'), 'unmeasurable')
  const gaps = recording({ leg: 0 }).map(frame => {
    const phase = frame.timeSec % 1.2
    if (phase >= 0.45 && phase < 0.70) {
      for (const joint of [10, 11, 13, 14]) frame.confidence[joint] = 0.1
    }
    return frame
  })
  assert.equal(status(analyze(gaps, guide, options), 'TWIST_LEGS_STILL'), 'unmeasurable')
})

test('moving ankles prevent a still-legs warning when the knee midpoint is almost fixed', () => {
  const result = analyze(recording({ ankleOnly: true }), guide, options)
  assert.equal(status(result, 'TWIST_LEGS_STILL'), 'evaluated')
  assert.ok(!codes(result).includes('TWIST_LEGS_STILL'))
  assert.ok(!codes(analyze(recording({ leg: 0.018 }), guide, options)).includes('TWIST_LEGS_STILL'))
})

test('checks reversal timing in cycle units, separately from global tempo', () => {
  const slow = analyze(recording({ duration: 16, period: 2.5, arm: 0.055, leg: 0.035 }), guide, options)
  assert.equal(status(slow, 'TWIST_REVERSAL_DELAY'), 'evaluated')
  assert.deepEqual(codes(slow), [])
  const delayed = analyze(recording({ period: 1.6, delay: 0.24 }), guide, options)
  assert.ok(codes(delayed).includes('TWIST_REVERSAL_DELAY'))
  assert.ok(!codes(delayed).includes('ARM_LEG_COORDINATION_INVERTED'))
})

test('does not turn a phase inversion into a duplicate late-reversal warning', () => {
  const result = analyze(recording({ inverted: true }), guide, options)
  assert.ok(codes(result).includes('ARM_LEG_COORDINATION_INVERTED'))
  assert.ok(!codes(result).includes('TWIST_REVERSAL_DELAY'))
})

test('preserves independent same-direction and delayed-reversal errors in one attempt', () => {
  const result = analyze(recording({ sameSide: true, period: 1.6, delay: 0.21, leg: 0.22 }), guide, options)
  assert.ok(codes(result).includes('TWIST_REPEAT_DIRECTION'))
  assert.ok(codes(result).includes('TWIST_REVERSAL_DELAY'))
})

test('reflection and translation preserve direction-warning intervals', () => {
  const original = analyze(recording({ sameSide: true }), guide, options)
  const transformed = analyze(recording({ sameSide: true, reflected: true, offset: 3 }), guide, {
    neutralFrames: recording({ duration: 0.6, arm: 0, leg: 0, reflected: true, offset: 3 }),
  })
  const intervals = result => result.events.map(item => [item.code, item.startSec, item.endSec])
  assert.deepEqual(intervals(transformed), intervals(original))
})

test('requires a visible neutral stance for direction and enough native samples for timing', () => {
  const missingNeutral = analyze(recording({ sameSide: true }), guide)
  assert.equal(status(missingNeutral, 'TWIST_REPEAT_DIRECTION'), 'unmeasurable')
  assert.ok(!codes(missingNeutral).includes('TWIST_REPEAT_DIRECTION'))
  const sparse = analyze(recording({ delay: 0.24 }), guide, { ...options, sourceFps: 5 })
  assert.equal(status(sparse, 'TWIST_REVERSAL_DELAY'), 'unmeasurable')
  assert.ok(!codes(sparse).includes('TWIST_REVERSAL_DELAY'))
})

