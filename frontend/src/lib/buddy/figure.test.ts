import { describe, expect, it } from 'vitest'
import { DEFAULT_NEUTRAL, J, cheerPose, plantFeet, type PuppetPose } from '../puppet'
import { FIGURE_ANKLE_LINE, FIGURE_UNIT, FIGURE_VIEW, HAND_REACH, HEAD_REACH, MAX_FIT, fitFigure } from './figure'

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
