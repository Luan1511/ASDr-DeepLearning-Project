/**
 * Deterministic BODY_25 stick figure driven by joint-angle functions. Used by
 * the built-in demonstrations (no recording needed) and by the tests.
 *
 * Model: orthographic camera, x = the person's left (image +x when facing the
 * camera), y = up, z = towards the camera. Arm angles are relative to the
 * trunk, leg angles relative to the world; the lower foot stays on the floor.
 */
import type { OpenPoseKeypointFrame } from '../openposeService'

/** Lengths in torso units (neck to mid-hip). */
export interface BodyProportions {
  shoulderHalf: number
  hipHalf: number
  upperArm: number
  forearm: number
  thigh: number
  shank: number
  neckToNose: number
  foot: number
}

export const ADULT_BODY: BodyProportions = {
  shoulderHalf: 0.4,
  hipHalf: 0.2,
  upperArm: 0.6,
  forearm: 0.54,
  thigh: 0.9,
  shank: 0.86,
  neckToNose: 0.45,
  foot: 0.45,
}

/** About 5 years old: relatively larger head, shorter limbs. */
export const CHILD_BODY: BodyProportions = {
  shoulderHalf: 0.39,
  hipHalf: 0.21,
  upperArm: 0.55,
  forearm: 0.45,
  thigh: 0.78,
  shank: 0.72,
  neckToNose: 0.55,
  foot: 0.42,
}

/**
 * One pose. Segment angles are in degrees in the frontal plane, 0 = pointing
 * down, positive = away from the midline (180 = straight up). `*Fwd` is the
 * share of the segment's length lost because it points towards the camera
 * (0 = in the frontal plane, 0.5 = 60° forward). `lean` is the trunk tilt in
 * degrees towards the person's left; `shiftX` moves the hips sideways (torso
 * units, + = person's left).
 */
export interface SyntheticPoseAngles {
  lUpper: number
  lFore: number
  rUpper: number
  rFore: number
  lThigh: number
  lShank: number
  rThigh: number
  rShank: number
  lUpperFwd: number
  lForeFwd: number
  rUpperFwd: number
  rForeFwd: number
  lThighFwd: number
  lShankFwd: number
  rThighFwd: number
  rShankFwd: number
  lean: number
  shiftX: number
}

export const NEUTRAL_POSE: Readonly<SyntheticPoseAngles> = Object.freeze({
  lUpper: 8,
  lFore: 6,
  rUpper: 8,
  rFore: 6,
  lThigh: 3,
  lShank: 0,
  rThigh: 3,
  rShank: 0,
  lUpperFwd: 0,
  lForeFwd: 0,
  rUpperFwd: 0,
  rForeFwd: 0,
  lThighFwd: 0,
  lShankFwd: 0,
  rThighFwd: 0,
  rShankFwd: 0,
  lean: 0,
  shiftX: 0,
})

export interface SyntheticExerciseSpec {
  /** Length of the movement clip in seconds (neutral lead-in and tail included). */
  durationSec: number
  /** Pose at time t (seconds since the clip start); only the changed angles are needed. */
  pose(t: number): Partial<SyntheticPoseAngles>
}

export interface SyntheticOptions {
  fps?: number
  /** Output length; defaults to the spec duration (mapped through `timeMap`). */
  durationSec?: number
  /** Output time → spec time (lead-in, time warp). Spec time is clamped to [0, durationSec]. */
  timeMap?: (t: number) => number
  body?: BodyProportions
  /** Torso length in pixels. */
  pxPerTorso?: number
  width?: number
  height?: number
  /** Image position of the mid-hip in the neutral pose. */
  centerX?: number
  centerY?: number
  /** Camera roll in degrees (counter-clockwise in the image). */
  rollDeg?: number
  /** Time-varying roll (output time in seconds → degrees); overrides `rollDeg`. Models sway or a hand-held camera. */
  rollAt?: (t: number) => number
  /** Rotation of the person about the vertical axis (0 = facing the camera, 90 = side-on). */
  yawDeg?: number
  noisePx?: number
  /** Share of joints dropped at random (confidence 0, x = y = 0 like OpenPose). */
  dropRate?: number
  confidence?: number
  seed?: number
  personId?: number
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function gaussian(rand: () => number): () => number {
  return () => {
    const u = Math.max(rand(), 1e-12)
    const v = rand()
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }
}

/** Smooth 0 → 1 → 0 bump over [start, start + duration] (raised cosine). */
export function bump(t: number, start: number, duration: number): number {
  if (t <= start || t >= start + duration) return 0
  return (1 - Math.cos((2 * Math.PI * (t - start)) / duration)) / 2
}

/** Smooth 0 → 1 ramp over [start, start + duration]. */
export function ramp(t: number, start: number, duration: number): number {
  if (t <= start) return 0
  if (t >= start + duration) return 1
  return (1 - Math.cos((Math.PI * (t - start)) / duration)) / 2
}

type V3 = [number, number, number]

/** Unit direction of a segment from its frontal angle and forward share. */
function segmentDir(angleDeg: number, fwd: number, side: 1 | -1): V3 {
  const planar = 1 - Math.min(0.999, Math.max(0, fwd))
  const a = (angleDeg * Math.PI) / 180
  return [side * planar * Math.sin(a), -planar * Math.cos(a), Math.sqrt(Math.max(0, 1 - planar * planar))]
}

/** 25 joints in body units (torso = 1), mid-hip of the standing pose at the origin. */
export function poseJoints(angles: SyntheticPoseAngles, body: BodyProportions): V3[] {
  const add = (a: V3, b: V3, k = 1): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k]
  const lean = (angles.lean * Math.PI) / 180
  // Trunk frame: rotate (x, y) by the lean (towards +x for positive lean).
  const rot = (v: V3): V3 => [
    v[0] * Math.cos(lean) + v[1] * Math.sin(lean),
    -v[0] * Math.sin(lean) + v[1] * Math.cos(lean),
    v[2],
  ]

  const lThigh = segmentDir(angles.lThigh, angles.lThighFwd, 1)
  const lShank = segmentDir(angles.lShank, angles.lShankFwd, 1)
  const rThigh = segmentDir(angles.rThigh, angles.rThighFwd, -1)
  const rShank = segmentDir(angles.rShank, angles.rShankFwd, -1)
  const extent = (thigh: V3, shank: V3) => -(thigh[1] * body.thigh + shank[1] * body.shank)
  // The longer leg stands on the floor: squatting lowers the hips, a knee lift does not.
  const drop = Math.max(extent(lThigh, lShank), extent(rThigh, rShank)) - (body.thigh + body.shank)
  const root: V3 = [angles.shiftX, drop, 0]

  const neck = add(root, rot([0, 1, 0]))
  const lShoulder = add(neck, rot([body.shoulderHalf, 0, 0]))
  const rShoulder = add(neck, rot([-body.shoulderHalf, 0, 0]))
  const lElbow = add(lShoulder, rot(segmentDir(angles.lUpper, angles.lUpperFwd, 1)), body.upperArm)
  const lWrist = add(lElbow, rot(segmentDir(angles.lFore, angles.lForeFwd, 1)), body.forearm)
  const rElbow = add(rShoulder, rot(segmentDir(angles.rUpper, angles.rUpperFwd, -1)), body.upperArm)
  const rWrist = add(rElbow, rot(segmentDir(angles.rFore, angles.rForeFwd, -1)), body.forearm)
  const nose = add(add(neck, rot([0, body.neckToNose, 0])), [0, 0, 0.12])
  const lHip = add(root, [body.hipHalf, 0, 0])
  const rHip = add(root, [-body.hipHalf, 0, 0])
  const lKnee = add(lHip, lThigh, body.thigh)
  const lAnkle = add(lKnee, lShank, body.shank)
  const rKnee = add(rHip, rThigh, body.thigh)
  const rAnkle = add(rKnee, rShank, body.shank)
  const head = (dx: number, dy: number, dz: number) => add(nose, rot([dx, dy, 0]), 1).map((v, k) => v + (k === 2 ? dz : 0)) as V3
  const footPoint = (ankle: V3, side: 1 | -1, dx: number, dy: number, dz: number): V3 => [
    ankle[0] + side * dx * body.foot,
    ankle[1] + dy * body.foot,
    ankle[2] + dz * body.foot,
  ]

  const j: V3[] = new Array(25)
  j[0] = nose
  j[1] = neck
  j[2] = rShoulder
  j[3] = rElbow
  j[4] = rWrist
  j[5] = lShoulder
  j[6] = lElbow
  j[7] = lWrist
  j[8] = root
  j[9] = rHip
  j[10] = rKnee
  j[11] = rAnkle
  j[12] = lHip
  j[13] = lKnee
  j[14] = lAnkle
  j[15] = head(-0.07, 0.05, 0)
  j[16] = head(0.07, 0.05, 0)
  j[17] = head(-0.14, 0.02, -0.08)
  j[18] = head(0.14, 0.02, -0.08)
  j[19] = footPoint(lAnkle, 1, 0.1, -0.15, 0.7)
  j[20] = footPoint(lAnkle, 1, 0.3, -0.15, 0.6)
  j[21] = footPoint(lAnkle, 1, 0, -0.2, -0.2)
  j[22] = footPoint(rAnkle, -1, 0.1, -0.15, 0.7)
  j[23] = footPoint(rAnkle, -1, 0.3, -0.15, 0.6)
  j[24] = footPoint(rAnkle, -1, 0, -0.2, -0.2)
  return j
}

export function resolvePose(partial: Partial<SyntheticPoseAngles>): SyntheticPoseAngles {
  return { ...NEUTRAL_POSE, ...partial }
}

/** Render a spec to OpenPose-style frames (one person, all 25 joints). */
export function makeSyntheticFrames(spec: SyntheticExerciseSpec, opts: SyntheticOptions = {}): OpenPoseKeypointFrame[] {
  const fps = opts.fps ?? 25
  const timeMap = opts.timeMap ?? ((t: number) => t)
  const durationSec = opts.durationSec ?? spec.durationSec
  const body = opts.body ?? ADULT_BODY
  const width = opts.width ?? 1920
  const height = opts.height ?? 1080
  const px = opts.pxPerTorso ?? 200
  const cx = opts.centerX ?? width / 2
  const cy = opts.centerY ?? height * 0.55
  const rollAt = opts.rollAt ?? (() => opts.rollDeg ?? 0)
  const yaw = ((opts.yawDeg ?? 0) * Math.PI) / 180
  const noisePx = opts.noisePx ?? 0
  const dropRate = opts.dropRate ?? 0
  const baseConfidence = opts.confidence ?? 0.82
  const rand = mulberry32(opts.seed ?? 1)
  const gauss = gaussian(rand)

  const count = Math.max(0, Math.round(durationSec * fps))
  const frames: OpenPoseKeypointFrame[] = []
  for (let i = 0; i < count; i += 1) {
    const specT = Math.min(spec.durationSec, Math.max(0, timeMap(i / fps)))
    const joints = poseJoints(resolvePose(spec.pose(specT)), body)
    const roll = (rollAt(i / fps) * Math.PI) / 180
    const body25 = joints.map(([x, y, z], id) => {
      // Yaw about the vertical axis, then orthographic projection and camera roll.
      const xr = x * Math.cos(yaw) + z * Math.sin(yaw)
      const ix = xr * Math.cos(roll) - y * Math.sin(roll)
      const iy = xr * Math.sin(roll) + y * Math.cos(roll)
      const nx = noisePx * gauss()
      const ny = noisePx * gauss()
      if (rand() < dropRate) return { id, x: 0, y: 0, confidence: 0 }
      const confidence = Math.min(0.99, baseConfidence + 0.1 * (rand() - 0.5) - (id >= 15 ? 0.1 : 0))
      return { id, x: cx + ix * px + nx, y: cy - iy * px + ny, confidence }
    })
    frames.push({ frame_index: i, people: [{ person_id: opts.personId ?? 0, body25 }] })
  }
  return frames
}

/** BODY_25 right/left label pairs (arms, legs, eyes, ears, feet). */
export const BODY25_LR_PAIRS: Array<[number, number]> = [
  [2, 5],
  [3, 6],
  [4, 7],
  [9, 12],
  [10, 13],
  [11, 14],
  [15, 16],
  [17, 18],
  [22, 19],
  [23, 20],
  [24, 21],
]

/**
 * Horizontal reflection of every detected joint about x = axisX / 2 (missing
 * joints stay at (0,0)). With `swapLabels` the left/right labels are exchanged
 * as well, which is what a pose detector reports for a mirrored video.
 */
export function reflectFrames(frames: OpenPoseKeypointFrame[], axisX: number, swapLabels: boolean): OpenPoseKeypointFrame[] {
  const swap = new Map<number, number>()
  if (swapLabels) {
    for (const [r, l] of BODY25_LR_PAIRS) {
      swap.set(r, l)
      swap.set(l, r)
    }
  }
  return frames.map((frame) => ({
    frame_index: frame.frame_index,
    people: (frame.people ?? []).map((person) => ({
      person_id: person.person_id,
      body25: (person.body25 ?? []).map((j) => ({
        id: swap.get(j.id) ?? j.id,
        x: j.x === 0 && j.y === 0 ? 0 : axisX - j.x,
        y: j.y,
        confidence: j.confidence,
      })),
    })),
  }))
}
