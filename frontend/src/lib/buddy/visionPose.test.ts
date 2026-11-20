import { describe, expect, it } from 'vitest'
import { FACE_POSE, classifyFaceView, headPose, type Point } from './visionPose'

/** The five alignment points on MediaPipe's canonical face (cm; x right, y up, z towards the camera). */
const CANONICAL: [number, number, number][] = [
  [-3.151, 2.625, 3.466], // eye centre
  [3.151, 2.625, 3.466], // eye centre
  [0, -1.127, 7.476], // nose tip
  [-2.456, -4.343, 4.284], // mouth corner
  [2.456, -4.343, 4.284], // mouth corner
]

const rad = (deg: number) => (deg * Math.PI) / 180

/**
 * Projects the face after turning it (yaw, positive = nose to the image right),
 * nodding it (pitch, positive = looking down) and rolling it in the image plane.
 */
function project({ yaw = 0, pitch = 0, roll = 0, scale = 12, shift = { x: 320, y: 240 } } = {}): Point[] {
  const points = CANONICAL.map(([x, y, z]) => {
    const y1 = y * Math.cos(rad(pitch)) - z * Math.sin(rad(pitch))
    const z1 = y * Math.sin(rad(pitch)) + z * Math.cos(rad(pitch))
    const x2 = x * Math.cos(rad(yaw)) + z1 * Math.sin(rad(yaw))
    const u = x2
    const v = -y1 // image y grows downwards
    return {
      x: shift.x + scale * (u * Math.cos(rad(roll)) - v * Math.sin(rad(roll))),
      y: shift.y + scale * (u * Math.sin(rad(roll)) + v * Math.cos(rad(roll))),
    }
  })
  // The worker orders eyes and mouth corners by x.
  const [eyeA, eyeB, nose, mouthA, mouthB] = points
  return [...[eyeA, eyeB].sort((a, b) => a.x - b.x), nose, ...[mouthA, mouthB].sort((a, b) => a.x - b.x)]
}

const poseOf = (options?: Parameters<typeof project>[0]) => {
  const pose = headPose(project(options))
  if (!pose) throw new Error('no pose')
  return pose
}

describe('headPose', () => {
  it('is centred for a level, frontal face', () => {
    const pose = poseOf()
    expect(pose.yaw).toBeCloseTo(0, 5)
    expect(pose.pitch).toBeCloseTo(0.538, 2)
  })

  it('grows with the turn of the head, about 0.64 * tan(angle)', () => {
    expect(poseOf({ yaw: 10 }).yaw).toBeCloseTo(0.636 * Math.tan(rad(10)), 2)
    expect(poseOf({ yaw: 20 }).yaw).toBeCloseTo(0.636 * Math.tan(rad(20)), 2)
    expect(poseOf({ yaw: -20 }).yaw).toBeCloseTo(-0.636 * Math.tan(rad(20)), 2)
  })

  it('moves with a nod: smaller when looking up, larger when looking down', () => {
    expect(poseOf({ pitch: -15 }).pitch).toBeLessThan(poseOf().pitch - 0.1)
    expect(poseOf({ pitch: 15 }).pitch).toBeGreaterThan(poseOf().pitch + 0.1)
  })

  it('does not depend on face size, position or sideways tilt of the head', () => {
    const base = poseOf({ yaw: 18, pitch: 8 })
    for (const variant of [{ scale: 30 }, { shift: { x: 50, y: 400 } }, { roll: 20 }, { roll: -25 }]) {
      const pose = poseOf({ yaw: 18, pitch: 8, ...variant })
      expect(pose.yaw).toBeCloseTo(base.yaw, 5)
      expect(pose.pitch).toBeCloseTo(base.pitch, 5)
    }
  })

  it('rejects degenerate points', () => {
    const [eye, , nose, mouthA, mouthB] = project()
    expect(headPose([eye, eye, nose, mouthA, mouthB])).toBeNull()
    expect(headPose([...project().slice(0, 3), project()[0], project()[1]])).toBeNull()
  })
})

describe('classifyFaceView', () => {
  const neutral = poseOf().pitch

  it('only recognises the frontal view before a frontal sample exists', () => {
    expect(classifyFaceView(poseOf(), null)).toBe('front')
    expect(classifyFaceView(poseOf({ yaw: 5 }), null)).toBe('front')
    expect(classifyFaceView(poseOf({ yaw: 20 }), null)).toBeNull()
    expect(classifyFaceView(poseOf({ pitch: 30 }), null)).toBeNull()
  })

  it('accepts a camera that sits a little above or below the face as frontal', () => {
    expect(classifyFaceView(poseOf({ pitch: 10 }), null)).toBe('front')
    expect(classifyFaceView(poseOf({ pitch: -10 }), null)).toBe('front')
    expect(classifyFaceView(poseOf({ pitch: 15 }), null)).toBe('front')
    expect(classifyFaceView(poseOf({ pitch: -15 }), null)).toBe('front')
    expect(classifyFaceView(poseOf({ yaw: 10 }), null)).toBe('front')
    expect(classifyFaceView(poseOf({ yaw: -10 }), null)).toBe('front')
  })

  it('names slight turns by the side of the image the nose points to', () => {
    expect(classifyFaceView(poseOf({ yaw: -20 }), neutral)).toBe('left')
    expect(classifyFaceView(poseOf({ yaw: 20 }), neutral)).toBe('right')
    expect(classifyFaceView(poseOf({ yaw: 15 }), neutral)).toBe('right')
    expect(classifyFaceView(poseOf({ yaw: 26 }), neutral)).toBe('right')
  })

  it('names slight nods relative to the frontal sample', () => {
    expect(classifyFaceView(poseOf({ pitch: -15 }), neutral)).toBe('up')
    expect(classifyFaceView(poseOf({ pitch: 15 }), neutral)).toBe('down')
    // A person whose level pose reads lower (camera below the face) is still judged against their own baseline.
    const low = poseOf({ pitch: -8 }).pitch
    expect(classifyFaceView(poseOf({ pitch: -8 }), low)).toBe('front')
    expect(classifyFaceView(poseOf({ pitch: 7 }), low)).toBe('down')
  })

  it('leaves gaps between views and refuses large angles', () => {
    expect(classifyFaceView(poseOf({ yaw: 11 }), neutral)).toBeNull() // between front and side
    expect(classifyFaceView(poseOf({ yaw: 40 }), neutral)).toBeNull() // turned too far
    expect(classifyFaceView(poseOf({ pitch: 35 }), neutral)).toBeNull() // nodded too far
    expect(classifyFaceView(poseOf({ yaw: 20, pitch: 20 }), neutral)).toBeNull() // turned and nodded
  })

  it('keeps the recognition limit wider than the widest enrolled view', () => {
    expect(FACE_POSE.matchYaw).toBeGreaterThan(FACE_POSE.sideYawMax)
  })
})
