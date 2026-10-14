import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { computeGaitFeatures } from '../src/services/gaitFeatures'
import { buildTracks, gaitTrackScore, selectTrack, trackToFrames, type PoseTrack } from '../src/services/poseTracking'
import { exerciseTrackScore, selectExerciseTrack } from '../src/services/imitation'
import { makeWalker, type WalkerOptions } from './syntheticGait'
import { childFrames, getBuiltinSpec } from './syntheticImitation'

/**
 * Gait output recorded BEFORE person tracking moved out of gaitFeatures.ts.
 * Regenerate only deliberately: UPDATE_GAIT_GOLDEN=1 npx tsx --test test/poseTracking.test.ts
 */
const GOLDEN_PATH = path.join(__dirname, 'fixtures', 'gaitGolden.json')

const PRESETS: Array<{ name: string; walker: WalkerOptions | null; fps: number | null; fpsSource?: 'ml' | 'upload' }> = [
  { name: 'side', walker: {}, fps: 30, fpsSource: 'ml' },
  { name: 'side-leftward', walker: { direction: -1 }, fps: 30 },
  { name: 'asymmetric', walker: { leftStepSec: 0.35, rightStepSec: 0.45 }, fps: 30 },
  { name: 'noisy', walker: { noisePx: 2, dropRate: 0.05, seed: 3 }, fps: 30, fpsSource: 'upload' },
  { name: 'extra-person', walker: { extraPerson: true }, fps: 30 },
  { name: 'heel-raise', walker: { heelRaisedPx: 18 }, fps: 30 },
  { name: 'poor-coverage', walker: { dropRate: 0.5, seed: 11 }, fps: 30 },
  { name: 'no-fps', walker: {}, fps: null },
  { name: 'frontal', walker: { view: 'frontal', fps: 25 }, fps: 25 },
  { name: 'frontal-noisy-extra', walker: { view: 'frontal', fps: 25, noisePx: 3, dropRate: 0.1, extraPerson: true, seed: 5 }, fps: 25 },
  { name: 'empty', walker: null, fps: 30 },
]

function computePresets(): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const p of PRESETS) {
    const frames = p.walker ? makeWalker(p.walker) : []
    // JSON round trip: the golden file cannot represent -0 or undefined.
    out[p.name] = JSON.parse(JSON.stringify(computeGaitFeatures({ frames, fps: p.fps, fpsSource: p.fpsSource ?? null })))
  }
  return out
}

describe('gait golden (tracking moved to poseTracking.ts)', () => {
  if (process.env.UPDATE_GAIT_GOLDEN === '1') {
    writeFileSync(GOLDEN_PATH, `${JSON.stringify(computePresets(), null, 2)}\n`)
  }
  const golden = JSON.parse(readFileSync(GOLDEN_PATH, 'utf8')) as Record<string, unknown>
  const actual = computePresets()

  for (const p of PRESETS) {
    it(`computeGaitFeatures is unchanged for preset "${p.name}"`, () => {
      assert.ok(p.name in golden, `missing golden entry ${p.name}`)
      assert.deepStrictEqual(actual[p.name], golden[p.name])
    })
  }
})

function fakeTrack(size: number): PoseTrack {
  const members = new Map()
  for (let i = 0; i < size; i += 1) members.set(i, { person: { person_id: 0, body25: [] }, pose: [] })
  return { lastCenter: { x: 0, y: 0 }, lastFrame: size - 1, scale: 100, members }
}

describe('poseTracking', () => {
  it('selectTrack keeps the earlier track on ties and returns null without tracks', () => {
    const a = fakeTrack(10)
    const b = fakeTrack(10)
    assert.equal(selectTrack([a, b], (t) => t.members.size), a)
    const c = fakeTrack(11)
    assert.equal(selectTrack([a, b, c], (t) => t.members.size), c)
    assert.equal(selectTrack([], (t) => t.members.size), null)
  })

  it('links one walker into one track and maps it back to frames', () => {
    const frames = makeWalker({ durationSec: 2 })
    const tracks = buildTracks(frames)
    assert.equal(tracks.length, 1)
    const chosen = selectTrack(tracks, gaitTrackScore)
    const tracked = trackToFrames(chosen, frames.length)
    assert.equal(tracked.length, frames.length)
    assert.ok(tracked.every((t) => t !== null && t.pose.length === 25))
    assert.deepEqual(trackToFrames(null, 3), [null, null, null])
  })

  it('gait scorer prefers the walking child over a still, more confident adult', () => {
    const frames = makeWalker({ extraPerson: true, durationSec: 2 })
    const tracks = buildTracks(frames)
    assert.equal(tracks.length, 2)
    const chosen = selectTrack(tracks, gaitTrackScore) as PoseTrack
    // The adult stands at x ≈ 1700; the walker starts at x = 300.
    assert.ok(chosen.lastCenter.x < 1000)
  })
})

describe('exerciseTrackScore', () => {
  const spec = getBuiltinSpec('dang-tay')

  it('selects the moving child over a still, higher-confidence adult at the frame edge', () => {
    const frames = childFrames(spec, { extraPerson: 'still' })
    // The adult is listed first in every frame and is the more confident one.
    assert.equal(frames[0].people[0].person_id, 1)
    const tracks = buildTracks(frames)
    const adult = tracks.find((t) => t.lastCenter.x > 700) as PoseTrack
    assert.ok(adult && adult.members.size === frames.length, 'the adult is tracked in every frame')
    const selection = selectExerciseTrack(frames, { width: 960, height: 540 })
    assert.ok(selection.track)
    assert.ok((selection.track as PoseTrack).lastCenter.x < 700, 'child stands left of the adult')
    assert.ok(selection.coverage > 0.9, `coverage ${selection.coverage}`)
    assert.ok(exerciseTrackScore(selection.track as PoseTrack, frames.length) > 1.5 * exerciseTrackScore(adult, frames.length))
    assert.equal(selection.multiPerson, false)
  })

  it('reports MULTI_PERSON when two people move', () => {
    const frames = childFrames(spec, { extraPerson: 'moving' })
    const selection = selectExerciseTrack(frames, { width: 960, height: 540 })
    assert.ok(selection.track)
    assert.equal(selection.multiPerson, true)
  })

  it('scores coverage times limb motion', () => {
    const frames = childFrames(spec, {})
    const [track] = buildTracks(frames)
    const full = exerciseTrackScore(track, frames.length)
    const half = exerciseTrackScore(track, frames.length * 2)
    assert.ok(Math.abs(full - 2 * half) < 1e-9)
    assert.ok(full > 1.5, `moving arms give limb motion > 0.5 (score ${full})`)
  })

  it('breaks near-ties by distance to the frame centre when the video size is known', () => {
    const left = childFrames(spec, { centerX: 250, seed: 1 })
    const right = childFrames(spec, { centerX: 520, seed: 2 })
    const merged = left.map((f, i) => ({ frame_index: i, people: [...f.people, ...right[i].people] }))
    const tracks = buildTracks(merged).filter((t) => t.members.size > merged.length / 2)
    assert.equal(tracks.length, 2)
    const [a, b] = tracks.map((t) => exerciseTrackScore(t, merged.length))
    assert.ok(Math.abs(a - b) <= 0.05 * Math.max(a, b), `near-tie expected (${a} vs ${b})`)
    const withSize = selectExerciseTrack(merged, { width: 960, height: 540 })
    assert.ok(withSize.track && Math.abs(withSize.track.lastCenter.x - 520) < 60, 'nearer the centre wins')
    // Both move, so the other one is reported.
    assert.equal(withSize.multiPerson, true)
  })
})
