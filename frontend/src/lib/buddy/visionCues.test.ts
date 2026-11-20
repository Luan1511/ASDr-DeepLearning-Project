import { describe, expect, it } from 'vitest'
import { MIN_CUE_FRAMES, turnCues, type CueFrame } from './visionCues'
import type { FaceCue } from './visionTracking'

/** One frame every 125 ms; `cues[i]` is the cue of face `id` in frame i. */
function track(id: number, cues: Array<FaceCue | null>, start = 0): CueFrame[] {
  return cues.map((cue, i) => ({ time: start + i * 125, faces: [{ id, cue }] }))
}

describe('turnCues', () => {
  it('keeps a smile seen early in the turn even if the last frame is neutral', () => {
    const frames = track(1, ['smile', 'smile', 'smile', null, null, null, null, null])
    expect(turnCues(frames, 0, 1000).get(1)).toEqual(['smile'])
  })

  it('ignores a single noisy frame', () => {
    const frames = track(1, [null, null, null, null, null, null, null, 'brow_lowered'])
    expect(turnCues(frames, 0, 1000).has(1)).toBe(false)
  })

  it('can report both cues when each lasts long enough', () => {
    const frames = track(1, ['smile', 'smile', 'smile', 'brow_lowered', 'brow_lowered', 'brow_lowered', null, null])
    expect(turnCues(frames, 0, 1000).get(1)).toEqual(['smile', 'brow_lowered'])
  })

  it('says nothing about a face seen in too few frames', () => {
    const frames = track(1, Array<FaceCue>(MIN_CUE_FRAMES - 1).fill('smile'))
    expect(turnCues(frames, 0, 1000).size).toBe(0)
  })

  it('only counts frames inside the turn and keeps faces apart', () => {
    const before = track(1, ['smile', 'smile', 'smile', 'smile'], -2000)
    const during = [...track(1, [null, null, null, null]), ...track(2, ['brow_lowered', 'brow_lowered', null, null])]
    const result = turnCues([...before, ...during], 0, 1000)
    expect(result.has(1)).toBe(false)
    expect(result.get(2)).toEqual(['brow_lowered'])
  })
})
