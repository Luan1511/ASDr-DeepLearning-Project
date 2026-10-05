/**
 * Interpretable gait descriptors computed from OpenPose BODY_25 keypoints of a
 * child walking in a straight line, plus a data-quality report.
 *
 * These numbers are descriptive only: they are NOT used to compute the ASD
 * risk level, have no validated paediatric reference ranges here, and must be
 * presented as "tham khảo". Distances are normalised by the child's own leg or
 * torso length so they do not depend on camera distance.
 */
import type { OpenPoseKeypointFrame } from './openposeService'

export type GaitView = 'side' | 'frontal' | 'oblique' | 'unknown'
export type QualityLevel = 'good' | 'fair' | 'poor'
export type FpsSource = 'ml' | 'upload'

export type GaitQuality = {
  level: QualityLevel
  framesTotal: number
  framesWithPerson: number
  personCoverage: number
  lowerBodyCoverage: number
  multiPersonRatio: number
  meanKeypointConfidence: number | null
  fps: number | null
  fpsSource: FpsSource | null
  durationSec: number | null
  warnings: string[]
}

export type GaitMetrics = {
  stepCount: number
  cadenceStepsPerMin: number | null
  stepTimeMeanSec: number | null
  stepTimeCv: number | null
  stepTimeAsymmetry: number | null
  stepLengthLegRatio: number | null
  walkingSpeedLegPerSec: number | null
  trunkLeanDeg: number | null
  trunkSwayDeg: number | null
  armSwingLeft: number | null
  armSwingRight: number | null
  armSwingAsymmetry: number | null
  heelRaiseRatio: number | null
}

export type GaitFeatures = {
  version: 1
  view: GaitView
  quality: GaitQuality
  metrics: GaitMetrics
}

export type GaitInput = {
  frames: OpenPoseKeypointFrame[]
  fps?: number | null
  fpsSource?: FpsSource | null
}

// BODY_25 joint ids.
const NECK = 1
const R_SHOULDER = 2
const R_WRIST = 4
const L_SHOULDER = 5
const L_WRIST = 7
const MID_HIP = 8
const R_HIP = 9
const R_KNEE = 10
const R_ANKLE = 11
const L_HIP = 12
const L_KNEE = 13
const L_ANKLE = 14
const L_BIG_TOE = 19
const L_HEEL = 21
const R_BIG_TOE = 22
const R_HEEL = 24

const MIN_CONFIDENCE = 0.3
const FOOT_MIN_CONFIDENCE = 0.4
const MAX_INTERPOLATED_GAP = 5
const ASSUMED_FPS_FOR_SMOOTHING = 30
const MIN_STEP_SEC = 0.2
const MAX_STEP_SEC = 2.0
const HEEL_RAISE_FOOT_RATIO = 0.35

type Point = { x: number; y: number }
type Pose = Array<Point | null>
type Person = OpenPoseKeypointFrame['people'][number]

// ---------------------------------------------------------------------------
// Small numeric helpers
// ---------------------------------------------------------------------------

function finite(values: Array<number | null | undefined>): number[] {
  return values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null
}

function std(values: number[]): number | null {
  const m = mean(values)
  if (m === null || values.length < 2) return null
  return Math.sqrt(values.reduce((acc, v) => acc + (v - m) ** 2, 0) / (values.length - 1))
}

function percentile(values: number[], p: number): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const idx = (sorted.length - 1) * p
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo)
}

function median(values: number[]): number | null {
  return percentile(values, 0.5)
}

function dist(a: Point | null, b: Point | null): number | null {
  if (!a || !b) return null
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function round(value: number | null, digits = 3): number | null {
  if (value === null || !Number.isFinite(value)) return null
  const f = 10 ** digits
  return Math.round(value * f) / f
}

// ---------------------------------------------------------------------------
// Person selection
// ---------------------------------------------------------------------------

function toPose(person: Person): Pose {
  const pose: Pose = new Array(25).fill(null)
  for (const joint of person.body25 ?? []) {
    if (joint.id < 0 || joint.id > 24) continue
    if (!(joint.confidence >= MIN_CONFIDENCE)) continue
    if (joint.x === 0 && joint.y === 0) continue
    if (!Number.isFinite(joint.x) || !Number.isFinite(joint.y)) continue
    pose[joint.id] = { x: joint.x, y: joint.y }
  }
  return pose
}

function confidentJointCount(person: Person): number {
  return (person.body25 ?? []).filter((j) => j.confidence >= MIN_CONFIDENCE && (j.x !== 0 || j.y !== 0)).length
}

function meanConfidence(person: Person): number {
  const confs = (person.body25 ?? []).map((j) => j.confidence).filter((c) => Number.isFinite(c))
  return confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : 0
}

function poseCenter(pose: Pose): Point | null {
  if (pose[MID_HIP]) return pose[MID_HIP]
  if (pose[NECK]) return pose[NECK]
  const pts = pose.filter((p): p is Point => p !== null)
  if (!pts.length) return null
  return { x: pts.reduce((a, p) => a + p.x, 0) / pts.length, y: pts.reduce((a, p) => a + p.y, 0) / pts.length }
}

type Track = {
  lastCenter: Point
  lastFrame: number
  scale: number
  members: Map<number, { person: Person; pose: Pose }>
}

const MAX_TRACK_GAP_FRAMES = 15

/**
 * Find the walking child among everyone OpenPose detected: link detections
 * frame-to-frame by proximity into tracks, then keep the track that is both
 * long and has moving legs. A still, confident adult at the edge of the frame
 * therefore does not replace the child (the ST-GCN preprocessing on the ML
 * server still uses its own per-frame "most confident person" rule).
 */
function trackMainPerson(
  frames: OpenPoseKeypointFrame[],
): Array<{ pose: Pose; confidence: number; person: Person } | null> {
  const tracks: Track[] = []

  frames.forEach((frame, t) => {
    const candidates = (frame.people ?? [])
      .filter((p) => confidentJointCount(p) >= 6)
      .map((person) => {
        const pose = toPose(person)
        return { person, pose, center: poseCenter(pose), scale: dist(pose[NECK], pose[MID_HIP]) ?? 100 }
      })
      .filter((c): c is typeof c & { center: Point } => c.center !== null)
      .sort((a, b) => meanConfidence(b.person) - meanConfidence(a.person))

    const used = new Set<Track>()
    for (const c of candidates) {
      let best: Track | null = null
      let bestDistance = Number.POSITIVE_INFINITY
      for (const track of tracks) {
        const gap = t - track.lastFrame
        if (used.has(track) || gap > MAX_TRACK_GAP_FRAMES) continue
        const d = Math.hypot(c.center.x - track.lastCenter.x, c.center.y - track.lastCenter.y)
        const maxJump = Math.max(track.scale, c.scale) * (0.5 + 0.1 * gap)
        if (d <= maxJump && d < bestDistance) {
          best = track
          bestDistance = d
        }
      }
      const track: Track = best ?? { lastCenter: c.center, lastFrame: t, scale: c.scale, members: new Map() }
      if (!best) tracks.push(track)
      track.lastCenter = c.center
      track.lastFrame = t
      track.scale = 0.8 * track.scale + 0.2 * c.scale
      track.members.set(t, { person: c.person, pose: c.pose })
      used.add(track)
    }
  })

  const legMotion = (track: Track) => {
    const sx: number[] = []
    const sy: number[] = []
    for (const { pose } of track.members.values()) {
      const l = pose[L_ANKLE]
      const r = pose[R_ANKLE]
      if (!l || !r) continue
      sx.push((l.x - r.x) / track.scale)
      sy.push((l.y - r.y) / track.scale)
    }
    return (std(sx) ?? 0) + (std(sy) ?? 0)
  }
  const chosen = tracks.reduce<Track | null>((best, track) => {
    const score = track.members.size * (1 + legMotion(track))
    const bestScore = best ? best.members.size * (1 + legMotion(best)) : -1
    return score > bestScore ? track : best
  }, null)

  return frames.map((_, t) => {
    const member = chosen?.members.get(t)
    if (!member) return null
    const core = (member.person.body25 ?? []).filter((j) => j.id <= 14).map((j) => j.confidence)
    return {
      pose: member.pose,
      confidence: core.length ? core.reduce((a, b) => a + b, 0) / core.length : 0,
      person: member.person,
    }
  })
}

// ---------------------------------------------------------------------------
// Signal processing
// ---------------------------------------------------------------------------

/** Fill gaps up to `maxGap` samples by linear interpolation; longer gaps stay null. */
function interpolateGaps(series: Array<number | null>, maxGap: number): Array<number | null> {
  const out = [...series]
  let i = 0
  while (i < out.length) {
    if (out[i] !== null) {
      i += 1
      continue
    }
    const start = i
    while (i < out.length && out[i] === null) i += 1
    const end = i // first non-null after the gap (or length)
    const gap = end - start
    if (start > 0 && end < out.length && gap <= maxGap) {
      const a = out[start - 1] as number
      const b = out[end] as number
      for (let k = start; k < end; k += 1) out[k] = a + ((b - a) * (k - start + 1)) / (gap + 1)
    }
  }
  return out
}

/** Split a series into contiguous runs of non-null samples. */
function segments(series: Array<number | null>, minLength: number): Array<{ start: number; values: number[] }> {
  const out: Array<{ start: number; values: number[] }> = []
  let current: { start: number; values: number[] } | null = null
  series.forEach((v, i) => {
    if (v === null) {
      if (current && current.values.length >= minLength) out.push(current)
      current = null
      return
    }
    if (!current) current = { start: i, values: [] }
    current.values.push(v)
  })
  if (current && (current as { values: number[] }).values.length >= minLength) out.push(current)
  return out
}

function movingAverage(values: number[], window: number): number[] {
  if (window <= 1) return [...values]
  const half = Math.floor(window / 2)
  return values.map((_, i) => {
    const lo = Math.max(0, i - half)
    const hi = Math.min(values.length - 1, i + half)
    let sum = 0
    for (let k = lo; k <= hi; k += 1) sum += values[k]
    return sum / (hi - lo + 1)
  })
}

/** Running median used to normalise each frame by a locally stable body scale. */
function runningMedian(series: Array<number | null>, window: number): Array<number | null> {
  const half = Math.floor(window / 2)
  return series.map((_, i) => median(finite(series.slice(Math.max(0, i - half), i + half + 1))))
}

type Pivot = { index: number; type: 'max' | 'min'; value: number }

/**
 * Zig-zag extrema detector: alternating maxima/minima, each separated from the
 * previous pivot by at least `minProminence`. Pivots touching the segment
 * boundaries are dropped because the true extremum may lie outside the clip.
 */
function zigzagPivots(values: number[], minProminence: number): Pivot[] {
  const pivots: Pivot[] = []
  if (values.length < 3) return pivots
  let mode: 'unknown' | 'up' | 'down' = 'unknown'
  let lo = 0
  let hi = 0
  let ext = 0
  for (let i = 1; i < values.length; i += 1) {
    const v = values[i]
    if (mode === 'unknown') {
      if (v > values[hi]) hi = i
      if (v < values[lo]) lo = i
      if (values[hi] - values[lo] >= minProminence) {
        if (hi > lo) {
          pivots.push({ index: lo, type: 'min', value: values[lo] })
          mode = 'up'
          ext = hi
        } else {
          pivots.push({ index: hi, type: 'max', value: values[hi] })
          mode = 'down'
          ext = lo
        }
      }
    } else if (mode === 'up') {
      if (v > values[ext]) ext = i
      else if (values[ext] - v >= minProminence) {
        pivots.push({ index: ext, type: 'max', value: values[ext] })
        mode = 'down'
        ext = i
      }
    } else {
      if (v < values[ext]) ext = i
      else if (v - values[ext] >= minProminence) {
        pivots.push({ index: ext, type: 'min', value: values[ext] })
        mode = 'up'
        ext = i
      }
    }
  }
  return pivots.filter((p) => p.index > 0 && p.index < values.length - 1)
}

type StepAnalysis = {
  /** `frame` is fractional: pivots are refined to sub-frame precision. */
  pivots: Array<Pivot & { frame: number; segment: number }>
  amplitude: number
}

/**
 * Smoothing shifts a peak towards its flatter side, which biases step timing
 * (and hides asymmetry). Re-locate the extremum on the unsmoothed series near
 * the smoothed pivot and refine it with a 3-point parabola.
 */
function refinePivot(raw: number[], pivot: Pivot, radius: number): { index: number; value: number } {
  const sign = pivot.type === 'max' ? 1 : -1
  let k = pivot.index
  for (let i = Math.max(1, pivot.index - radius); i <= Math.min(raw.length - 2, pivot.index + radius); i += 1) {
    if (sign * raw[i] > sign * raw[k]) k = i
  }
  if (k <= 0 || k >= raw.length - 1) return { index: k, value: raw[k] }
  const a = raw[k - 1]
  const b = raw[k]
  const c = raw[k + 1]
  const denom = a - 2 * b + c
  const offset = denom === 0 ? 0 : Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / denom))
  return { index: k + offset, value: b - 0.25 * (a - c) * offset }
}

function analyseSteps(series: Array<number | null>, smoothingWindow: number): StepAnalysis {
  const filled = interpolateGaps(series, MAX_INTERPOLATED_GAP)
  const segs = segments(filled, 8)
  const all = segs.flatMap((s) => s.values)
  const amplitude = (percentile(all, 0.95) ?? 0) - (percentile(all, 0.05) ?? 0)
  const pivots: StepAnalysis['pivots'] = []
  if (amplitude < 0.1) return { pivots, amplitude }

  const radius = Math.floor(smoothingWindow / 2) + 1
  segs.forEach((seg, segIndex) => {
    const smooth = movingAverage(seg.values, smoothingWindow)
    for (const p of zigzagPivots(smooth, 0.3 * amplitude)) {
      const refined = refinePivot(seg.values, p, radius)
      pivots.push({ ...p, value: refined.value, frame: seg.start + refined.index, segment: segIndex })
    }
  })
  return { pivots, amplitude }
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

export function sanitizeFps(fps: number | null | undefined): number | null {
  if (typeof fps !== 'number' || !Number.isFinite(fps)) return null
  return fps >= 5 && fps <= 120 ? fps : null
}

export function computeGaitFeatures(input: GaitInput): GaitFeatures {
  const frames = [...(input.frames ?? [])].sort((a, b) => a.frame_index - b.frame_index)
  const fps = sanitizeFps(input.fps)
  const fpsSource = fps === null ? null : input.fpsSource ?? null
  const framesTotal = frames.length

  const tracked = trackMainPerson(frames)
  const poses = tracked.map((t) => t?.pose ?? null)
  const framesWithPerson = poses.filter(Boolean).length
  const multiPersonFrames = frames.filter(
    (f) => (f.people ?? []).filter((p) => confidentJointCount(p) >= 10).length >= 2,
  ).length
  const lowerBodyFrames = poses.filter(
    (p) => p && [R_HIP, R_KNEE, R_ANKLE, L_HIP, L_KNEE, L_ANKLE].every((j) => p[j] !== null),
  ).length

  const at = (j: number) => poses.map((p) => (p ? p[j] : null))
  const neck = at(NECK)
  const midHip = at(MID_HIP)

  // Body scales (pixels), smoothed over time so a child walking towards the
  // camera (growing in the image) is still normalised correctly.
  const torsoRaw = poses.map((_, t) => dist(neck[t], midHip[t]))
  const legRaw = poses.map((p) => {
    if (!p) return null
    const right = finite([dist(p[R_HIP], p[R_KNEE]), dist(p[R_KNEE], p[R_ANKLE])])
    const left = finite([dist(p[L_HIP], p[L_KNEE]), dist(p[L_KNEE], p[L_ANKLE])])
    const lengths = finite([right.length === 2 ? right[0] + right[1] : null, left.length === 2 ? left[0] + left[1] : null])
    return mean(lengths)
  })
  const scaleWindow = Math.max(5, Math.round((fps ?? ASSUMED_FPS_FOR_SMOOTHING) / 2))
  const torso = runningMedian(torsoRaw, scaleWindow)
  const leg = runningMedian(legRaw, scaleWindow)
  const torsoMedian = median(finite(torsoRaw))
  const legMedian = median(finite(legRaw))

  // --- Camera view -------------------------------------------------------
  const shoulderRatios = finite(
    poses.map((p, t) => {
      const tl = torso[t]
      if (!p || !p[R_SHOULDER] || !p[L_SHOULDER] || !tl) return null
      return Math.abs((p[R_SHOULDER] as Point).x - (p[L_SHOULDER] as Point).x) / tl
    }),
  )
  const hipRatios = finite(
    poses.map((p, t) => {
      const tl = torso[t]
      if (!p || !p[R_HIP] || !p[L_HIP] || !tl) return null
      return Math.abs((p[R_HIP] as Point).x - (p[L_HIP] as Point).x) / tl
    }),
  )
  let view: GaitView = 'unknown'
  if (shoulderRatios.length >= 10) {
    const r = median(shoulderRatios) as number
    view = r < 0.35 ? 'side' : r > 0.65 ? 'frontal' : 'oblique'
  } else if (hipRatios.length >= 10) {
    const r = median(hipRatios) as number
    view = r < 0.2 ? 'side' : r > 0.4 ? 'frontal' : 'oblique'
  }

  // Walking direction along the image x axis (+1 = moving right).
  const hipX = midHip.map((p) => (p ? p.x : null))
  const hipIdx = hipX.map((x, i) => (x === null ? -1 : i)).filter((i) => i >= 0)
  let direction = 1
  if (hipIdx.length >= 2) {
    const head = finite(hipIdx.slice(0, Math.max(1, Math.floor(hipIdx.length / 5))).map((i) => hipX[i]))
    const tail = finite(hipIdx.slice(-Math.max(1, Math.floor(hipIdx.length / 5))).map((i) => hipX[i]))
    const delta = (mean(tail) ?? 0) - (mean(head) ?? 0)
    direction = delta < 0 ? -1 : 1
  }

  // --- Steps ------------------------------------------------------------
  const lAnkle = at(L_ANKLE)
  const rAnkle = at(R_ANKLE)
  const sepX = poses.map((_, t) => {
    const l = lAnkle[t]
    const r = rAnkle[t]
    const s = leg[t]
    return l && r && s ? ((l.x - r.x) * direction) / s : null
  })
  const sepY = poses.map((_, t) => {
    const l = lAnkle[t]
    const r = rAnkle[t]
    const s = leg[t]
    return l && r && s ? (l.y - r.y) / s : null
  })

  const smoothingWindow = Math.max(3, Math.round((fps ?? ASSUMED_FPS_FOR_SMOOTHING) / 10) | 1)
  const stepsX = analyseSteps(sepX, smoothingWindow)
  const stepsY = analyseSteps(sepY, smoothingWindow)
  let steps: StepAnalysis
  if (view === 'side') steps = stepsX
  else if (view === 'frontal') steps = stepsY
  else steps = stepsX.amplitude >= stepsY.amplitude ? stepsX : stepsY
  const usingSideSignal = steps === stepsX

  const intervals: Array<{ frames: number; endsWith: 'max' | 'min' }> = []
  for (let k = 1; k < steps.pivots.length; k += 1) {
    const a = steps.pivots[k - 1]
    const b = steps.pivots[k]
    if (a.segment !== b.segment) continue
    intervals.push({ frames: b.frame - a.frame, endsWith: b.type })
  }

  let stepTimes: Array<{ sec: number; endsWith: 'max' | 'min' }> = []
  if (fps !== null) {
    stepTimes = intervals
      .map((iv) => ({ sec: iv.frames / fps, endsWith: iv.endsWith }))
      .filter((s) => s.sec >= MIN_STEP_SEC && s.sec <= MAX_STEP_SEC)
  }
  const times = stepTimes.map((s) => s.sec)
  const stepTimeMeanSec = times.length >= 2 ? mean(times) : null
  const cadenceStepsPerMin = stepTimeMeanSec ? 60 / stepTimeMeanSec : null
  const stepTimeCv = times.length >= 4 && stepTimeMeanSec ? (std(times) as number) / stepTimeMeanSec : null
  // A pivot of type "max" means the left ankle is ahead → interval ending there is a left step.
  const leftTimes = stepTimes.filter((s) => s.endsWith === 'max').map((s) => s.sec)
  const rightTimes = stepTimes.filter((s) => s.endsWith === 'min').map((s) => s.sec)
  const stepTimeAsymmetry =
    leftTimes.length >= 2 && rightTimes.length >= 2 && stepTimeMeanSec
      ? Math.abs((mean(leftTimes) as number) - (mean(rightTimes) as number)) / stepTimeMeanSec
      : null

  const sideLike = view === 'side' || (view === 'oblique' && usingSideSignal)
  const stepLengthLegRatio =
    view === 'side' && steps.pivots.length >= 2 ? mean(steps.pivots.map((p) => Math.abs(p.value))) : null

  // Walking speed: least-squares slope of hip x over time, in leg lengths/second.
  let walkingSpeedLegPerSec: number | null = null
  if (view === 'side' && fps !== null && legMedian && hipIdx.length >= 10) {
    const xs = hipIdx.map((i) => i / fps)
    const ys = hipIdx.map((i) => hipX[i] as number)
    const mx = mean(xs) as number
    const my = mean(ys) as number
    let num = 0
    let den = 0
    xs.forEach((x, k) => {
      num += (x - mx) * (ys[k] - my)
      den += (x - mx) ** 2
    })
    if (den > 0) walkingSpeedLegPerSec = Math.abs(num / den) / legMedian
  }

  // --- Trunk ------------------------------------------------------------
  const leanAngles = finite(
    poses.map((_, t) => {
      const n = neck[t]
      const h = midHip[t]
      if (!n || !h || h.y - n.y <= 0) return null
      return (Math.atan2(n.x - h.x, h.y - n.y) * 180) / Math.PI
    }),
  )
  const trunkLeanDeg = view === 'side' && leanAngles.length >= 10 ? (mean(leanAngles) as number) * direction : null
  const trunkSwayDeg = leanAngles.length >= 10 ? std(leanAngles) : null

  // --- Arm swing (needs the arm motion to be in the image plane) ---------
  const armSwing = (wrist: number, shoulder: number) => {
    if (!sideLike) return null
    const series = finite(
      poses.map((p, t) => {
        const tl = torso[t]
        if (!p || !p[wrist] || !p[shoulder] || !tl) return null
        return (((p[wrist] as Point).x - (p[shoulder] as Point).x) * direction) / tl
      }),
    )
    if (series.length < Math.max(15, framesWithPerson * 0.4)) return null
    return (percentile(series, 0.95) as number) - (percentile(series, 0.05) as number)
  }
  const armSwingLeft = armSwing(L_WRIST, L_SHOULDER)
  const armSwingRight = armSwing(R_WRIST, R_SHOULDER)
  const armSwingAsymmetry =
    armSwingLeft !== null && armSwingRight !== null && armSwingLeft + armSwingRight > 0
      ? Math.abs(armSwingLeft - armSwingRight) / ((armSwingLeft + armSwingRight) / 2)
      : null

  // --- Heel raise during stance (experimental, side view only) -----------
  let heelRaiseRatio: number | null = null
  if (view === 'side') {
    let stance = 0
    let raised = 0
    tracked.forEach((track, t) => {
      const s = leg[t]
      if (!track || !s) return
      const pose = track.pose
      const conf = (id: number) => track.person.body25.find((j) => j.id === id)?.confidence ?? 0
      for (const [ankle, otherAnkle, heel, toe] of [
        [L_ANKLE, R_ANKLE, L_HEEL, L_BIG_TOE],
        [R_ANKLE, L_ANKLE, R_HEEL, R_BIG_TOE],
      ] as const) {
        const a = pose[ankle]
        const o = pose[otherAnkle]
        const h = pose[heel]
        const toePt = pose[toe]
        if (!a || !o || !h || !toePt) continue
        if (conf(heel) < FOOT_MIN_CONFIDENCE || conf(toe) < FOOT_MIN_CONFIDENCE) continue
        if (a.y < o.y - 0.02 * s) continue // this foot is the raised (swing) one
        const footLength = dist(h, toePt)
        if (!footLength) continue
        stance += 1
        if ((toePt.y - h.y) / footLength > HEEL_RAISE_FOOT_RATIO) raised += 1
      }
    })
    heelRaiseRatio = stance >= 20 ? raised / stance : null
  }

  // --- Quality ------------------------------------------------------------
  const personCoverage = framesTotal ? framesWithPerson / framesTotal : 0
  const lowerBodyCoverage = framesTotal ? lowerBodyFrames / framesTotal : 0
  const multiPersonRatio = framesTotal ? multiPersonFrames / framesTotal : 0
  const durationSec = fps !== null && framesTotal ? framesTotal / fps : null
  const stepCount = steps.pivots.length

  const warnings: string[] = []
  if (durationSec !== null && durationSec < 4) {
    warnings.push('Video quá ngắn (dưới 4 giây). Nên quay 6–10 giây trẻ đi thẳng.')
  }
  if (personCoverage < 0.85) {
    warnings.push('Nhiều khung hình không nhận ra trẻ. Hãy quay ở nơi đủ sáng, giữ trẻ trong khung hình.')
  }
  if (lowerBodyCoverage < 0.75) {
    warnings.push('Không thấy rõ hông, gối và cổ chân trong nhiều khung hình. Đặt máy quay đủ xa để thấy cả bàn chân.')
  }
  if (multiPersonRatio > 0.2) {
    warnings.push('Có nhiều người trong khung hình. Kết quả có thể bị ảnh hưởng; nên quay khi chỉ có trẻ trong khung.')
  }
  if (stepCount < 4) {
    warnings.push('Phát hiện ít hơn 4 bước chân, chưa đủ để tính các chỉ số dáng đi.')
  }
  if (fps === null) {
    warnings.push('Không xác định được tốc độ khung hình nên không tính các chỉ số theo thời gian (nhịp bước, tốc độ).')
  }
  if (view === 'frontal') {
    warnings.push('Video quay chính diện: độ dài bước, tốc độ đi và biên độ vung tay chỉ tính được khi quay ngang.')
  }

  let level: QualityLevel = 'good'
  if (
    framesTotal < 30 ||
    personCoverage < 0.6 ||
    lowerBodyCoverage < 0.5 ||
    stepCount < 2 ||
    (durationSec !== null && durationSec < 2)
  ) {
    level = 'poor'
  } else if (
    personCoverage < 0.85 ||
    lowerBodyCoverage < 0.75 ||
    multiPersonRatio > 0.2 ||
    stepCount < 4 ||
    (durationSec !== null && durationSec < 4)
  ) {
    level = 'fair'
  }

  const confidences = finite(tracked.map((t) => t?.confidence ?? null))

  return {
    version: 1,
    view,
    quality: {
      level,
      framesTotal,
      framesWithPerson,
      personCoverage: round(personCoverage) as number,
      lowerBodyCoverage: round(lowerBodyCoverage) as number,
      multiPersonRatio: round(multiPersonRatio) as number,
      meanKeypointConfidence: round(mean(confidences)),
      fps: round(fps, 2),
      fpsSource,
      durationSec: round(durationSec, 2),
      warnings,
    },
    metrics: {
      stepCount,
      cadenceStepsPerMin: round(cadenceStepsPerMin, 1),
      stepTimeMeanSec: round(stepTimeMeanSec),
      stepTimeCv: round(stepTimeCv),
      stepTimeAsymmetry: round(stepTimeAsymmetry),
      stepLengthLegRatio: round(stepLengthLegRatio),
      walkingSpeedLegPerSec: round(walkingSpeedLegPerSec),
      trunkLeanDeg: round(trunkLeanDeg, 1),
      trunkSwayDeg: round(trunkSwayDeg, 1),
      armSwingLeft: round(armSwingLeft),
      armSwingRight: round(armSwingRight),
      armSwingAsymmetry: round(armSwingAsymmetry),
      heelRaiseRatio: round(heelRaiseRatio),
    },
  }
}

/**
 * Pick the most trustworthy frame rate: the ML server's OpenCV probe, else the
 * browser-measured duration of the upload (frames / seconds).
 */
export function resolveFps(params: {
  mlFps?: number | null
  numFrames?: number | null
  uploadDurationMs?: number | null
}): { fps: number | null; source: FpsSource | null } {
  const ml = sanitizeFps(params.mlFps ?? null)
  if (ml !== null) return { fps: ml, source: 'ml' }
  if (params.numFrames && params.uploadDurationMs && params.uploadDurationMs > 0) {
    const estimated = sanitizeFps(params.numFrames / (params.uploadDurationMs / 1000))
    if (estimated !== null) return { fps: estimated, source: 'upload' }
  }
  return { fps: null, source: null }
}
