/**
 * Geometry of the whole-body Bin (components/buddy/BuddyFigure): the view box
 * and how big the figure is drawn in it. Kept apart from the component so the
 * fitting rule can be unit tested.
 */
import { J, type PuppetPose } from '../puppet'

/** Side of the square view box. */
export const FIGURE_VIEW = 440
/** View units per torso length of the skeleton, before fitting. */
export const FIGURE_UNIT = 100
/** Height of a standing ankle; the boots and the shadow sit below it. */
export const FIGURE_ANKLE_LINE = FIGURE_VIEW - 44

/** The head keeps Bin's look but is smaller than in the chat portrait, so raised arms do not hide the face. */
export const HEAD_SCALE = 0.46
/** Distance from the shoulder line up to the base of the neck drawing. */
export const HEAD_LIFT = 24
/** Head drawing (BuddyParts, character units): where the neck starts, the helmet centre, the ear tips above it. */
export const HEAD_ART = { centreX: 200, neckBaseY: 262, centreY: 151, earTipAboveCentre: 155 }

/** How far the head (ear tips) reaches above the shoulder line, and a glove beyond its wrist, in torso lengths. */
export const HEAD_REACH = (HEAD_LIFT + (HEAD_ART.neckBaseY - HEAD_ART.centreY + HEAD_ART.earTipAboveCentre) * HEAD_SCALE) / FIGURE_UNIT
export const HAND_REACH = 0.42
/** Narrowest half width kept free (the cheer and shrug poses spread the arms this far). */
const MIN_HALF_WIDTH = 1.45
/** Never drawn larger than this, however small the demonstrator. */
export const MAX_FIT = 1.1

/**
 * Scale (≤ MAX_FIT) at which every one of `poses` fits the view: a tall
 * demonstrator, raised arms or a wide stance shrink the whole figure a little
 * instead of being cut off at the edge. Poses are as given to `setPose`
 * (torso lengths, y up, feet planted on `groundY`).
 */
export function fitFigure(poses: PuppetPose[], groundY: number): number {
  let top = 0
  let half = MIN_HALF_WIDTH
  for (const pose of poses) {
    const shoulders = (pose[J.rShoulder].y + pose[J.lShoulder].y) / 2 - groundY
    top = Math.max(top, shoulders + HEAD_REACH, pose[J.rWrist].y - groundY + HAND_REACH, pose[J.lWrist].y - groundY + HAND_REACH)
    for (const p of pose) half = Math.max(half, Math.abs(p.x) + HAND_REACH)
  }
  const height = top + (FIGURE_VIEW - FIGURE_ANKLE_LINE) / FIGURE_UNIT + 0.1
  const width = 2 * half + 0.1
  return Math.min(MAX_FIT, FIGURE_VIEW / FIGURE_UNIT / Math.max(height, width))
}
