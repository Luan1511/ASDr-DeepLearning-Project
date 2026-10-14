/**
 * Person tracking shared by the gait features and the imitation scoring:
 * link OpenPose detections frame-to-frame into tracks, then let the caller
 * choose a track with its own scoring rule. Moved verbatim from
 * gaitFeatures.ts; gait output is guarded by test/fixtures/gaitGolden.json.
 */
import type { OpenPoseKeypointFrame } from './openposeService'

export type Point = { x: number; y: number }
export type Pose = Array<Point | null>
export type Person = OpenPoseKeypointFrame['people'][number]

export const MIN_CONFIDENCE = 0.3

export type PoseTrack = {
  lastCenter: Point
  lastFrame: number
  scale: number
  members: Map<number, { person: Person; pose: Pose }>
}

export type TrackedFrame = { pose: Pose; confidence: number; person: Person } | null

// BODY_25 joint ids used here.
const NECK = 1
const MID_HIP = 8
const L_ANKLE = 14
const R_ANKLE = 11

const MAX_TRACK_GAP_FRAMES = 15

function std(values: number[]): number | null {
  if (values.length < 2) return null
  const m = values.reduce((a, b) => a + b, 0) / values.length
  return Math.sqrt(values.reduce((acc, v) => acc + (v - m) ** 2, 0) / (values.length - 1))
}

function dist(a: Point | null, b: Point | null): number | null {
  if (!a || !b) return null
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export function toPose(person: Person): Pose {
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

export function confidentJointCount(person: Person): number {
  return (person.body25 ?? []).filter((j) => j.confidence >= MIN_CONFIDENCE && (j.x !== 0 || j.y !== 0)).length
}

function meanConfidence(person: Person): number {
  const confs = (person.body25 ?? []).map((j) => j.confidence).filter((c) => Number.isFinite(c))
  return confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : 0
}

export function poseCenter(pose: Pose): Point | null {
  if (pose[MID_HIP]) return pose[MID_HIP]
  if (pose[NECK]) return pose[NECK]
  const pts = pose.filter((p): p is Point => p !== null)
  if (!pts.length) return null
  return { x: pts.reduce((a, p) => a + p.x, 0) / pts.length, y: pts.reduce((a, p) => a + p.y, 0) / pts.length }
}

/**
 * Link everyone OpenPose detected frame-to-frame by proximity into tracks
 * (tracks are returned in creation order). The ST-GCN preprocessing on the ML
 * server still uses its own per-frame "most confident person" rule.
 */
export function buildTracks(frames: OpenPoseKeypointFrame[]): PoseTrack[] {
  const tracks: PoseTrack[] = []

  frames.forEach((frame, t) => {
    const candidates = (frame.people ?? [])
      .filter((p) => confidentJointCount(p) >= 6)
      .map((person) => {
        const pose = toPose(person)
        return { person, pose, center: poseCenter(pose), scale: dist(pose[NECK], pose[MID_HIP]) ?? 100 }
      })
      .filter((c): c is typeof c & { center: Point } => c.center !== null)
      .sort((a, b) => meanConfidence(b.person) - meanConfidence(a.person))

    const used = new Set<PoseTrack>()
    for (const c of candidates) {
      let best: PoseTrack | null = null
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
      const track: PoseTrack = best ?? { lastCenter: c.center, lastFrame: t, scale: c.scale, members: new Map() }
      if (!best) tracks.push(track)
      track.lastCenter = c.center
      track.lastFrame = t
      track.scale = 0.8 * track.scale + 0.2 * c.scale
      track.members.set(t, { person: c.person, pose: c.pose })
      used.add(track)
    }
  })

  return tracks
}

/** Iterates tracks in creation order; keeps the earlier track on ties (strict >). */
export function selectTrack(tracks: PoseTrack[], score: (t: PoseTrack) => number): PoseTrack | null {
  return tracks.reduce<PoseTrack | null>((best, track) => {
    const bestScore = best ? score(best) : -1
    return score(track) > bestScore ? track : best
  }, null)
}

export function trackToFrames(track: PoseTrack | null, frameCount: number): TrackedFrame[] {
  return Array.from({ length: frameCount }, (_, t) => {
    const member = track?.members.get(t)
    if (!member) return null
    const core = (member.person.body25 ?? []).filter((j) => j.id <= 14).map((j) => j.confidence)
    return {
      pose: member.pose,
      confidence: core.length ? core.reduce((a, b) => a + b, 0) / core.length : 0,
      person: member.person,
    }
  })
}

/**
 * Gait rule: a long track whose legs move. A still, confident adult at the
 * edge of the frame therefore does not replace the walking child.
 */
export function gaitTrackScore(track: PoseTrack): number {
  const sx: number[] = []
  const sy: number[] = []
  for (const { pose } of track.members.values()) {
    const l = pose[L_ANKLE]
    const r = pose[R_ANKLE]
    if (!l || !r) continue
    sx.push((l.x - r.x) / track.scale)
    sy.push((l.y - r.y) / track.scale)
  }
  return track.members.size * (1 + ((std(sx) ?? 0) + (std(sy) ?? 0)))
}
