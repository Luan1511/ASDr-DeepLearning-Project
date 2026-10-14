/**
 * imitation-v1 step C: body-relative feature series at 15 Hz.
 * Angles are in degrees, positive AWAY from the midline on each side, so the
 * same number means the same movement for the left and the right limb.
 */
import type { Point } from '../poseTracking'
import {
  L_ANKLE,
  L_ELBOW,
  L_HIP,
  L_KNEE,
  L_SHOULDER,
  L_WRIST,
  LIMB_ENDS,
  MID_HIP,
  NECK,
  R_ANKLE,
  R_ELBOW,
  R_HIP,
  R_KNEE,
  R_SHOULDER,
  R_WRIST,
  type Joints,
} from './cleaning'
import { IMITATION_V1 as C } from './constants'
import { PARTS, PART_IDS, type FeatureId, type FeatureSet, type PartId, type Series } from './types'

export const FEATURE_IDS: FeatureId[] = [
  'lUpper',
  'lFore',
  'rUpper',
  'rFore',
  'lThigh',
  'lShank',
  'lThighLen',
  'rThigh',
  'rShank',
  'rThighLen',
  'lean',
  'rootDy',
  'rootDx',
]

export { PART_IDS }

export const FEATURE_PART = Object.fromEntries(
  (Object.entries(PARTS) as Array<[PartId, FeatureId[]]>).flatMap(([part, ids]) => ids.map((id) => [id, part])),
) as Record<FeatureId, PartId>

export type FeatureKind = 'angle' | 'length' | 'translation'
export const FEATURE_KIND: Record<FeatureId, FeatureKind> = {
  lUpper: 'angle',
  lFore: 'angle',
  rUpper: 'angle',
  rFore: 'angle',
  lThigh: 'angle',
  lShank: 'angle',
  lThighLen: 'length',
  rThigh: 'angle',
  rShank: 'angle',
  rThighLen: 'length',
  lean: 'angle',
  rootDy: 'translation',
  rootDx: 'translation',
}

export function baseWeight(f: FeatureId): number {
  return C.baseWeight[FEATURE_KIND[f]]
}

const MIRROR_FEATURE: Record<FeatureId, FeatureId> = {
  lUpper: 'rUpper',
  rUpper: 'lUpper',
  lFore: 'rFore',
  rFore: 'lFore',
  lThigh: 'rThigh',
  rThigh: 'lThigh',
  lShank: 'rShank',
  rShank: 'lShank',
  lThighLen: 'rThighLen',
  rThighLen: 'lThighLen',
  lean: 'lean',
  rootDy: 'rootDy',
  rootDx: 'rootDx',
}
const MIRROR_PART: Record<PartId, PartId> = {
  leftArm: 'rightArm',
  rightArm: 'leftArm',
  leftLeg: 'rightLeg',
  rightLeg: 'leftLeg',
  trunk: 'trunk',
}
/** Features whose sign flips under a left-right reflection. */
const NEGATED_UNDER_MIRROR = new Set<FeatureId>(['lean', 'rootDx'])

export const mirrorFeatureId = (f: FeatureId): FeatureId => MIRROR_FEATURE[f]
export const mirrorPartId = (p: PartId): PartId => MIRROR_PART[p]
export const mirrorValue = (f: FeatureId, v: number | null): number | null =>
  v === null ? null : NEGATED_UNDER_MIRROR.has(f) ? (v === 0 ? 0 : -v) : v

/** Mirror operator M: swap left/right limb features (with their availability), negate lean and rootDx. */
export function mirrorFeatureSet(set: FeatureSet): FeatureSet {
  const values = {} as Record<FeatureId, Series>
  const avail = {} as Record<FeatureId, number[]>
  for (const f of FEATURE_IDS) {
    const src = MIRROR_FEATURE[f]
    values[f] = set.values[src].map((v) => mirrorValue(f, v))
    avail[f] = set.avail[src].slice()
  }
  return { values, avail }
}

// ---------------------------------------------------------------------------
// Angle and statistics helpers
// ---------------------------------------------------------------------------

/** Maps any angle (degrees) into (−180, 180]. */
export function wrap(a: number): number {
  return a - 360 * Math.ceil((a - 180) / 360)
}

/** min(|wrap(a − b)|, cap) without allocating. */
export function cappedDiff(a: number, b: number, cap: number = C.featureCap): number {
  let d = Math.abs(a - b)
  if (d > 180) {
    d %= 360
    if (d > 180) d = 360 - d
  }
  return d < cap ? d : cap
}

/** Signed angle from a to b in degrees, in (−180, 180], counter-clockwise positive (y-up). */
export function signedAngle(ax: number, ay: number, bx: number, by: number): number {
  return wrap((Math.atan2(ax * by - ay * bx, ax * bx + ay * by) * 180) / Math.PI)
}

/** Removes ±360° jumps; continuity is carried across null samples. */
export function unwrap(series: Series): Series {
  let prevRaw: number | null = null
  let prev = 0
  return series.map((v) => {
    if (v === null) return null
    prev = prevRaw === null ? v : prev + wrap(v - prevRaw)
    prevRaw = v
    return prev
  })
}

export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const idx = (sorted.length - 1) * p
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo)
}

export const median = (values: number[]) => percentile(values, 0.5)

export function finiteValues(series: Series): number[] {
  return series.filter((v): v is number => v !== null && Number.isFinite(v))
}

/** Range of motion: p95 − p5 of the unwrapped series (0 with fewer than two samples). */
export function rangeOfMotion(series: Series): number {
  const values = finiteValues(unwrap(series))
  if (values.length < 2) return 0
  return (percentile(values, 0.95) as number) - (percentile(values, 0.05) as number)
}

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

export function windowSamples(sec: number): number {
  return Math.max(1, Math.round(sec * C.hz))
}

// ---------------------------------------------------------------------------
// Feature extraction
// ---------------------------------------------------------------------------

export interface FeatureExtraction {
  set: FeatureSet
  /** Running-median torso length L(t) in pixels. */
  torso: Array<number | null>
  torsoMedian: number | null
  /** Camera roll estimated in the reference window (0 when uncertain). */
  roll: number
  rollUncertain: boolean
  /** Reference window [start, end) in samples. */
  refWindow: [number, number]
  /** Median mid-hip over the reference window, image coordinates. */
  rootRef: Point | null
  /** |P5 − P2| / L per sample (null when a shoulder is missing). */
  shoulderRatio: Array<number | null>
  /** Mean speed of wrists and ankles relative to the mid-hip, in L per second. */
  limbSpeed: Array<number | null>
}

type V = { x: number; y: number }
const sub = (a: V, b: V): V => ({ x: a.x - b.x, y: a.y - b.y })
const norm = (a: V) => Math.hypot(a.x, a.y)

function emptySet(n: number): FeatureSet {
  const values = {} as Record<FeatureId, Series>
  const avail = {} as Record<FeatureId, number[]>
  for (const f of FEATURE_IDS) {
    values[f] = new Array(n).fill(null)
    avail[f] = new Array(n).fill(0)
  }
  return { values, avail }
}

/** Limb speed is measured over 0.2 s (3 samples at 15 Hz). */
export const SPEED_LAG = Math.max(1, Math.round(0.2 * C.hz))

/** Mean limb speed over the displacements that lie inside [start, end). */
export function meanSpeed(speed: Array<number | null>, start: number, end: number): number | null {
  let sum = 0
  let n = 0
  for (let i = start + SPEED_LAG; i < end; i += 1) {
    const v = speed[i]
    if (v === null || v === undefined) continue
    sum += v
    n += 1
  }
  return n ? sum / n : null
}

function quietWindow(speed: Array<number | null>, count: number): [number, number] {
  const len = windowSamples(C.quietWindowSec)
  const lastStart = Math.floor(0.5 * count) - len
  if (lastStart <= 0) return [0, Math.min(len, count)]
  let best = 0
  let bestSpeed = Number.POSITIVE_INFINITY
  for (let s = 0; s <= lastStart; s += 1) {
    const m = meanSpeed(speed, s, s + len)
    if (m !== null && m < bestSpeed) {
      bestSpeed = m
      best = s
    }
  }
  return [best, best + len]
}

/**
 * Features of a cleaned 15 Hz clip. `role` picks the reference window: the
 * template's first 0.5 s, or the child's quietest second in the first half.
 */
export function extractFeatures(poses: Array<Joints | null>, role: 'template' | 'child'): FeatureExtraction {
  const n = poses.length
  // y-up coordinates
  const P = poses.map((joints) => (joints ? joints.map((p) => (p ? { x: p.x, y: -p.y } : null)) : null))
  const at = (i: number, j: number) => P[i]?.[j] ?? null

  // Torso length L(t): running median over 2 s, falling back to the clip median.
  const torsoRaw = P.map((_, i) => {
    const neck = at(i, NECK)
    const hip = at(i, MID_HIP)
    return neck && hip ? norm(sub(neck, hip)) || null : null
  })
  const torsoMedian = median(torsoRaw.filter((v): v is number => v !== null))
  const half = Math.floor(windowSamples(C.torsoMedianWindowSec) / 2)
  const torso = torsoRaw.map((_, i) => {
    const local = torsoRaw.slice(Math.max(0, i - half), i + half).filter((v): v is number => v !== null)
    return median(local) ?? torsoMedian
  })

  // Body up vector, falling back to the clip median direction.
  const upRaw = P.map((_, i) => {
    const neck = at(i, NECK)
    const hip = at(i, MID_HIP)
    if (!neck || !hip) return null
    const d = sub(neck, hip)
    const l = norm(d)
    return l > 0 ? { x: d.x / l, y: d.y / l } : null
  })
  const measuredUp = upRaw.filter((u): u is V => u !== null)
  let fallbackUp: V = { x: 0, y: 1 }
  if (measuredUp.length) {
    const mx = median(measuredUp.map((u) => u.x)) as number
    const my = median(measuredUp.map((u) => u.y)) as number
    const l = Math.hypot(mx, my)
    if (l > 0) fallbackUp = { x: mx / l, y: my / l }
  }
  const up = upRaw.map((u) => u ?? fallbackUp)

  // Limb speed relative to the mid-hip, in torso lengths per second, measured
  // over SPEED_LAG samples so keypoint jitter does not dominate it.
  const limbSpeed: Array<number | null> = P.map((_, i) => {
    if (i < SPEED_LAG) return null
    const hip = at(i, MID_HIP)
    const prevHip = at(i - SPEED_LAG, MID_HIP)
    const L = torso[i]
    if (!hip || !prevHip || !L) return null
    let sum = 0
    let count = 0
    for (const j of LIMB_ENDS) {
      const a = at(i, j)
      const b = at(i - SPEED_LAG, j)
      if (!a || !b) continue
      sum += norm(sub(sub(a, hip), sub(b, prevHip)))
      count += 1
    }
    return count ? ((sum / count) * C.hz) / (SPEED_LAG * L) : null
  })

  const refWindow: [number, number] =
    role === 'template' ? [0, Math.min(n, windowSamples(C.trim.neutralSec))] : quietWindow(limbSpeed, n)

  // Camera roll from the torso direction while standing still.
  const rollSamples: number[] = []
  for (let i = refWindow[0]; i < refWindow[1]; i += 1) {
    const u = upRaw[i]
    if (u) rollSamples.push(signedAngle(0, 1, u.x, u.y))
  }
  let roll = median(rollSamples) ?? 0
  let rollUncertain = false
  if (role === 'child' && Math.abs(roll) > C.rollMaxDeg) {
    roll = 0
    rollUncertain = true
  }
  const rr = (roll * Math.PI) / 180
  const vdown: V = { x: Math.sin(rr), y: -Math.cos(rr) } // (0,−1) rotated by roll
  const vup: V = { x: -vdown.x, y: -vdown.y }

  const hipsInRef: V[] = []
  for (let i = refWindow[0]; i < refWindow[1]; i += 1) {
    const h = at(i, MID_HIP)
    if (h) hipsInRef.push(h)
  }
  const allHips = P.map((_, i) => at(i, MID_HIP)).filter((h): h is V => h !== null)
  const refHips = hipsInRef.length ? hipsInRef : allHips
  const rootRef: V | null = refHips.length
    ? { x: median(refHips.map((h) => h.x)) as number, y: median(refHips.map((h) => h.y)) as number }
    : null

  const shoulderRatio = P.map((_, i) => {
    const l = at(i, L_SHOULDER)
    const r = at(i, R_SHOULDER)
    const L = torso[i]
    return l && r && L ? norm(sub(l, r)) / L : null
  })

  const set = emptySet(n)
  if (torsoMedian === null) {
    return {
      set,
      torso,
      torsoMedian,
      roll,
      rollUncertain,
      refWindow,
      rootRef: rootRef ? { x: rootRef.x, y: -rootRef.y } : null,
      shoulderRatio,
      limbSpeed,
    }
  }

  // Segment lengths and their p90 over the clip (foreshortening reference).
  const segments: Array<{ from: number; to: number }> = [
    { from: L_SHOULDER, to: L_ELBOW },
    { from: L_ELBOW, to: L_WRIST },
    { from: R_SHOULDER, to: R_ELBOW },
    { from: R_ELBOW, to: R_WRIST },
    { from: L_HIP, to: L_KNEE },
    { from: L_KNEE, to: L_ANKLE },
    { from: R_HIP, to: R_KNEE },
    { from: R_KNEE, to: R_ANKLE },
  ]
  const p90 = new Map<string, number | null>()
  for (const s of segments) {
    const lengths: number[] = []
    for (let i = 0; i < n; i += 1) {
      const a = at(i, s.from)
      const b = at(i, s.to)
      if (a && b) lengths.push(norm(sub(b, a)))
    }
    p90.set(`${s.from}-${s.to}`, percentile(lengths, 0.9))
  }

  const angleFeature = (
    f: FeatureId,
    i: number,
    from: number,
    to: number,
    ref: V,
    sign: 1 | -1,
  ) => {
    const a = at(i, from)
    const b = at(i, to)
    const ref90 = p90.get(`${from}-${to}`)
    if (!a || !b || !ref90) return
    const v = sub(b, a)
    const availability = clamp01((norm(v) / ref90 - C.foreshorten.lo) / C.foreshorten.span)
    if (availability <= 0) return
    const angle = signedAngle(ref.x, ref.y, v.x, v.y)
    set.values[f][i] = sign === 1 ? angle : wrap(-angle)
    set.avail[f][i] = availability
  }
  const lengthFeature = (f: FeatureId, i: number, from: number, to: number) => {
    const a = at(i, from)
    const b = at(i, to)
    const ref90 = p90.get(`${from}-${to}`)
    if (!a || !b || !ref90) return
    set.values[f][i] = (100 * norm(sub(b, a))) / ref90
    set.avail[f][i] = 1
  }

  for (let i = 0; i < n; i += 1) {
    if (!P[i]) continue
    const down: V = { x: -up[i].x, y: -up[i].y }
    angleFeature('lUpper', i, L_SHOULDER, L_ELBOW, down, 1)
    angleFeature('lFore', i, L_ELBOW, L_WRIST, down, 1)
    angleFeature('rUpper', i, R_SHOULDER, R_ELBOW, down, -1)
    angleFeature('rFore', i, R_ELBOW, R_WRIST, down, -1)
    angleFeature('lThigh', i, L_HIP, L_KNEE, vdown, 1)
    angleFeature('lShank', i, L_KNEE, L_ANKLE, vdown, 1)
    angleFeature('rThigh', i, R_HIP, R_KNEE, vdown, -1)
    angleFeature('rShank', i, R_KNEE, R_ANKLE, vdown, -1)
    lengthFeature('lThighLen', i, L_HIP, L_KNEE)
    lengthFeature('rThighLen', i, R_HIP, R_KNEE)

    const u = upRaw[i]
    if (u) {
      set.values.lean[i] = wrap(-signedAngle(vup.x, vup.y, u.x, u.y))
      set.avail.lean[i] = 1
    }
    const hip = at(i, MID_HIP)
    const L = torso[i]
    if (hip && rootRef && L) {
      set.values.rootDy[i] = (100 * (hip.y - rootRef.y)) / L
      set.values.rootDx[i] = (100 * (hip.x - rootRef.x)) / L
      set.avail.rootDy[i] = 1
      set.avail.rootDx[i] = 1
    }
  }

  return {
    set,
    torso,
    torsoMedian,
    roll,
    rollUncertain,
    refWindow,
    rootRef: rootRef ? { x: rootRef.x, y: -rootRef.y } : null,
    shoulderRatio,
    limbSpeed,
  }
}

/**
 * A part is visible at a sample when its available feature weight reaches
 * half of its total weight.
 */
export function partVisibleAt(set: FeatureSet, part: PartId, weights: Record<FeatureId, number>, i: number): boolean {
  let total = 0
  let present = 0
  for (const f of PARTS[part]) {
    const w = weights[f]
    total += w
    present += (set.avail[f][i] ?? 0) * w
  }
  return total > 0 && present >= C.partVisibleWeightShare * total
}
