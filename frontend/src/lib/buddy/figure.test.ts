import { describe, expect, it } from 'vitest'
import { DEFAULT_NEUTRAL, J, buildPuppetTrack, cheerPose, mirrorFrame, plantFeet, type PuppetPose } from '../puppet'
import { DEMO_GUIDES } from '../puppetDemo'
import { BIN_PROPORTIONS, FIGURE_ANKLE_LINE, FIGURE_UNIT, FIGURE_VIEW, HAND_REACH, HEAD_REACH, MAX_FIT, TORSO_ART, fitFigure, neckLift, retargetBinPose } from './figure'

describe('retargetBinPose', () => {
  it('shortens the body and limbs while preserving each bone direction and the source pose', () => {
    const source = cheerPose(DEFAULT_NEUTRAL, .18, true)
    const original = structuredClone(source)
    const compact = retargetBinPose(source)
    for (const [parent, child, scale] of [
      [J.rShoulder, J.rElbow, BIN_PROPORTIONS.arms],
      [J.rElbow, J.rWrist, BIN_PROPORTIONS.arms],
      [J.lShoulder, J.lElbow, BIN_PROPORTIONS.arms],
      [J.lElbow, J.lWrist, BIN_PROPORTIONS.arms],
      [J.rHip, J.rKnee, BIN_PROPORTIONS.legs],
      [J.rKnee, J.rAnkle, BIN_PROPORTIONS.legs],
      [J.lHip, J.lKnee, BIN_PROPORTIONS.legs],
      [J.lKnee, J.lAnkle, BIN_PROPORTIONS.legs],
    ]) {
      expect(compact[child].x - compact[parent].x).toBeCloseTo((source[child].x - source[parent].x) * scale)
      expect(compact[child].y - compact[parent].y).toBeCloseTo((source[child].y - source[parent].y) * scale)
    }
    expect(source).toEqual(original)
    expect(compact).not.toBe(source)
    expect(compact[J.neck].y).toBeCloseTo(source[J.neck].y * BIN_PROPORTIONS.torso)
  })

  it('reduces standing height and supports either mirror direction', () => {
    const compact = retargetBinPose(DEFAULT_NEUTRAL)
    const height = (p: PuppetPose) => (p[J.rShoulder].y + p[J.lShoulder].y) / 2 + HEAD_REACH - ground(p)
    expect(height(compact)).toBeLessThan(height(DEFAULT_NEUTRAL) * .9)
    const mirrored = mirrorFrame(compact)
    retargetBinPose(mirrorFrame(DEFAULT_NEUTRAL)).forEach((point, index) => {
      expect(point.x).toBeCloseTo(mirrored[index].x)
      expect(point.y).toBeCloseTo(mirrored[index].y)
    })
  })

  it('keeps the head and hands inside the frame throughout each exercise demonstration', () => {
    for (const { guide } of DEMO_GUIDES) {
      const track = buildPuppetTrack(guide)
      const floor = ground(retargetBinPose(track.neutral))
      const poses = [track.neutral, ...track.frames, cheerPose(track.neutral, .18, true)]
        .map(pose => plantFeet(retargetBinPose(pose), floor))
      const fit = fitFigure(poses, floor)
      for (const pose of poses) {
        expect(topInView(pose, fit)).toBeLessThanOrEqual(FIGURE_VIEW)
        const half = Math.max(...pose.map(point => Math.abs(point.x) + HAND_REACH))
        expect(half * 2 * fit * FIGURE_UNIT).toBeLessThanOrEqual(FIGURE_VIEW)
      }
    }
  })
})

describe('Bin proportions and neck connection', () => {
  it('uses the arithmetic midpoint of the original and compact proportions', () => {
    expect(BIN_PROPORTIONS.torso).toBeCloseTo((1 + .70) / 2)
    expect(BIN_PROPORTIONS.width).toBeCloseTo((1 + .95) / 2)
    expect(BIN_PROPORTIONS.arms).toBeCloseTo((1 + .68) / 2)
    expect(BIN_PROPORTIONS.legs).toBeCloseTo((1 + .55) / 2)
  })

  it('overlaps the neck with the top of the torso at different body lengths', () => {
    for (const length of [20, 50, 70, 85, 100, 130]) {
      const top = length * (TORSO_ART.shoulderY - TORSO_ART.topY) / (TORSO_ART.hipY - TORSO_ART.shoulderY)
      expect(top - neckLift(length)).toBeCloseTo(2)
    }
  })
})

const ground = (pose: PuppetPose) => Math.min(pose[J.rAnkle].y, pose[J.lAnkle].y)

/** Height of the figure's highest point above the bottom of the view box, in view units, at scale `fit`. */
function topInView(pose: PuppetPose, fit: number) {
  const groundY = ground(pose)
  const shoulders = (pose[J.rShoulder].y + pose[J.lShoulder].y) / 2 - groundY
  const reach = Math.max(shoulders + HEAD_REACH, pose[J.rWrist].y - groundY + HAND_REACH, pose[J.lWrist].y - groundY + HAND_REACH)
  return fit * (reach * FIGURE_UNIT + (FIGURE_VIEW - FIGURE_ANKLE_LINE))
}

/** The default skeleton with legs `factor` times as long (a taller demonstrator). */
function withLegs(factor: number): PuppetPose {
  return DEFAULT_NEUTRAL.map((p, j) => (j === J.rKnee || j === J.lKnee || j === J.rAnkle || j === J.lAnkle ? { x: p.x, y: p.y * factor } : p))
}

describe('fitFigure', () => {
  it('draws the default skeleton at (nearly) full size with the head inside the view', () => {
    const fit = fitFigure([DEFAULT_NEUTRAL], ground(DEFAULT_NEUTRAL))
    expect(fit).toBeGreaterThan(0.95)
    expect(fit).toBeLessThanOrEqual(MAX_FIT)
    expect(topInView(DEFAULT_NEUTRAL, fit)).toBeLessThanOrEqual(FIGURE_VIEW)
  })

  it('shrinks a tall demonstrator so the ears and antenna are not cut off', () => {
    const tall = withLegs(1.3)
    const fit = fitFigure([tall], ground(tall))
    expect(fit).toBeLessThan(fitFigure([DEFAULT_NEUTRAL], ground(DEFAULT_NEUTRAL)))
    expect(topInView(tall, fit)).toBeLessThanOrEqual(FIGURE_VIEW)
  })

  it('takes the highest and widest pose of the whole movement', () => {
    const groundY = ground(DEFAULT_NEUTRAL)
    const armsUp = DEFAULT_NEUTRAL.map((p, j) => (j === J.rWrist || j === J.lWrist ? { x: p.x, y: 2.3 } : p))
    const armsOut = DEFAULT_NEUTRAL.map((p, j) => (j === J.rWrist ? { x: -2, y: 1 } : j === J.lWrist ? { x: 2, y: 1 } : p))
    const neutral = fitFigure([DEFAULT_NEUTRAL], groundY)
    const high = fitFigure([DEFAULT_NEUTRAL, armsUp], groundY)
    const wide = fitFigure([DEFAULT_NEUTRAL, armsOut], groundY)
    expect(high).toBeLessThan(neutral)
    expect(wide).toBeLessThan(neutral)
    expect(topInView(armsUp, high)).toBeLessThanOrEqual(FIGURE_VIEW)
    // Both gloves stay inside the view box.
    expect(2 * wide * (2 + HAND_REACH) * FIGURE_UNIT).toBeLessThanOrEqual(FIGURE_VIEW)
  })

  it('leaves room for the cheer pose of the default skeleton', () => {
    const groundY = ground(DEFAULT_NEUTRAL)
    const cheer = plantFeet(cheerPose(DEFAULT_NEUTRAL, 0.18, true), groundY)
    const fit = fitFigure([DEFAULT_NEUTRAL, cheer], groundY)
    expect(topInView(cheer, fit)).toBeLessThanOrEqual(FIGURE_VIEW)
  })

  it('never enlarges a small demonstrator beyond the cap', () => {
    const small = DEFAULT_NEUTRAL.map((p) => ({ x: p.x * 0.5, y: p.y * 0.5 }))
    expect(fitFigure([small], ground(small))).toBe(MAX_FIT)
  })
})
