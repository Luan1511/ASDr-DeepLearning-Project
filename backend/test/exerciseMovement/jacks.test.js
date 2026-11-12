'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { analyze } = require('../../src/services/exerciseMovement/jacks.js')

const PHASE = 'JACKS_ARM_FOOT_OUT_OF_PHASE'
const OPEN = 'JACKS_MISSING_FOOT_OPEN'
const CLOSE = 'JACKS_MISSING_FOOT_CLOSE'
const IDLE = 'JACKS_ONE_ARM_IDLE'
const wave = phase => (1 - Math.cos(2 * Math.PI * phase)) / 2

function frame(timeSec, leftArm, rightArm, width, hidden = []) {
  const pose = Array(25).fill(null)
  const confidence = Array(25).fill(0)
  pose[2] = [-0.25, 1]
  pose[5] = [0.25, 1]
  pose[4] = [-0.34, 1 + rightArm]
  pose[7] = [0.34, 1 + leftArm]
  pose[11] = [-width / 2, -1.35]
  pose[14] = [width / 2, -1.35]
  for (const index of [2, 5, 4, 7, 11, 14]) confidence[index] = hidden.includes(index) ? 0 : 0.9
  return { timeSec, pose, confidence }
}

function bout({ period = 1.6, repetitions = 4, armRange = 1.05, footRange = 0.6,
  foot = wave, idle = null, hidden = () => [], timeOffset = 0 } = {}) {
  return Array.from({ length: Math.round(15 * period * repetitions) + 1 }, (_, index) => {
    const time = index / 15
    const phase = time / period
    const raise = -0.53 + armRange * wave(phase)
    return frame(time + timeOffset, idle === 'left' ? -0.53 : raise, idle === 'right' ? -0.53 : raise,
      0.24 + footRange * foot(phase), hidden(phase))
  })
}

const guide = bout()
const neutralFrames = Array.from({ length: 16 }, (_, i) => frame(i / 15, -0.53, -0.53, 0.24))
const opts = { neutralFrames, sourceFps: 15, guideSourceFps: 15 }
const codes = result => result.events.map(event => event.code)
const state = (result, code) => result.checks.find(check => check.code === code).status

test('correct smaller, slower jacks are evaluated with no warning', () => {
  const result = analyze(bout({ period: 2.8, armRange: 0.23, footRange: 0.15 }), guide, opts)
  assert.ok(result.checks.every(check => check.status === 'evaluated'))
  assert.deepEqual(codes(result), [])
})

test('feet opening while arms lower is a phase error with original time offsets', () => {
  const result = analyze(bout({ foot: phase => 1 - wave(phase), timeOffset: 12 }), guide, opts)
  assert.deepEqual(codes(result), [PHASE])
  assert.ok(result.events[0].evidence.medianCorrelation < -0.9)
  assert.ok(result.events[0].startSec >= 12)
  assert.ok(result.events[0].endSec > result.events[0].startSec)
})

test('repeated substantial relative delay is also detected with no neutral baseline', () => {
  const result = analyze(bout({ foot: phase => wave(phase - 0.3) }), guide)
  assert.deepEqual(codes(result), [PHASE])
  assert.equal(state(result, OPEN), 'unmeasurable')
  assert.equal(state(result, CLOSE), 'unmeasurable')
})

test('closed and open static feet are reported as separate missing phases', () => {
  const closed = analyze(bout({ foot: () => 0 }), guide, opts)
  const open = analyze(bout({ foot: () => 1 }), guide, opts)
  assert.deepEqual(codes(closed), [OPEN])
  assert.deepEqual(codes(open), [CLOSE])
  assert.equal(state(closed, PHASE), 'unmeasurable')
  assert.equal(state(open, PHASE), 'unmeasurable')
})

test('one arm idle can coexist with either missing foot phase', () => {
  const closed = analyze(bout({ idle: 'left', foot: () => 0, armRange: 0.15 }), guide, opts)
  const open = analyze(bout({ idle: 'right', foot: () => 1 }), guide, opts)
  assert.deepEqual(codes(closed).sort(), [OPEN, IDLE].sort())
  assert.deepEqual(codes(open).sort(), [CLOSE, IDLE].sort())
  assert.equal(closed.events.find(event => event.code === IDLE).evidence.idleSide, 'left')
  assert.equal(open.events.find(event => event.code === IDLE).evidence.idleSide, 'right')
})

test('an occluded ankle or idle-arm candidate is left unmeasurable', () => {
  const feetHidden = analyze(bout({ foot: () => 0, hidden: () => [11] }), guide, opts)
  const armHidden = analyze(bout({ idle: 'left', hidden: phase => wave(phase) > 0.7 ? [7] : [] }), guide, opts)
  assert.equal(state(feetHidden, OPEN), 'unmeasurable')
  assert.equal(state(feetHidden, CLOSE), 'unmeasurable')
  assert.equal(state(feetHidden, PHASE), 'unmeasurable')
  assert.equal(state(armHidden, IDLE), 'unmeasurable')
  assert.deepEqual(codes(feetHidden), [])
  assert.deepEqual(codes(armHidden), [])
})

test('a static foot width without a trusted neutral is ambiguous', () => {
  const result = analyze(bout({ foot: () => 1 }), guide)
  assert.equal(state(result, OPEN), 'unmeasurable')
  assert.equal(state(result, CLOSE), 'unmeasurable')
  assert.deepEqual(codes(result), [])
})

test('a single missed opening does not trigger repeated feedback', () => {
  const result = analyze(bout({ foot: phase => phase >= 1 && phase < 2 ? 0 : wave(phase) }), guide, opts)
  assert.equal(state(result, OPEN), 'evaluated')
  assert.ok(!codes(result).includes(OPEN))
})

