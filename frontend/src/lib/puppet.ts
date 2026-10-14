/**
 * Geometry of the guide character "bạn Mầm": decoding the template's normalised
 * skeleton, interpolation at animation time, mirroring and the procedural
 * idle/cheer/shrug poses. Units are torso lengths (L), y up, mid-hip root at (0,0).
 */
import { useSyncExternalStore } from 'react'
import type { GuideTemplateDto } from './exerciseTypes'

export type Vec = { x: number; y: number }
/** Joints 0..14 in BODY_25 order, always complete (missing joints are filled). */
export type PuppetPose = Vec[]

export const J = {
  nose: 0,
  neck: 1,
  rShoulder: 2,
  rElbow: 3,
  rWrist: 4,
  lShoulder: 5,
  lElbow: 6,
  lWrist: 7,
  midHip: 8,
  rHip: 9,
  rKnee: 10,
  rAnkle: 11,
  lHip: 12,
  lKnee: 13,
  lAnkle: 14,
} as const

const JOINT_COUNT = 15
const LEFT_RIGHT: Array<[number, number]> = [
  [J.rShoulder, J.lShoulder],
  [J.rElbow, J.lElbow],
  [J.rWrist, J.lWrist],
  [J.rHip, J.lHip],
  [J.rKnee, J.lKnee],
  [J.rAnkle, J.lAnkle],
]
const SWAP: number[] = Array.from({ length: JOINT_COUNT }, (_, j) => {
  const pair = LEFT_RIGHT.find(([r, l]) => r === j || l === j)
  return pair ? (pair[0] === j ? pair[1] : pair[0]) : j
})

/**
 * Standing pose used for joints the template never saw. As in the camera image,
 * a person facing the viewer has their right side at −x.
 */
export const DEFAULT_NEUTRAL: PuppetPose = [
  { x: 0, y: 1.3 },
  { x: 0, y: 1 },
  { x: -0.38, y: 0.97 },
  { x: -0.46, y: 0.5 },
  { x: -0.5, y: 0.06 },
  { x: 0.38, y: 0.97 },
  { x: 0.46, y: 0.5 },
  { x: 0.5, y: 0.06 },
  { x: 0, y: 0 },
  { x: -0.2, y: 0 },
  { x: -0.21, y: -0.68 },
  { x: -0.22, y: -1.36 },
  { x: 0.2, y: 0 },
  { x: 0.21, y: -0.68 },
  { x: 0.22, y: -1.36 },
]

export type PuppetTrack = {
  hz: number
  /** Playback length at speed 1. */
  durationSec: number
  frames: PuppetPose[]
  neutral: PuppetPose
  /** Floor height: the lowest ankle of the neutral pose. */
  groundY: number
}

type GuideInput = Pick<GuideTemplateDto, 'hz' | 'joints' | 'frames' | 'neutral'>

const finite = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v)

/** One guide frame (30 numbers in `joints` order) → per-joint points, null where missing. */
export function decodeFrame(joints: number[], values: Array<number | null> | null): Array<Vec | null> {
  const out: Array<Vec | null> = new Array(JOINT_COUNT).fill(null)
  if (!values) return out
  joints.forEach((id, i) => {
    if (id < 0 || id >= JOINT_COUNT) return
    const x = values[2 * i]
    const y = values[2 * i + 1]
    if (finite(x) && finite(y)) out[id] = { x, y }
  })
  return out
}

/** Decodes the guide once; a missing joint holds its last value, or the neutral pose if never seen. */
export function buildPuppetTrack(guide: GuideInput): PuppetTrack {
  const hz = guide.hz > 0 ? guide.hz : 15
  const joints = guide.joints.length ? guide.joints : Array.from({ length: JOINT_COUNT }, (_, j) => j)
  const rawNeutral = decodeFrame(joints, guide.neutral)
  const neutral = DEFAULT_NEUTRAL.map((fallback, j) => rawNeutral[j] ?? fallback)

  const last: Array<Vec | null> = new Array(JOINT_COUNT).fill(null)
  const frames = guide.frames.map((values) => {
    const raw = decodeFrame(joints, values)
    return neutral.map((n, j) => {
      const seen = raw[j]
      if (seen) last[j] = seen
      return last[j] ?? n
    })
  })
  if (frames.length === 0) frames.push(neutral)

  return {
    hz,
    durationSec: frames.length / hz,
    frames,
    neutral,
    groundY: Math.min(neutral[J.rAnkle].y, neutral[J.lAnkle].y),
  }
}

const lerp = (a: Vec, b: Vec, t: number): Vec => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })

/** Pose at `tSec` (template time), linearly interpolated between the 15 Hz samples. */
export function samplePose(track: PuppetTrack, tSec: number): PuppetPose {
  const n = track.frames.length
  const f = Math.max(0, Math.min(n - 1, tSec * track.hz))
  const i0 = Math.floor(f)
  const i1 = Math.min(n - 1, i0 + 1)
  const a = f - i0
  if (a === 0 || i0 === i1) return track.frames[i0]
  return track.frames[i0].map((p, j) => lerp(p, track.frames[i1][j], a))
}

/** Left-right mirror image: x negated and left/right joints swapped, so it is again a valid facing pose. */
export function mirrorFrame(pose: PuppetPose): PuppetPose {
  return pose.map((_, j) => ({ x: -pose[SWAP[j]].x, y: pose[SWAP[j]].y }))
}

/**
 * Keeps the lower foot on the floor. Guide frames are root-centred, so without
 * this a squat would lift the feet instead of lowering the hips.
 */
export function plantFeet(pose: PuppetPose, groundY: number): PuppetPose {
  const dy = groundY - Math.min(pose[J.rAnkle].y, pose[J.lAnkle].y)
  if (Math.abs(dy) < 1e-6) return pose
  return pose.map((p) => ({ x: p.x, y: p.y + dy }))
}

const UPPER_BODY: number[] = [J.nose, J.neck, J.rShoulder, J.rElbow, J.rWrist, J.lShoulder, J.lElbow, J.lWrist]
const wave = (t: number, hz: number) => Math.sin(2 * Math.PI * hz * t)

function withArms(pose: PuppetPose, arm: (shoulder: Vec, side: -1 | 1) => { elbow: Vec; wrist: Vec }): PuppetPose {
  const out = pose.map((p) => ({ ...p }))
  for (const [side, s, e, w] of [
    [-1, J.rShoulder, J.rElbow, J.rWrist],
    [1, J.lShoulder, J.lElbow, J.lWrist],
  ] as const) {
    const { elbow, wrist } = arm(out[s], side)
    out[e] = elbow
    out[w] = wrist
  }
  return out
}

/** Standing, gently breathing. `motion=false` (reduced motion) gives a still pose. */
export function idlePose(neutral: PuppetPose, tSec: number, motion: boolean): PuppetPose {
  if (!motion) return neutral
  const bob = 0.025 * wave(tSec, 0.6)
  return neutral.map((p, j) => (UPPER_BODY.includes(j) ? { x: p.x, y: p.y + bob } : p))
}

/** Both arms up in a V, waving. */
export function cheerPose(neutral: PuppetPose, tSec: number, motion: boolean): PuppetPose {
  const swing = motion ? 0.07 * wave(tSec, 1.4) : 0
  const bob = motion ? 0.03 * Math.abs(wave(tSec, 0.7)) : 0
  const lifted = neutral.map((p, j) => (UPPER_BODY.includes(j) ? { x: p.x, y: p.y + bob } : p))
  return withArms(lifted, (sh, side) => ({
    elbow: { x: sh.x + side * 0.26, y: sh.y + 0.42 },
    wrist: { x: sh.x + side * (0.5 + swing), y: sh.y + 0.86 },
  }))
}

/** Shoulders up, forearms out with open palms: "chưa nhìn rõ". */
export function shrugPose(neutral: PuppetPose, tSec: number, motion: boolean): PuppetPose {
  const raise = 0.08 + (motion ? 0.03 * Math.max(0, wave(tSec, 0.5)) : 0)
  const raised = neutral.map((p, j) =>
    j === J.rShoulder || j === J.lShoulder ? { x: p.x, y: p.y + raise } : j === J.neck ? { x: p.x, y: p.y + raise / 2 } : p,
  )
  return withArms(raised, (sh, side) => {
    const elbow = { x: sh.x + side * 0.16, y: sh.y - 0.42 }
    return { elbow, wrist: { x: elbow.x + side * 0.36, y: elbow.y + 0.1 } }
  })
}

// ---------------------------------------------------------------------------
// Motion preference (shared by the puppet and the star animation)
// ---------------------------------------------------------------------------

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

function subscribeReducedMotion(onChange: () => void) {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {}
  const mq = window.matchMedia(REDUCED_MOTION_QUERY)
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}

function reducedMotionSnapshot() {
  return typeof window !== 'undefined' && Boolean(window.matchMedia?.(REDUCED_MOTION_QUERY).matches)
}

export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReducedMotion, reducedMotionSnapshot, () => false)
}
