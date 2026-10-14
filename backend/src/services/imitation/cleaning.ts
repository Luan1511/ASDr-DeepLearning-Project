/**
 * imitation-v1 steps A (person selection) and B (cleaning + 15 Hz resampling).
 * Works in image coordinates; features.ts converts to y-up.
 */
import type { OpenPoseKeypointFrame } from '../openposeService'
import { buildTracks, poseCenter, selectTrack, type Person, type Point, type PoseTrack } from '../poseTracking'
import { IMITATION_V1 as C } from './constants'

/** Joints 0..14 of BODY_25 (the face and feet are not used for scoring). */
export const JOINT_COUNT = 15
export type Joints = Array<Point | null>

// BODY_25 ids
export const NECK = 1
export const R_SHOULDER = 2
export const R_ELBOW = 3
export const R_WRIST = 4
export const L_SHOULDER = 5
export const L_ELBOW = 6
export const L_WRIST = 7
export const MID_HIP = 8
export const R_HIP = 9
export const R_KNEE = 10
export const R_ANKLE = 11
export const L_HIP = 12
export const L_KNEE = 13
export const L_ANKLE = 14
export const LIMB_ENDS = [R_WRIST, L_WRIST, R_ANKLE, L_ANKLE] as const

/** Right/left label pairs among joints 0..14. */
export const ARM_PAIRS: Array<[number, number]> = [
  [R_SHOULDER, L_SHOULDER],
  [R_ELBOW, L_ELBOW],
  [R_WRIST, L_WRIST],
]
export const LEG_PAIRS: Array<[number, number]> = [
  [R_HIP, L_HIP],
  [R_KNEE, L_KNEE],
  [R_ANKLE, L_ANKLE],
]

// ---------------------------------------------------------------------------
// A. Person selection
// ---------------------------------------------------------------------------

function sampleStd(values: number[]): number {
  if (values.length < 2) return 0
  const m = values.reduce((a, b) => a + b, 0) / values.length
  return Math.sqrt(values.reduce((acc, v) => acc + (v - m) ** 2, 0) / (values.length - 1))
}

/** Σ over wrists and ankles of std(x_rel) + std(y_rel), rel = (joint − mid-hip) / torso. */
export function limbMotion(track: PoseTrack): number {
  let total = 0
  for (const j of LIMB_ENDS) {
    const xs: number[] = []
    const ys: number[] = []
    for (const { pose } of track.members.values()) {
      const p = pose[j]
      const hip = pose[MID_HIP]
      if (!p || !hip) continue
      const neck = pose[NECK]
      const torso = neck ? Math.hypot(neck.x - hip.x, neck.y - hip.y) : 0
      const scale = torso > 0 ? torso : track.scale
      if (!(scale > 0)) continue
      xs.push((p.x - hip.x) / scale)
      ys.push((p.y - hip.y) / scale)
    }
    total += sampleStd(xs) + sampleStd(ys)
  }
  return total
}

/** Exercise rule: present for most of the clip AND moving its limbs. */
export function exerciseTrackScore(track: PoseTrack, frameCount: number): number {
  if (!(frameCount > 0)) return 0
  return (track.members.size / frameCount) * (1 + limbMotion(track))
}

export interface ExerciseTrackSelection {
  track: PoseTrack | null
  coverage: number
  /** Another track is present most of the time and moves at least half as much. */
  multiPerson: boolean
}

function meanCenter(track: PoseTrack): Point | null {
  let sx = 0
  let sy = 0
  let n = 0
  for (const { pose } of track.members.values()) {
    const c = poseCenter(pose)
    if (!c) continue
    sx += c.x
    sy += c.y
    n += 1
  }
  return n ? { x: sx / n, y: sy / n } : null
}

export function selectExerciseTrack(
  frames: OpenPoseKeypointFrame[],
  videoSize: { width: number; height: number } | null | undefined,
): ExerciseTrackSelection {
  const frameCount = frames.length
  const tracks = buildTracks(frames)
  const scores = new Map(tracks.map((t) => [t, exerciseTrackScore(t, frameCount)]))
  let chosen = selectTrack(tracks, (t) => scores.get(t) as number)
  if (!chosen) return { track: null, coverage: 0, multiPerson: false }

  // Near-tie: the child is the one nearer the middle of the picture.
  const width = videoSize?.width ?? 0
  const height = videoSize?.height ?? 0
  if (width > 0 && height > 0 && tracks.length > 1) {
    const ranked = [...tracks].sort((a, b) => (scores.get(b) as number) - (scores.get(a) as number))
    const top = scores.get(chosen) as number
    const runnerUp = ranked.find((t) => t !== chosen)
    if (runnerUp && top - (scores.get(runnerUp) as number) <= C.tieBreakRel * top) {
      const centre = { x: width / 2, y: height / 2 }
      const distance = (t: PoseTrack) => {
        const c = meanCenter(t)
        return c ? Math.hypot(c.x - centre.x, c.y - centre.y) : Number.POSITIVE_INFINITY
      }
      if (distance(runnerUp) < distance(chosen)) chosen = runnerUp
    }
  }

  const chosenMotion = limbMotion(chosen)
  const multiPerson = tracks.some(
    (t) =>
      t !== chosen &&
      t.members.size / frameCount > C.multiPerson.coverage &&
      limbMotion(t) > C.multiPerson.motionRel * chosenMotion,
  )
  return { track: chosen, coverage: chosen.members.size / frameCount, multiPerson }
}

// ---------------------------------------------------------------------------
// B. Cleaning and resampling
// ---------------------------------------------------------------------------

function validJoints(person: Person): Joints {
  const out: Joints = new Array(JOINT_COUNT).fill(null)
  for (const j of person.body25 ?? []) {
    if (!(j.id >= 0 && j.id < JOINT_COUNT)) continue
    if (!(j.confidence >= C.minConf)) continue
    if (!Number.isFinite(j.x) || !Number.isFinite(j.y)) continue
    if (j.x === 0 && j.y === 0) continue
    out[j.id] = { x: j.x, y: j.y }
  }
  return out
}

/** Source frames of the chosen track (null where the track has no member). */
export function trackJoints(track: PoseTrack | null, frameCount: number): Array<Joints | null> {
  return Array.from({ length: frameCount }, (_, t) => {
    const member = track?.members.get(t)
    return member ? validJoints(member.person) : null
  })
}

/** Swap the left/right labels of every pair, in place. */
export function swapPairs(joints: Joints, pairs: Array<[number, number]>): void {
  for (const [r, l] of pairs) {
    const tmp = joints[r]
    joints[r] = joints[l]
    joints[l] = tmp
  }
}

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)

/**
 * OpenPose sometimes exchanges left and right for a frame. Compare the frame
 * with the last frame where the whole group was seen: if the swapped labels
 * are much closer (d_swap < 0.5 · d_keep), swap them back.
 *
 * The comparison only keeps labels consistent along a chain of frames; if the
 * chain started on a swapped frame, most frames end up "repaired". The
 * detector is right most of the time, so a chain that swapped more than half
 * of its frames is flipped back as a whole.
 */
export function repairSwaps(frames: Array<Joints | null>, fps: number): void {
  const maxAge = Math.max(1, Math.round(fps))
  for (const pairs of [ARM_PAIRS, LEG_PAIRS]) {
    let ref: Joints | null = null
    let refFrame = -1
    let chain: number[] = []
    let swapped = 0
    const closeChain = () => {
      if (swapped * 2 > chain.length) for (const t of chain) swapPairs(frames[t] as Joints, pairs)
      chain = []
      swapped = 0
    }
    frames.forEach((joints, t) => {
      if (!joints) return
      if (ref && t - refFrame <= maxAge) {
        let keep = 0
        let swap = 0
        let used = 0
        for (const [r, l] of pairs) {
          const pr = joints[r]
          const pl = joints[l]
          const rr = ref[r]
          const rl = ref[l]
          if (!pr || !pl || !rr || !rl) continue
          keep += distance(pr, rr) + distance(pl, rl)
          swap += distance(pl, rr) + distance(pr, rl)
          used += 1
        }
        if (used > 0 && swap < 0.5 * keep) {
          swapPairs(joints, pairs)
          swapped += 1
        }
      } else {
        closeChain()
      }
      chain.push(t)
      if (pairs.every(([r, l]) => joints[r] && joints[l])) {
        ref = joints.slice()
        refFrame = t
      }
    })
    closeChain()
  }
}

/** Median of three consecutive samples per coordinate, only where all three exist. */
export function medianOf3(frames: Array<Joints | null>): Array<Joints | null> {
  const med = (a: number, b: number, c: number) => Math.max(Math.min(a, b), Math.min(Math.max(a, b), c))
  return frames.map((joints, t) => {
    if (!joints || t === 0 || t === frames.length - 1) return joints ? joints.slice() : null
    const prev = frames[t - 1]
    const next = frames[t + 1]
    return joints.map((p, j) => {
      const a = prev?.[j]
      const c = next?.[j]
      if (!p || !a || !c) return p
      return { x: med(a.x, p.x, c.x), y: med(a.y, p.y, c.y) }
    })
  })
}

/** Linear interpolation of per-joint gaps of at most `maxGap` source frames. */
export function fillGaps(frames: Array<Joints | null>, maxGap: number): Array<Joints | null> {
  const out: Array<Joints | null> = frames.map((f) => (f ? f.slice() : null))
  for (let j = 0; j < JOINT_COUNT; j += 1) {
    let last = -1
    for (let t = 0; t < out.length; t += 1) {
      const p = out[t]?.[j]
      if (!p) continue
      const gap = t - last - 1
      if (last >= 0 && gap > 0 && gap <= maxGap) {
        const a = out[last]?.[j] as Point
        for (let k = last + 1; k < t; k += 1) {
          const f = (k - last) / (t - last)
          const target = out[k] ?? (out[k] = new Array(JOINT_COUNT).fill(null))
          target[j] = { x: a.x + (p.x - a.x) * f, y: a.y + (p.y - a.y) * f }
        }
      }
      last = t
    }
  }
  return out
}

/**
 * Resample to 15 Hz at t_k = k/15. Coordinates are interpolated (never
 * angles); a joint missing on one side falls back to the nearest source frame
 * within half a source period.
 */
export function resample(frames: Array<Joints | null>, fps: number): Array<Joints | null> {
  const count = frames.length
  if (!count || !(fps > 0)) return []
  const samples = Math.floor(((count - 1) / fps) * C.hz) + 1
  const out: Array<Joints | null> = []
  for (let k = 0; k < samples; k += 1) {
    const s = (k / C.hz) * fps
    const lo = Math.min(count - 1, Math.floor(s + 1e-9))
    const hi = Math.min(count - 1, lo + 1)
    const f = s - lo
    const a = frames[lo]
    const b = frames[hi]
    let any = false
    const joints: Joints = new Array(JOINT_COUNT).fill(null)
    for (let j = 0; j < JOINT_COUNT; j += 1) {
      const pa = a?.[j] ?? null
      const pb = b?.[j] ?? null
      let p: Point | null = null
      if (f <= 1e-9) p = pa
      else if (pa && pb) p = { x: pa.x + (pb.x - pa.x) * f, y: pa.y + (pb.y - pa.y) * f }
      else if (pa && f <= 0.5) p = pa
      else if (pb && 1 - f <= 0.5) p = pb
      if (p) {
        joints[j] = p
        any = true
      }
    }
    out.push(any ? joints : null)
  }
  return out
}

/** Steps B.1–B.5 for the chosen track. */
export function cleanAndResample(track: PoseTrack | null, frameCount: number, fps: number): Array<Joints | null> {
  const raw = trackJoints(track, frameCount)
  repairSwaps(raw, fps)
  const smoothed = medianOf3(raw)
  const filled = fillGaps(smoothed, Math.round(C.maxGapSec * fps))
  return resample(filled, fps)
}
