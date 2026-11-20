import type { BuddyFace, FaceCue } from './visionTracking'

/**
 * Face cues for one chat turn, summed over the whole turn instead of the last
 * frame: a smile at the start of a sentence still counts, and a single noisy
 * frame does not. These are facial movements, not emotions; the prompt says so.
 */
export type CueFrame = { time: number; faces: Array<Pick<BuddyFace, 'id' | 'cue'>> }

/** A cue counts for a face when it shows in at least this share of that face's frames. */
export const CUE_SHARE = 0.3
/** Fewer frames than this (about 0.5 s at 8 frames per second) is too little to say anything. */
export const MIN_CUE_FRAMES = 4
/** A typed turn has no audio timing: look at the last seconds before it was sent. */
export const TYPED_TURN_MS = 3000

const CUES: FaceCue[] = ['smile', 'brow_lowered']

/** Cues per face track id for the frames between `from` and `to` (inclusive). */
export function turnCues(frames: CueFrame[], from: number, to: number): Map<number, FaceCue[]> {
  const counts = new Map<number, { frames: number } & Record<FaceCue, number>>()
  for (const frame of frames) {
    if (frame.time < from || frame.time > to) continue
    for (const face of frame.faces) {
      const count = counts.get(face.id) ?? { frames: 0, smile: 0, brow_lowered: 0 }
      count.frames += 1
      if (face.cue) count[face.cue] += 1
      counts.set(face.id, count)
    }
  }
  const out = new Map<number, FaceCue[]>()
  for (const [id, count] of counts) {
    if (count.frames < MIN_CUE_FRAMES) continue
    const cues = CUES.filter((cue) => count[cue] / count.frames >= CUE_SHARE)
    if (cues.length) out.set(id, cues)
  }
  return out
}
