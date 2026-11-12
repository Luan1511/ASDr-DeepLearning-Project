'use strict'

const { interpolateSmallGaps, median, pearson, round } = require('./coordination.js')

const RULES = {
  JACKS_ARM_FOOT_OUT_OF_PHASE: {
    label: 'Tay và chân lệch nhịp mở–khép',
    feedback: 'Con thử nâng tay cùng lúc mở chân nhé.',
  },
  JACKS_MISSING_FOOT_OPEN: {
    label: 'Thiếu pha mở chân',
    feedback: 'Khi nâng tay, con thử mở chân nhẹ sang hai bên nhé.',
  },
  JACKS_MISSING_FOOT_CLOSE: {
    label: 'Thiếu pha khép chân',
    feedback: 'Khi hạ tay, con đưa hai chân về vị trí ban đầu nhé.',
  },
  JACKS_ONE_ARM_IDLE: {
    label: 'Một tay giữ nguyên qua nhiều nhịp',
    feedback: 'Con thử nâng và hạ cả hai tay cùng nhau nhé.',
  },
}
const LIMITS = Object.freeze({
  confidence: 0.3, observationShare: 0.8, armMotion: 0.08, idleArm: 0.05,
  footMotion: 0.075, closedMargin: 0.055, openMargin: 0.095,
  minRepetitions: 2, minimumPhaseLag: 0.22,
})
const finite = Number.isFinite

function quantile(values, proportion) {
  const sorted = values.filter(finite).sort((a, b) => a - b)
  if (!sorted.length) return null
  const position = proportion * (sorted.length - 1)
  const lower = Math.floor(position)
  return sorted[lower] + (sorted[Math.ceil(position)] - sorted[lower]) * (position - lower)
}

function range(values) {
  const valid = values.filter(finite)
  return valid.length ? Math.max(...valid) - Math.min(...valid) : 0
}

function measure(frame, joints, value) {
  if (!joints.every(index => frame.pose?.[index]?.every(finite) &&
    frame.confidence?.[index] >= LIMITS.confidence)) return null
  return value(frame.pose)
}

function footWidth(frame) {
  return measure(frame, [11, 14], pose => Math.abs(pose[11][0] - pose[14][0]))
}

function readSignals(frames) {
  const left = frames.map(frame => measure(frame, [5, 7], pose => pose[7][1] - pose[5][1]))
  const right = frames.map(frame => measure(frame, [2, 4], pose => pose[4][1] - pose[2][1]))
  const arms = left.map((value, i) => finite(value) && finite(right[i]) ? (value + right[i]) / 2 : null)
  const feet = frames.map(footWidth)
  return { times: frames.map(frame => frame.timeSec), left, right, arms, feet }
}

function smoothed(values) {
  const filled = interpolateSmallGaps(values, 2)
  return filled.map((value, i) => {
    if (!finite(value)) return null
    const neighbours = filled.slice(Math.max(0, i - 1), i + 2).filter(finite)
    return neighbours.reduce((sum, item) => sum + item, 0) / neighbours.length
  })
}

function adequatelyObserved(values, times, start, end, sourceFps) {
  const duration = times[end] - times[start]
  if (!(duration >= 0.3 && duration * sourceFps >= 3)) return false
  const observed = values.slice(start, end + 1).filter(finite).length
  if (observed / (end - start + 1) < LIMITS.observationShare) return false
  // A missing span may conceal an entire open or close phase even when overall coverage looks adequate.
  let lastObserved = times[start]
  const maxGap = Math.max(0.22, 1.6 / sourceFps)
  for (let i = start; i <= end; i++) {
    if (!finite(values[i])) continue
    if (times[i] - lastObserved > maxGap) return false
    lastObserved = times[i]
  }
  return times[end] - lastObserved <= maxGap
}

function highCenter(values, times, start, end) {
  const segment = values.slice(start, end + 1).filter(finite)
  const low = quantile(segment, 0.1)
  const high = Math.max(...segment)
  const threshold = low + 0.85 * (high - low)
  return median(times.slice(start, end + 1).filter((_, i) =>
    finite(values[start + i]) && values[start + i] >= threshold))
}

function repetitions(raw, times, sourceFps) {
  const values = smoothed(raw)
  const low = quantile(values, 0.1)
  const motion = quantile(values, 0.9) - low
  if (!finite(low) || motion < LIMITS.armMotion) return []
  const lower = low + 0.3 * motion
  const upper = low + 0.65 * motion
  const pulses = []
  let start = null
  let raised = false
  for (let i = 0; i < values.length; i++) {
    const value = values[i]
    if (!finite(value)) {
      start = null
      raised = false
      continue
    }
    if (value >= upper && start !== null) raised = true
    if (value > lower) continue
    if (raised && adequatelyObserved(raw, times, start, i, sourceFps)) {
      const observed = raw.slice(start, i + 1).filter(finite)
      if (range(observed) >= LIMITS.armMotion) {
        pulses.push({ start, end: i, peakSec: highCenter(values, times, start, i) })
      }
    }
    start = i
    raised = false
  }
  return pulses
}

function cycleWindow(pulses, index, times) {
  const pulse = pulses[index]
  const previous = pulses[index - 1]
  const next = pulses[index + 1]
  const duration = times[pulse.end] - times[pulse.start]
  const startTime = Math.max(times[pulse.start] - 0.28 * duration,
    previous ? (times[previous.end] + times[pulse.start]) / 2 : times[0])
  const endTime = Math.min(times[pulse.end] + 0.28 * duration,
    next ? (times[pulse.end] + times[next.start]) / 2 : times.at(-1))
  let start = pulse.start
  let end = pulse.end
  while (start > 0 && times[start - 1] >= startTime) start--
  while (end + 1 < times.length && times[end + 1] <= endTime) end++
  const nearbyPeriods = [previous && pulse.peakSec - previous.peakSec, next && next.peakSec - pulse.peakSec]
    .filter(period => finite(period) && period >= duration && period <= 2.2 * duration)
  return { start, end, period: median(nearbyPeriods) ?? 1.35 * duration }
}

function neutralWidth(frames, sourceFps) {
  const widths = frames.map(footWidth)
  if (frames.length < 2 || !adequatelyObserved(widths, frames.map(frame => frame.timeSec),
    0, frames.length - 1, sourceFps)) return null
  if (quantile(widths, 0.9) - quantile(widths, 0.1) > LIMITS.closedMargin) return null
  return median(widths)
}

function armFootCycles(data, sourceFps, neutral) {
  let armSignal = data.arms
  let pulses = repetitions(armSignal, data.times, sourceFps)
  if (pulses.length < LIMITS.minRepetitions) {
    // An idle arm can halve the mean excursion. The moving arm still supplies a repetition clock.
    for (const side of ['left', 'right']) {
      const sidePulses = repetitions(data[side], data.times, sourceFps)
      if (sidePulses.length <= pulses.length) continue
      armSignal = data[side]
      pulses = sidePulses
    }
  }
  const arms = smoothed(armSignal)
  const feet = smoothed(data.feet)
  return pulses.map((pulse, index) => {
    const { start, end, period } = cycleWindow(pulses, index, data.times)
    const startSec = data.times[start]
    const endSec = data.times[end]
    const result = { startSec, endSec, phase: null, feetObserved: false, missingOpen: false, missingClose: false }
    if (!adequatelyObserved(data.feet, data.times, start, end, sourceFps)) return result
    const widths = data.feet.slice(start, end + 1).filter(finite)
    const minWidth = Math.min(...widths)
    const maxWidth = Math.max(...widths)
    result.feetObserved = true
    result.minWidth = minWidth
    result.maxWidth = maxWidth
    if (neutral !== null) {
      result.missingOpen = maxWidth <= neutral + LIMITS.closedMargin
      result.missingClose = minWidth >= neutral + LIMITS.openMargin
    }
    if (maxWidth - minWidth < LIMITS.footMotion || result.missingOpen || result.missingClose) return result
    const armWindow = arms.slice(start, end + 1)
    const footWindow = feet.slice(start, end + 1)
    const correlation = pearson(armWindow, footWindow)
    if (correlation === null) return result
    const footPeak = highCenter(feet, data.times, start, end)
    if (!finite(footPeak)) return result
    const lagSec = footPeak - pulse.peakSec
    result.phase = { correlation, lagSec, period, relativeLag: lagSec / period }
    return result
  })
}

function idleArmCycles(data, movingSide, sourceFps) {
  const idleSide = movingSide === 'left' ? 'right' : 'left'
  const pulses = repetitions(data[movingSide], data.times, sourceFps)
  return pulses.map((_, index) => {
    const { start, end } = cycleWindow(pulses, index, data.times)
    const observed = adequatelyObserved(data[idleSide], data.times, start, end, sourceFps)
    const idleRange = observed ? range(data[idleSide].slice(start, end + 1)) : null
    return { startSec: data.times[start], endSec: data.times[end], idleSide, observed, idleRange,
      idle: observed && idleRange <= LIMITS.idleArm }
  })
}

function repeatedEvents(code, cycles, hasFault, evidence) {
  const events = []
  let run = []
  function flush() {
    if (run.length >= LIMITS.minRepetitions) {
      events.push({ code, ...RULES[code], startSec: round(run[0].startSec), endSec: round(run.at(-1).endSec),
        evidence: { repetitions: run.length, ...evidence(run) } })
    }
    run = []
  }
  for (const cycle of cycles) {
    if (!hasFault(cycle)) {
      flush()
      continue
    }
    const previous = run.at(-1)
    if (previous && cycle.startSec - previous.endSec > Math.max(0.8, previous.endSec - previous.startSec)) flush()
    run.push(cycle)
  }
  flush()
  return events
}

function check(code, cycles, reason) {
  return cycles >= LIMITS.minRepetitions
    ? { code, status: 'evaluated', evidence: { eligibleRepetitions: cycles } }
    : { code, status: 'unmeasurable', reason, evidence: { eligibleRepetitions: cycles } }
}

function buildReference(guideFrames, guideFps) {
  const guidePhases = armFootCycles(readSignals(guideFrames), guideFps, null)
    .map(cycle => cycle.phase).filter(phase => phase && phase.correlation >= 0.5)
  // The standard exercise opens the arms and feet together. A clear guide can calibrate a small offset.
  const measuredGuideLag = guidePhases.length >= 2 ? median(guidePhases.map(phase => phase.relativeLag)) : 0
  const guideLag = Math.max(-0.12, Math.min(0.12, measuredGuideLag))
  return { guideLag, guidePhaseRepetitions: guidePhases.length }
}

function analyzeWithReference(frames, reference, options = {}) {
  const sourceFps = options.sourceFps > 0 ? options.sourceFps : 15
  const guideFps = options.guideSourceFps > 0 ? options.guideSourceFps : 15
  const data = readSignals(frames)
  const neutral = neutralWidth(options.neutralFrames ?? [], sourceFps)
  const { guideLag, guidePhaseRepetitions } = reference
  const cycles = armFootCycles(data, sourceFps, neutral)
  const idleCycles = ['left', 'right'].map(side => idleArmCycles(data, side, sourceFps))
  const phaseCode = 'JACKS_ARM_FOOT_OUT_OF_PHASE'
  const openCode = 'JACKS_MISSING_FOOT_OPEN'
  const closeCode = 'JACKS_MISSING_FOOT_CLOSE'
  const idleCode = 'JACKS_ONE_ARM_IDLE'
  const observableFootCycles = neutral === null ? 0 : cycles.filter(cycle => cycle.feetObserved).length
  const observableArmCycles = Math.max(...idleCycles.map(group => group.filter(cycle => cycle.observed).length))
  const minimumLagSec = Math.max(0.14, 1 / sourceFps + 1 / guideFps)
  const checks = [
    check(phaseCode, cycles.filter(cycle => cycle.phase).length, 'NEED_OBSERVABLE_ARM_AND_FOOT_PHASES'),
    check(openCode, observableFootCycles, neutral === null ? 'NEED_CLOSED_STANCE' : 'NEED_OBSERVABLE_FEET_AND_REPETITIONS'),
    check(closeCode, observableFootCycles, neutral === null ? 'NEED_CLOSED_STANCE' : 'NEED_OBSERVABLE_FEET_AND_REPETITIONS'),
    check(idleCode, observableArmCycles, 'NEED_OBSERVABLE_BOTH_ARMS_AND_REPETITIONS'),
  ]
  const events = [
    ...repeatedEvents(phaseCode, cycles, ({ phase }) => phase && (phase.correlation <= -0.48 ||
      (phase.correlation < 0.55 && Math.abs(phase.relativeLag - guideLag) >= LIMITS.minimumPhaseLag &&
      Math.abs(phase.lagSec - guideLag * phase.period) >= minimumLagSec)), group => ({
      medianCorrelation: round(median(group.map(cycle => cycle.phase.correlation))),
      medianRelativeLag: round(median(group.map(cycle => cycle.phase.relativeLag))),
      guideRelativeLag: round(guideLag),
    })),
    ...repeatedEvents(openCode, cycles, cycle => cycle.missingOpen, group => ({
      neutralWidthTorso: round(neutral), maxWidthTorso: round(Math.max(...group.map(cycle => cycle.maxWidth))),
    })),
    ...repeatedEvents(closeCode, cycles, cycle => cycle.missingClose, group => ({
      neutralWidthTorso: round(neutral), minWidthTorso: round(Math.min(...group.map(cycle => cycle.minWidth))),
    })),
    ...idleCycles.flatMap(group => repeatedEvents(idleCode, group, cycle => cycle.idle, run => ({
      idleSide: run[0].idleSide, maxIdleRangeTorso: round(Math.max(...run.map(cycle => cycle.idleRange))),
    }))),
  ].sort((a, b) => a.startSec - b.startSec || a.code.localeCompare(b.code))
  return { checks, events, diagnostics: { neutralWidthTorso: round(neutral), guidePhaseRepetitions,
    guideRelativeLag: round(guideLag), armRepetitions: cycles.length, sourceFps } }
}

function analyze(frames, guideFrames = [], options = {}) {
  return analyzeWithReference(frames, buildReference(guideFrames, options.guideSourceFps ?? 15), options)
}

module.exports = { analyze, buildReference, analyzeWithReference }

