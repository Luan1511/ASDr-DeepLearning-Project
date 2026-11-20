import { describe, expect, it } from 'vitest'
import {
  enrollmentQuality, poseHint, PROBE_NOTICES, viewsToCapture, toFaceTemplate,
} from './faceEnrollment'
import { classifyFaceView } from './visionPose'

describe('face enrollment guidance', () => {
  const box = { x: .35, y: .2, width: .3, height: .5 }

  it('distinguishes a small face from a clipped face', () => {
    expect(enrollmentQuality(box, 60, 640, 480)).toBeNull()
    expect(enrollmentQuality({ ...box, width: .05 }, 60, 640, 480)).toBe('too-small')
    expect(enrollmentQuality(box, 20, 640, 480)).toBe('too-small')
    expect(enrollmentQuality({ ...box, x: 0 }, 60, 640, 480)).toBe('out-of-frame')
    expect(enrollmentQuality({ ...box, x: .8 }, 60, 640, 480)).toBe('out-of-frame')
    expect(PROBE_NOTICES['embedding-failed']).toContain('Bộ nhận diện')
  })

  it('gives a direction for each reason the initial pose was refused', () => {
    expect(poseHint({ yaw: .2, pitch: .54 }, null)).toContain('giữa màn hình')
    expect(poseHint({ yaw: 0, pitch: .2 }, null)).toContain('Hạ cằm')
    expect(poseHint({ yaw: 0, pitch: .9 }, null)).toContain('Ngẩng mặt')
    expect(classifyFaceView({ yaw: .1, pitch: .78 }, null)).toBe('front')
    expect(poseHint({ yaw: .5, pitch: .54 }, .54)).toContain('hơi nhiều')
    expect(poseHint({ yaw: 0, pitch: 1 }, .54)).toContain('nhẹ thôi')
  })

  it('waits for the same pose twice and allows finishing with only a frontal sample', () => {
    expect(viewsToCapture({}, null)).toEqual([])
    expect(viewsToCapture({}, 'front')).toEqual(['front'])
    const front = Array(128).fill(.1)
    expect(viewsToCapture({ front }, 'front')).toEqual([])
    expect(toFaceTemplate({ front })).toEqual({ front })
    expect(toFaceTemplate({ left: front })).toBeNull()
  })
})
