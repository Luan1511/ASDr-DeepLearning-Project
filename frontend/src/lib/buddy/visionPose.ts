/**
 * Head pose from the five face points SFace alignment already uses (two eye
 * centres, nose tip, two mouth corners), in image pixels.
 *
 * Both numbers are ratios, so they do not depend on how large the face is, and
 * they are measured along the eye line, so tilting the head sideways (roll)
 * does not change them:
 *   yaw   = sideways offset of the nose tip from the middle of the eyes,
 *           divided by the eye distance. With the proportions of MediaPipe's
 *           canonical face this is about 0.64 * tan(yaw angle): 0.11 ≈ 10°,
 *           0.23 ≈ 20°, 0.34 ≈ 28°. Negative = nose towards the left of the image.
 *   pitch = how far down the nose tip sits between the eye line (0) and the
 *           mouth line (1). About 0.54 for a level head, smaller when looking
 *           up, larger when looking down (≈ ±0.13 for 15°). The level value
 *           differs between people and camera heights, so tilt is always
 *           judged against the frontal sample of the same person.
 */
import type { FaceView } from './visionProfiles'

export type Point = { x: number; y: number }
export type HeadPose = { yaw: number; pitch: number }

export const FACE_POSE = Object.freeze({
  /** Frontal sample: nose within ≈ 8° of centre. */
  frontYaw: 0.09,
  /** Level-head range accepted for the first (frontal) sample. */
  neutralPitchMin: 0.36,
  neutralPitchMax: 0.72,
  /** Later frontal checks: within ≈ 6° of the frontal sample's tilt. */
  frontTilt: 0.06,
  /** Side samples: ≈ 13°–28° of turn, without much tilt. */
  sideYawMin: 0.15,
  sideYawMax: 0.34,
  sideTilt: 0.12,
  /** Up/down samples: ≈ 10°–25° of tilt, without much turn. */
  tiltMin: 0.09,
  tiltMax: 0.24,
  tiltYaw: 0.12,
  /** While recognising: beyond ≈ 32° of turn the aligned crop is not trusted. */
  matchYaw: 0.4,
})

export function headPose([eyeA, eyeB, nose, mouthA, mouthB]: Point[]): HeadPose | null {
  const eyeDistance = Math.hypot(eyeB.x - eyeA.x, eyeB.y - eyeA.y)
  if (!(eyeDistance > 0)) return null
  const axis = { x: (eyeB.x - eyeA.x) / eyeDistance, y: (eyeB.y - eyeA.y) / eyeDistance }
  const down = { x: -axis.y, y: axis.x }
  const eyeMid = { x: (eyeA.x + eyeB.x) / 2, y: (eyeA.y + eyeB.y) / 2 }
  const toNose = { x: nose.x - eyeMid.x, y: nose.y - eyeMid.y }
  const toMouth = { x: (mouthA.x + mouthB.x) / 2 - eyeMid.x, y: (mouthA.y + mouthB.y) / 2 - eyeMid.y }
  const eyeToMouth = toMouth.x * down.x + toMouth.y * down.y
  if (!(eyeToMouth > 0)) return null
  return {
    yaw: (toNose.x * axis.x + toNose.y * axis.y) / eyeDistance,
    pitch: (toNose.x * down.x + toNose.y * down.y) / eyeToMouth,
  }
}

/**
 * Which enrolment view a pose belongs to, or null when it falls between views
 * or is turned too far. `neutralPitch` is the pitch of the frontal sample;
 * until that exists only the frontal view can be recognised.
 */
export function classifyFaceView(pose: HeadPose, neutralPitch: number | null): FaceView | null {
  const yaw = Math.abs(pose.yaw)
  if (neutralPitch === null) {
    const level = pose.pitch >= FACE_POSE.neutralPitchMin && pose.pitch <= FACE_POSE.neutralPitchMax
    return yaw <= FACE_POSE.frontYaw && level ? 'front' : null
  }
  const tilt = pose.pitch - neutralPitch
  const tilted = Math.abs(tilt)
  if (yaw <= FACE_POSE.frontYaw && tilted <= FACE_POSE.frontTilt) return 'front'
  if (yaw >= FACE_POSE.sideYawMin && yaw <= FACE_POSE.sideYawMax && tilted <= FACE_POSE.sideTilt) {
    return pose.yaw < 0 ? 'left' : 'right'
  }
  if (yaw <= FACE_POSE.tiltYaw && tilted >= FACE_POSE.tiltMin && tilted <= FACE_POSE.tiltMax) {
    return tilt < 0 ? 'up' : 'down'
  }
  return null
}
