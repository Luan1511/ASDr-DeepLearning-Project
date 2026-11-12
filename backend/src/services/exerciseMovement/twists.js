'use strict'

const coordination = require('./coordination.js')

const INVERTED = 'ARM_LEG_COORDINATION_INVERTED'
const REPEATED = 'TWIST_REPEAT_DIRECTION'
const STILL = 'TWIST_LEGS_STILL'
const DELAY = 'TWIST_REVERSAL_DELAY'
const minObserved = coordination.SETTINGS.minObservedShare
const minConfidence = coordination.SETTINGS.minConfidence
const minTimingFps = 10

function check(code, evaluated, reason) {
  return evaluated ? { code, status: 'evaluated' } : { code, status: 'unmeasurable', reason }
}

function event(code, label, feedback, run, evidence) {
  return {
    code, label, feedback,
    startSec: run[0].startSec,
    endSec: run.at(-1).endSec,
    evidence,
  }
}

function runs(items, key, minLength, maxGap = 0.08) {
  const result = []
  let current = []
  let currentKey = null
  const flush = () => {
    if (current.length >= minLength) result.push(current)
    current = []
  }
  for (const item of items) {
    const nextKey = item && key(item)
    const contiguous = !current.length || item?.startSec - current.at(-1).endSec <= maxGap
    if (!nextKey || nextKey !== currentKey || !contiguous) flush()
    if (nextKey) current.push(item)
    currentKey = nextKey
  }
  flush()
  return result
}

function neutralCenter(neutralFrames) {
  const samples = coordination.signals(neutralFrames ?? [])
  const visible = samples.filter(row => row.observed)
  if (visible.length < 4 || visible.length / samples.length < minObserved) return null
  if (visible.at(-1).timeSec - visible[0].timeSec < 0.18) return null
  const arm = visible.map(row => row.armRaw)
  const knee = visible.map(row => row.legRaw)
  if (coordination.excursion(arm) > 0.05 || coordination.excursion(knee) > 0.04) return null
  return { arm: coordination.median(arm), knee: coordination.median(knee) }
}

function sufficientlyObserved(visible, sampleCount, startSec, endSec, sourceFps) {
  if (visible.length / sampleCount < minObserved) return false
  // A single long occlusion can hide the entire leg change within an otherwise visible cycle.
  const maximumGap = Math.max(0.22, 1.6 / sourceFps)
  let previous = startSec
  for (const row of visible) {
    if (row.timeSec - previous > maximumGap) return false
    previous = row.timeSec
  }
  return endSec - previous <= maximumGap
}

function directionalStrokes(rows, neutral, sourceFps) {
  // Keep every outward-and-return stroke, including repeated strokes with the same sign.
  // A quiet starting stance anchors direction even when the whole attempt stays on one side.
  const armDeadband = 0.025
  const minArmPeak = 0.045
  const minKneePeak = 0.025
  const direction = rows.map(row => {
    if (!Number.isFinite(row.arm)) return null
    const offset = row.arm - neutral.arm
    return Math.abs(offset) > armDeadband ? Math.sign(offset) : 0
  })
  const strokes = []
  for (let start = 0; start < rows.length;) {
    const side = direction[start]
    let end = start + 1
    while (end < rows.length && direction[end] === side) end++
    if (side === null) strokes.push(null)
    if (side) {
      const samples = rows.slice(start, end)
      const peak = Math.max(...samples.map(row => Math.abs(row.arm - neutral.arm)))
      if (peak >= minArmPeak) {
        const bounded = start > 0 && end < rows.length && direction[start - 1] !== null && direction[end] !== null
        const duration = end < rows.length ? rows[end].timeSec - rows[start].timeSec : 0
        const visible = samples.filter(row => row.observed)
        if (bounded && duration >= Math.max(0.16, 1 / sourceFps) &&
          sufficientlyObserved(visible, samples.length, rows[start].timeSec, rows[end].timeSec, sourceFps)) {
          const knee = coordination.median(visible.map(row => row.leg - neutral.knee))
          const kneeSide = Math.abs(knee) >= minKneePeak ? Math.sign(knee) : null
          strokes.push({ startSec: rows[start].timeSec, endSec: rows[end].timeSec, side, kneeSide, peak, knee })
        } else {
          strokes.push(null)
        }
      }
    }
    start = end
  }
  return strokes
}

function stationaryWindows(frames, analysis, sourceFps) {
  // Inspect both knees and ankles relative to their hips, since symmetric motion can
  // cancel in a midpoint. A single visible leg cannot establish that both stayed still.
  const legJoints = [9, 10, 11, 12, 13, 14]
  return analysis.cycles.map(cycle => {
    if (cycle.durationSec < coordination.SETTINGS.minCycleSec || cycle.durationSec > coordination.SETTINGS.maxCycleSec) return null
    const signals = analysis.rows.slice(cycle.startIndex, cycle.endIndex)
    const visible = []
    for (let index = cycle.startIndex; index < cycle.endIndex; index++) {
      const frame = frames[index]
      const row = analysis.rows[index]
      const observed = frame.pose && legJoints.every(joint => frame.pose[joint] && frame.confidence?.[joint] >= minConfidence)
      if (!observed || !Number.isFinite(row.armRaw)) continue
      const channels = []
      for (const [joint, hip] of [[10, 9], [11, 9], [13, 12], [14, 12]]) {
        channels.push(frame.pose[joint][0] - frame.pose[hip][0], frame.pose[joint][1] - frame.pose[hip][1])
      }
      visible.push({ timeSec: row.timeSec, arm: row.armRaw, channels })
    }
    if (!sufficientlyObserved(visible, signals.length, cycle.startSec, cycle.endSec, sourceFps)) return null
    const arm = visible.map(row => row.arm)
    const armRange = coordination.excursion(arm)
    if (armRange < coordination.SETTINGS.minArmExcursionTorso) return null
    const limbs = visible[0].channels.map((_, channel) => visible.map(row => row.channels[channel]))
    const legRange = Math.max(...limbs.map(coordination.excursion))
    const smallCoordinatedMotion = limbs.some(limb =>
      coordination.excursion(limb) >= 0.012 && Math.abs(coordination.pearson(arm, limb) ?? 0) >= 0.65)
    return { ...cycle, armRange, legRange, stationary: legRange < 0.035 && !smallCoordinatedMotion }
  })
}

function reversalOffsets(analysis, relation, cycles) {
  const rowsByTime = new Map(analysis.rows.map(row => [row.timeSec, row]))
  const kneeExtrema = coordination.extrema(analysis.rows.map(row => ({ ...row, armZ: row.legZ })))
    .filter(peak => Number.isFinite(analysis.rows[peak.index].legRaw))
  return cycles.map(cycle => {
    if (!cycle.valid || !Number.isFinite(rowsByTime.get(cycle.midpointSec)?.armRaw)) return null
    const armType = cycle.firstExtremum === 'max' ? 'min' : 'max'
    const kneeType = relation === 'together' ? armType : armType === 'max' ? 'min' : 'max'
    const candidates = kneeExtrema.filter(peak => peak.type === kneeType &&
      Math.abs(peak.timeSec - cycle.midpointSec) <= 0.4 * cycle.durationSec)
    if (!candidates.length) return null
    const nearest = candidates.reduce((best, peak) => Math.abs(peak.timeSec - cycle.midpointSec) <
      Math.abs(best.timeSec - cycle.midpointSec) ? peak : best)
    return { ...cycle, offsetCycles: (nearest.timeSec - cycle.midpointSec) / cycle.durationSec }
  })
}

function buildReference(guideFrames, guideSourceFps) {
  const guide = coordination.analyze(guideFrames)
  const pattern = coordination.referencePattern(guide)
  const offsets = pattern.relation !== 'uncertain' && guideSourceFps >= minTimingFps
    ? reversalOffsets(guide, pattern.relation, guide.cycles).filter(Boolean)
    : []
  if (offsets.length < 3) return { pattern, reversal: null }
  const delay = coordination.median(offsets.map(cycle => cycle.offsetCycles))
  const spread = coordination.median(offsets.map(cycle => Math.abs(cycle.offsetCycles - delay))) ?? 0
  return { pattern, reversal: { delay, spread } }
}

function analyzeWithReference(frames, reference, options = {}) {
  const sourceFps = options.sourceFps ?? coordination.SETTINGS.hz
  const guideSourceFps = options.guideSourceFps ?? coordination.SETTINGS.hz
  const analysis = coordination.analyze(frames)
  const { pattern } = reference
  const hasReference = pattern.relation !== 'uncertain'
  const comparison = coordination.compare(pattern, analysis)
  const events = comparison.events.map(result => ({
    code: result.code, label: result.label, startSec: result.startSec, endSec: result.endSec,
    feedback: pattern.relation === 'opposed'
      ? 'Con thử cho tay này đi cùng chân bên kia như bạn hướng dẫn nhé.'
      : 'Con thử đổi hướng tay và chân theo cùng nhịp như mẫu nhé.',
    evidence: { cycles: result.completeCycles, attemptCorrelation: result.medianCorrelation, guideCorrelation: pattern.medianCorrelation },
  }))
  const checks = [check(INVERTED, hasReference && runs(comparison.cycles, cycle => cycle.valid, 2).length > 0,
    hasReference ? 'insufficient_visible_cycles' : 'reference_pattern_uncertain')]

  const neutral = neutralCenter(options.neutralFrames)
  const strokes = hasReference && neutral ? directionalStrokes(analysis.rows, neutral, sourceFps) : []
  const maxStrokeGap = 2
  const repeated = runs(strokes, stroke => stroke.kneeSide && `${stroke.side}/${stroke.kneeSide}`, 3, maxStrokeGap)
  for (const run of repeated) {
    events.push(event(REPEATED, 'Lặp hướng xoay trong hình chiếu', 'Con thử đổi sang phía bên kia ở nhịp tiếp theo nhé.', run,
      { repeatedStrokes: run.length, armDirection: run[0].side, kneeDirection: run[0].kneeSide }))
  }
  checks.push(check(REPEATED, runs(strokes, stroke => Boolean(stroke.kneeSide), 3, maxStrokeGap).length > 0,
    !hasReference ? 'reference_pattern_uncertain' : !neutral ? 'neutral_stance_required' : 'insufficient_visible_strokes'))

  const movement = hasReference ? stationaryWindows(frames, analysis, sourceFps) : []
  for (const run of runs(movement, cycle => cycle.stationary, 2)) {
    events.push(event(STILL, 'Tay đổi hướng, chân gần như giữ nguyên', 'Con thử chuyển gối và chân theo nhịp tay nhé.', run,
      { cycles: run.length, armExcursionTorso: coordination.median(run.map(cycle => cycle.armRange)),
        legExcursionTorso: Math.max(...run.map(cycle => cycle.legRange)) }))
  }
  checks.push(check(STILL, runs(movement, () => true, 2).length > 0,
    hasReference ? 'insufficient_visible_arm_cycles_and_legs' : 'reference_pattern_uncertain'))

  const timingResolution = Math.min(sourceFps, guideSourceFps)
  const hasTimingReference = reference.reversal !== null && timingResolution >= minTimingFps
  const referenceDelay = reference.reversal?.delay ?? 0
  const spread = reference.reversal?.spread ?? 0
  const reversals = hasTimingReference ? reversalOffsets(analysis, pattern.relation, comparison.cycles) : []
  const delayed = runs(reversals, cycle => {
    if (cycle.status === 'inverted') return null
    const difference = cycle.offsetCycles - referenceDelay
    const tolerance = Math.max(0.18, 3 * spread + 0.08, 2 / (timingResolution * cycle.durationSec))
    return Math.abs(difference) > tolerance ? Math.sign(difference) : null
  }, 2)
  for (const run of delayed) {
    const difference = coordination.median(run.map(cycle => cycle.offsetCycles - referenceDelay))
    const label = difference > 0 ? 'Chân đổi hướng muộn hơn tay so với mẫu' : 'Chân đổi hướng sớm hơn tay so với mẫu'
    events.push(event(DELAY, label, 'Con thử đổi hướng tay và chân theo cùng nhịp như mẫu nhé.', run,
      { cycles: run.length, deviationCycles: difference, guideOffsetCycles: referenceDelay }))
  }
  checks.push(check(DELAY, runs(reversals, cycle => cycle.status !== 'inverted', 2).length > 0,
    timingResolution < minTimingFps ? 'source_frame_rate_too_low' : !hasTimingReference ? 'reference_reversals_uncertain' : 'insufficient_visible_reversals'))

  return { checks, events: events.sort((a, b) => a.startSec - b.startSec), reference: pattern }
}

function analyze(frames, guideFrames = [], options = {}) {
  return analyzeWithReference(frames, buildReference(guideFrames, options.guideSourceFps ?? coordination.SETTINGS.hz), options)
}

module.exports = { analyze, buildReference, analyzeWithReference }

