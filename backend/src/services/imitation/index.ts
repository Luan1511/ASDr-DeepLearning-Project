/**
 * Public entry point of the imitation-scoring core (algorithm "imitation-v1").
 * Other modules import ONLY from here. Pure, deterministic, no I/O.
 */
import { sanitizeFps } from '../gaitFeatures'
import { IMITATION_V1 } from './constants'
import type { ExerciseFps, RecordedVia } from './types'

export * from './types'
export { IMITATION_V1 } from './constants'
export { buildTemplate, templateHash, canonicalJson } from './template'
export { scoreImitation, starsFor, bandFor } from './scoring'
export { exerciseTrackScore, selectExerciseTrack, type ExerciseTrackSelection } from './cleaning'
export { subsequenceDtw, type DtwResult } from './dtw'
export {
  makeSyntheticFrames,
  reflectFrames,
  ADULT_BODY,
  CHILD_BODY,
  NEUTRAL_POSE,
  type BodyProportions,
  type SyntheticExerciseSpec,
  type SyntheticOptions,
  type SyntheticPoseAngles,
} from './syntheticPose'
export { BUILTIN_EXERCISES, BUILTIN_SPECS, BUILTIN_VIDEO_SIZE } from './builtinExercises'
export { BANNED_FEEDBACK_WORDS, EFFORT_LINE, containsBannedWord } from './feedback'

/**
 * Frame rate used for scoring. Webcam recordings (MediaRecorder, variable
 * frame rate) use frames ÷ measured duration; uploads trust the ML server's
 * probe first. `warning` = the two sources disagree by more than 20 %.
 */
export function resolveExerciseFps(p: {
  recordedVia: RecordedVia
  frameCount: number
  durationMs: number | null
  mlFps: number | null
}): ExerciseFps | null {
  const ml = sanitizeFps(p.mlFps)
  const byDuration =
    p.durationMs !== null && p.durationMs > 0 && p.frameCount > 0 ? sanitizeFps(p.frameCount / (p.durationMs / 1000)) : null
  const disagree = (chosen: number, other: number | null) =>
    other !== null && Math.abs(other - chosen) / chosen > IMITATION_V1.fpsTolerance

  if (p.recordedVia === 'WEBCAM') {
    if (byDuration !== null) return { fps: byDuration, source: 'duration', warning: disagree(byDuration, ml) }
    return ml !== null ? { fps: ml, source: 'ml', warning: true } : null
  }
  if (ml !== null) return { fps: ml, source: 'ml', warning: disagree(ml, byDuration) }
  return byDuration !== null ? { fps: byDuration, source: 'duration', warning: false } : null
}
