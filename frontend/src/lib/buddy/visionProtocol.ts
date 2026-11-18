import type { EnrollProbe } from './faceEnrollment'
import type { FaceView, FamilyFaceSamples } from './visionProfiles'
import type { BuddyFace } from './visionTracking'

export type VisionRequest =
  | { id: number; type: 'init' }
  | { id: number; type: 'analyze'; frame: ImageBitmap; timestamp: number; samples?: FamilyFaceSamples }
  /** One look during enrolment: embed the face only if its view is in `capture`. */
  | { id: number; type: 'enroll'; frame: ImageBitmap; capture: FaceView[]; neutralPitch: number | null }

export type VisionResponse =
  | { id: number; type: 'init'; value: undefined }
  | { id: number; type: 'analyze'; value: BuddyFace[] }
  | { id: number; type: 'enroll'; value: EnrollProbe }
  | { id: number; type: 'error'; error: string }
