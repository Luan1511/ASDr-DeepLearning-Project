import type { FamilyFaceSamples } from './visionProfiles'
import type { BuddyFace } from './visionTracking'

export type VisionRequest =
  | { id: number; type: 'init' }
  | { id: number; type: 'analyze'; frame: ImageBitmap; timestamp: number; samples?: FamilyFaceSamples }
  | { id: number; type: 'capture'; frame: ImageBitmap }

export type VisionResponse =
  | { id: number; type: 'init'; value: undefined }
  | { id: number; type: 'analyze'; value: BuddyFace[] }
  | { id: number; type: 'capture'; value: number[] }
  | { id: number; type: 'error'; error: string }
