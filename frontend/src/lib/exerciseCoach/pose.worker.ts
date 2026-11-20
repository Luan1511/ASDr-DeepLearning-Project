import { PoseLandmarker } from '@mediapipe/tasks-vision'
import loader from '../../../node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_module_internal.js?url'
import wasm from '../../../node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_module_internal.wasm?url'
import { LiveRules, measurePose, outOfFrame, type CoachEvent } from './rules'
import type { MovementProfile } from '../exerciseTypes'

/**
 * Pose estimation for the live coach, off the main thread. Frames come from
 * the camera preview and never leave this worker: only the coaching event
 * (a reminder, a praise or nothing) goes back.
 */
export type CoachRequest =
  | { type: 'init'; profile: MovementProfile }
  | { type: 'frame'; frame: ImageBitmap; time: number }
export type CoachResponse =
  | { type: 'ready' | 'error' }
  | { type: 'result'; event: CoachEvent; time: number }

const send = (data: CoachResponse) => self.postMessage(data)
const asset = (url: string) => new URL(url, self.location.origin).href
let detector: PoseLandmarker
let rules: LiveRules

self.onmessage = async ({ data }: MessageEvent<CoachRequest>) => {
  if (data.type === 'init') {
    try {
      rules = new LiveRules(data.profile)
      detector = await PoseLandmarker.createFromOptions(
        { wasmLoaderPath: asset(loader), wasmBinaryPath: asset(wasm) },
        {
          baseOptions: { modelAssetPath: asset(import.meta.env.BASE_URL + 'exercise-coach/pose_landmarker_lite.task') },
          canvas: new OffscreenCanvas(1, 1),
          runningMode: 'VIDEO',
          // Two, so that a second person in the picture is noticed (and nothing is said then).
          numPoses: 2,
        },
      )
      send({ type: 'ready' })
    } catch {
      send({ type: 'error' })
    }
    return
  }

  const { frame, time } = data
  try {
    const { landmarks } = detector.detectForVideo(frame, time)
    const pose = landmarks.length === 1 ? measurePose(landmarks[0], frame.width, frame.height) : null
    // Only one person and part of the body cut off: the child may be asked to step back.
    const cutOff = !pose && landmarks.length === 1 && outOfFrame(landmarks[0])
    send({ type: 'result', event: rules.update(pose, time, cutOff), time })
  } catch {
    send({ type: 'error' })
  } finally {
    frame.close()
  }
}
