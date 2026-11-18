import { describe, expect, it } from 'vitest'
import type { FamilyFaceSamples, FamilyRole } from './visionProfiles'
import { BuddyFaceTracker, findFamilyRole, type FaceObservation } from './visionTracking'

const SIZE = 128

/** Unit vector along one axis, optionally leaning towards a second axis by `mix` (0..1). */
function unit(axis: number, towards = axis, mix = 0) {
  const vector = new Array<number>(SIZE).fill(0)
  vector[axis] = 1 - mix
  if (towards !== axis) vector[towards] = mix
  const norm = Math.hypot(...vector)
  return vector.map((value) => value / norm)
}

describe('findFamilyRole', () => {
  it('matches a turned face through the view enrolled at a similar angle', () => {
    // Axis 0 = mother frontal, axis 1 = mother turned; a turned probe is far from the frontal sample.
    const turnedProbe = unit(1, 0, 0.2)
    const frontalOnly: FamilyFaceSamples = { mother: { front: unit(0) } }
    const multiView: FamilyFaceSamples = { mother: { front: unit(0), left: unit(1) } }
    expect(findFamilyRole(turnedProbe, frontalOnly)).toBeNull()
    expect(findFamilyRole(turnedProbe, multiView)).toBe('mother')
  })

  it('still matches the frontal view', () => {
    const samples: FamilyFaceSamples = { mother: { front: unit(0), left: unit(1), right: unit(2) }, father: { front: unit(5) } }
    expect(findFamilyRole(unit(0, 9, 0.1), samples)).toBe('mother')
    expect(findFamilyRole(unit(5, 9, 0.1), samples)).toBe('father')
  })

  it('refuses a face that is not clearly one person', () => {
    const samples: FamilyFaceSamples = { mother: { front: unit(0) }, father: { front: unit(1) } }
    expect(findFamilyRole(unit(0, 1, 0.5), samples)).toBeNull() // equally close to both
    expect(findFamilyRole(unit(40), samples)).toBeNull() // close to nobody
  })

  it('needs the margin against the best view of the other person, not just their frontal one', () => {
    const samples: FamilyFaceSamples = { mother: { front: unit(0) }, father: { front: unit(5), right: unit(0, 1, 0.1) } }
    expect(findFamilyRole(unit(0), samples)).toBeNull()
  })

  it('ignores stored views of the wrong size', () => {
    expect(findFamilyRole(unit(0), { mother: { front: [1, 0, 0] } })).toBeNull()
  })
})

const FACE: FaceObservation = {
  box: { x: 0.3, y: 0.3, width: 0.2, height: 0.25 },
  smile: 0,
  browLowered: 0,
  jawOpen: 0,
  matchable: true,
}

const lastFrame = new WeakMap<BuddyFaceTracker, number>()

/**
 * Feeds camera frames up to `time` (the face stays tracked only while frames
 * keep coming) and one identity result, like the worker does; returns the
 * role shown for the face.
 */
function step(tracker: BuddyFaceTracker, time: number, result: FamilyRole | null | undefined, face = FACE) {
  for (let frame = (lastFrame.get(tracker) ?? time) + 200; frame < time; frame += 200) tracker.update([face], frame)
  tracker.update([face], time)
  const match = tracker.identifyNext(time)
  if (!match) throw new Error('no check due')
  tracker.confirm(match, result)
  lastFrame.set(tracker, time + 1)
  return tracker.update([face], time + 1)[0].role
}

describe('BuddyFaceTracker identity', () => {
  it('confirms a role after two agreeing checks', () => {
    const tracker = new BuddyFaceTracker()
    expect(step(tracker, 0, 'mother')).toBeNull()
    expect(step(tracker, 600, 'mother')).toBe('mother')
  })

  it('keeps a confirmed role while the head is turned away for a moment', () => {
    const tracker = new BuddyFaceTracker()
    step(tracker, 0, 'mother')
    step(tracker, 600, 'mother')
    expect(step(tracker, 1200, null)).toBe('mother') // compared, matched nobody
    expect(step(tracker, 1800, undefined)).toBe('mother') // no usable crop
    expect(step(tracker, 2400, null)).toBe('mother')
    expect(step(tracker, 3000, 'mother')).toBe('mother') // support again: misses start over
    expect(step(tracker, 3600, null)).toBe('mother')
    expect(step(tracker, 4200, null)).toBe('mother')
  })

  it('drops the role after three unsupported checks in a row', () => {
    const tracker = new BuddyFaceTracker()
    step(tracker, 0, 'mother')
    step(tracker, 600, 'mother')
    step(tracker, 1200, null)
    step(tracker, 1800, null)
    expect(step(tracker, 2400, null)).toBeNull()
  })

  it('drops the role when nothing has supported it for too long', () => {
    const tracker = new BuddyFaceTracker()
    step(tracker, 0, 'mother')
    step(tracker, 600, 'mother')
    let time = 600
    for (let i = 0; i < 12; i++) {
      time += 600
      expect(step(tracker, time, undefined)).toBe('mother')
    }
    expect(step(tracker, 600 + 8600, undefined)).toBeNull()
  })

  it('switches to another person only after two agreeing checks', () => {
    const tracker = new BuddyFaceTracker()
    step(tracker, 0, 'mother')
    step(tracker, 600, 'mother')
    expect(step(tracker, 1200, 'father')).toBe('mother') // one disagreeing check is not enough
    expect(step(tracker, 1800, 'father')).toBe('father')
  })

  it('forgets the role when the face can no longer be matched', () => {
    const tracker = new BuddyFaceTracker()
    step(tracker, 0, 'child')
    step(tracker, 600, 'child')
    expect(tracker.update([{ ...FACE, matchable: false }], 700)[0].role).toBeNull()
    expect(tracker.update([FACE], 800)[0].role).toBeNull()
  })

  it('starts over when the face was out of sight for longer than the tracking gap', () => {
    const tracker = new BuddyFaceTracker()
    step(tracker, 0, 'mother')
    expect(step(tracker, 600, 'mother')).toBe('mother')
    expect(tracker.update([FACE], 601 + 700)[0].role).toBeNull()
  })

  it('shows neither face when two tracked faces claim the same person', () => {
    const tracker = new BuddyFaceTracker()
    const other: FaceObservation = { ...FACE, box: { x: 0.7, y: 0.3, width: 0.2, height: 0.25 } }
    const confirmBoth = (time: number) => {
      tracker.update([FACE, other], time)
      for (let i = 0; i < 2; i++) {
        const match = tracker.identifyNext(time + i)
        if (match) tracker.confirm(match, 'mother')
      }
    }
    confirmBoth(0)
    tracker.update([FACE, other], 300)
    confirmBoth(600)
    expect(tracker.update([FACE, other], 700).map((face) => face.role)).toEqual([null, null])
  })
})
