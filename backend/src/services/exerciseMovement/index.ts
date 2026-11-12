import type { OpenPoseKeypointFrame } from '../openposeService'
import type { PoseTrack } from '../poseTracking'
import { cleanAndResample, JOINT_COUNT, selectExerciseTrack, type Joints } from '../imitation/cleaning'
import { IMITATION_V1 as core } from '../imitation/constants'
import { extractFeatures, finiteValues, median, type FeatureExtraction } from '../imitation/features'
import * as twists from './twists'
import * as jacks from './jacks'
import * as kicks from './kicks'
import {
  CHECK_CODES, MOVEMENT_LABELS, MOVEMENT_VERSION, readMovementReference,
  type MovementFrame, type MovementProfile, type MovementReference, type MovementReport,
} from './types'

function normalizeFrames(
  poses: Array<Joints | null>,
  features: FeatureExtraction,
  track: PoseTrack,
  frameCount: number,
  fps: number,
  start = 0,
  end = poses.length,
): MovementFrame[] {
  const radians = features.roll * Math.PI / 180
  const cosine = Math.cos(radians)
  const sine = Math.sin(radians)
  return poses.slice(start, end).map((joints, offset) => {
    const index = start + offset
    const timeSec = index / core.hz
    const nativeIndex = Math.min(frameCount - 1, Math.round(timeSec * fps))
    const raw = track.members.get(nativeIndex)?.person.body25 ?? []
    // The cleaner can interpolate joints. Only a directly observed native
    // point may support an assertion that a limb stayed still.
    const confidence = Array<number>(JOINT_COUNT).fill(0)
    for (const point of raw) {
      if (Number.isInteger(point.id) && point.id >= 0 && point.id < JOINT_COUNT &&
          Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.confidence) &&
          (point.x !== 0 || point.y !== 0)) confidence[point.id] = point.confidence
    }
    const hip = joints?.[8]
    const scale = features.torso[index]
    const pose = joints && hip && scale && scale > 0 ? joints.map(point => {
      if (!point) return null
      const x = (point.x - hip.x) / scale
      const y = (hip.y - point.y) / scale
      return [cosine * x + sine * y, -sine * x + cosine * y] as [number, number]
    }) : null
    return { timeSec, pose, confidence }
  })
}

/** Persist just the calibration scalars alongside the versioned template. */
export function compileMovementReference(input: {
  profile: MovementProfile
  track: PoseTrack
  poses: Array<Joints | null>
  features: FeatureExtraction
  frameCount: number
  fps: number
  segment: [number, number]
}): MovementReference | null {
  const { profile, track, poses, features, frameCount, fps, segment } = input
  const guide = normalizeFrames(poses, features, track, frameCount, fps, segment[0], segment[1] + 1)
  const [neutralStart, neutralEnd] = features.refWindow
  const reference = profile === 'jump-twists' ? twists.buildReference(guide, fps)
    : profile === 'jumping-jacks' ? jacks.buildReference(guide, fps)
      : kicks.buildReference(guide, normalizeFrames(poses, features, track, frameCount, fps, neutralStart, neutralEnd), fps)
  return readMovementReference({ version: MOVEMENT_VERSION, profile, guideSourceFps: fps, reference })
}

const STILL_SEC = 2
const PAUSE_PAD = Math.round(core.hz * 0.5)
const READY_SAMPLES = Math.round(core.hz * 0.6)
const VISIBLE_LIMBS = [4, 7, 11, 14]

function seen(frame: MovementFrame, joint: number): boolean {
  return !!frame.pose?.[joint] && frame.confidence[joint] >= core.minConf
}

function splitBouts(frames: MovementFrame[], speed: FeatureExtraction['limbSpeed']) {
  const still = frames.map((frame, index) => {
    const local = finiteValues(speed.slice(Math.max(0, index - 3), index + 4))
    return VISIBLE_LIMBS.filter(joint => seen(frame, joint)).length >= 3 &&
      local.length >= 3 && (median(local) ?? Infinity) < core.trim.neutralMaxSpeed
  })
  const bouts: Array<{ start: number; end: number }> = []
  let start = 0
  for (let i = 0; i < frames.length;) {
    // Long tracking gaps and pauses reset repetition adjacency.
    const missing = frames[i].pose === null
    if (!missing && !still[i]) { i++; continue }
    let end = i + 1
    while (end < frames.length && (missing ? frames[end].pose === null : still[end])) end++
    const minimum = missing ? Math.ceil(0.5 * core.hz) : STILL_SEC * core.hz
    if (end - i >= minimum) {
      const previousEnd = missing ? i : i + PAUSE_PAD
      if (previousEnd > start) bouts.push({ start, end: previousEnd })
      start = missing ? end : end - PAUSE_PAD
    }
    i = end
  }
  if (start < frames.length) bouts.push({ start, end: frames.length })
  return bouts
}

function readyFrames(
  profile: MovementProfile,
  frames: MovementFrame[],
  speed: FeatureExtraction['limbSpeed'],
  start: number,
  end: number,
): MovementFrame[] | undefined {
  const stop = Math.min(end, start + READY_SAMPLES)
  const candidate = frames.slice(start, stop)
  const measured = finiteValues(speed.slice(start + 3, stop))
  if (candidate.length < READY_SAMPLES || measured.length < 3 ||
      (median(measured) ?? Infinity) >= core.trim.neutralMaxSpeed) return undefined
  const visible = candidate.filter(frame => VISIBLE_LIMBS.every(joint => seen(frame, joint)))
  if (visible.length < 0.8 * candidate.length) return undefined
  if (profile === 'jumping-jacks') {
    // A quiet wide stance must not become the target for the closing phase.
    const closed = visible.filter(frame => {
      if (![2, 5, 9, 12].every(joint => seen(frame, joint))) return false
      const p = frame.pose!
      const hips = Math.abs(p[9]![0] - p[12]![0])
      const ankles = Math.abs(p[11]![0] - p[14]![0])
      return ankles <= Math.max(0.4, 1.25 * hips) && p[4]![1] < p[2]![1] && p[7]![1] < p[5]![1]
    })
    if (closed.length < 0.8 * candidate.length) return undefined
  }
  return candidate
}

type DetectorResult = {
  checks: Array<{ code: string; status: string }>
  events: Array<{ code: string; label: string; feedback: string; startSec: number | null; endSec: number | null; evidence: unknown }>
}

function repetitions(evidence: unknown): number | null {
  if (!evidence || typeof evidence !== 'object') return null
  const values = evidence as Record<string, unknown>
  const count = values.repetitions ?? values.cycles ?? values.repeatedStrokes ?? values.kickCount
  return typeof count === 'number' && Number.isInteger(count) && count > 0 ? count : null
}

export function analyzeExerciseMovement(input: {
  template: MovementReference
  frames: OpenPoseKeypointFrame[]
  fps: number
  videoSize: { width: number; height: number } | null
}): MovementReport {
  const { template, fps, videoSize } = input
  const { profile, guideSourceFps } = template
  const checks: MovementReport['checks'] = CHECK_CODES[profile].map(code => ({
    code, label: MOVEMENT_LABELS[code], status: 'unmeasurable',
  }))
  const report: MovementReport = { profile, version: MOVEMENT_VERSION, checks, events: [] }
  const frames = [...input.frames].sort((a, b) => a.frame_index - b.frame_index)
  const selection = selectExerciseTrack(frames, videoSize)
  if (!selection.track || selection.coverage < core.coverageMin || selection.multiPerson) return report
  const poses = cleanAndResample(selection.track, frames.length, fps)
  const features = extractFeatures(poses, 'child')
  const normalized = normalizeFrames(poses, features, selection.track, frames.length, fps)
  for (const bout of splitBouts(normalized, features.limbSpeed)) {
    const options = {
      sourceFps: fps, guideSourceFps,
      neutralFrames: readyFrames(profile, normalized, features.limbSpeed, bout.start, bout.end),
    }
    const segment = normalized.slice(bout.start, bout.end)
    const result: DetectorResult = template.profile === 'jump-twists'
      ? twists.analyzeWithReference(segment, template.reference, options)
      : template.profile === 'jumping-jacks'
        ? jacks.analyzeWithReference(segment, template.reference, options)
        : kicks.analyzeWithReference(segment, template.reference, options)
    for (const check of report.checks) {
      if (result.checks.some(row => row.code === check.code && row.status === 'evaluated')) check.status = 'evaluated'
    }
    for (const event of result.events) {
      const check = report.checks.find(row => row.code === event.code)
      if (!check || event.startSec === null || event.endSec === null ||
          !Number.isFinite(event.startSec) || !Number.isFinite(event.endSec) || event.endSec <= event.startSec) continue
      check.status = 'evaluated'
      report.events.push({
        code: check.code, label: event.label, feedback: event.feedback,
        startSec: Math.round(event.startSec * 1000) / 1000,
        endSec: Math.round(event.endSec * 1000) / 1000,
        repetitions: repetitions(event.evidence),
      })
    }
  }
  report.events.sort((a, b) => a.startSec - b.startSec || a.code.localeCompare(b.code))
  return report
}
