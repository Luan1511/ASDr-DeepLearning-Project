import { FaceLandmarker, type FaceLandmarkerResult, type NormalizedLandmark } from '@mediapipe/tasks-vision'
import visionLoader from '../../../node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_module_internal.js?url'
import visionWasm from '../../../node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_module_internal.wasm?url'
import type { VisionRequest, VisionResponse } from './visionProtocol'
import { BuddyFaceTracker, findFamilyRole, type FaceObservation } from './visionTracking'

const MAX_FACES = 4
const INPUT_SIZE = 112
const tracker = new BuddyFaceTracker()
const asset = (url: string) => new URL(url, self.location.origin).href
const modelRoot = asset(import.meta.env.BASE_URL + 'buddy-vision/')
let landmarks: FaceLandmarker
let recognizer: Worker | undefined
let identifying = false
let aligned: OffscreenCanvasRenderingContext2D
let lastTimestamp = -1

async function init() {
  const files = {
    wasmLoaderPath: asset(visionLoader),
    wasmBinaryPath: asset(visionWasm),
  }
  landmarks = await FaceLandmarker.createFromOptions(files, {
    baseOptions: { modelAssetPath: modelRoot + 'face_landmarker.task' },
    canvas: new OffscreenCanvas(1, 1),
    runningMode: 'VIDEO',
    numFaces: MAX_FACES,
    outputFaceBlendshapes: true,
    minFaceDetectionConfidence: 0.6,
    minFacePresenceConfidence: 0.65,
  })
  const context = new OffscreenCanvas(INPUT_SIZE, INPUT_SIZE).getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('vision-canvas-error')
  aligned = context
}

function detect(frame: ImageBitmap, timestamp: number) {
  lastTimestamp = Math.max(timestamp, lastTimestamp + 1)
  return landmarks.detectForVideo(frame, lastTimestamp)
}

function observation(result: FaceLandmarkerResult, index: number, frame: ImageBitmap): FaceObservation {
  const points = result.faceLandmarks[index]
  const x = Math.max(0, Math.min(...points.map((point) => point.x)))
  const y = Math.max(0, Math.min(...points.map((point) => point.y)))
  const right = Math.min(1, Math.max(...points.map((point) => point.x)))
  const bottom = Math.min(1, Math.max(...points.map((point) => point.y)))
  const box = { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) }
  const scores = new Map(result.faceBlendshapes[index]?.categories.map(({ categoryName, score }) => [categoryName, score]))
  const bilateral = (left: string, right: string) => ((scores.get(left) ?? 0) + (scores.get(right) ?? 0)) / 2
  return {
    box,
    matchable: box.width * frame.width >= 52 && box.height * frame.height >= 55 && x > 0 && y > 0 && right < 1 && bottom < 1,
    smile: bilateral('mouthSmileLeft', 'mouthSmileRight'),
    browLowered: bilateral('browDownLeft', 'browDownRight'),
    jawOpen: scores.get('jawOpen') ?? 0,
  }
}

type Point = { x: number; y: number }
const CANONICAL: Point[] = [
  { x: 38.2946, y: 51.6963 }, { x: 73.5318, y: 51.5014 },
  { x: 56.0252, y: 71.7366 },
  { x: 41.5493, y: 92.3655 }, { x: 70.7299, y: 92.2041 },
]

function center(points: Point[]) {
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  }
}

// The five-point similarity transform matches the 112×112 crop expected by SFace.
function transform(points: Point[]) {
  const from = center(points)
  const to = center(CANONICAL)
  let dot = 0
  let cross = 0
  let norm = 0
  for (const [index, point] of points.entries()) {
    const px = point.x - from.x
    const py = point.y - from.y
    const qx = CANONICAL[index].x - to.x
    const qy = CANONICAL[index].y - to.y
    dot += px * qx + py * qy
    cross += px * qy - py * qx
    norm += px ** 2 + py ** 2
  }
  const a = dot / norm
  const b = cross / norm
  return new DOMMatrix([a, b, -b, a, to.x - a * from.x + b * from.y, to.y - b * from.x - a * from.y])
}

function facePoints(points: NormalizedLandmark[], frame: ImageBitmap) {
  const inPixels = (index: number) => ({ x: points[index].x * frame.width, y: points[index].y * frame.height })
  // Use lid corners rather than iris positions so glances do not move the crop.
  const eyes = [center([inPixels(33), inPixels(133)]), center([inPixels(362), inPixels(263)])].sort((a, b) => a.x - b.x)
  const mouth = [inPixels(61), inPixels(291)].sort((a, b) => a.x - b.x)
  const nose = inPixels(1)
  const eyeDistance = Math.hypot(eyes[1].x - eyes[0].x, eyes[1].y - eyes[0].y)
  const eyeCenter = center(eyes)
  if (eyeDistance < 24 || Math.abs(nose.x - eyeCenter.x) > eyeDistance * 0.34) return null
  return [...eyes, nose, ...mouth]
}

async function embedding(frame: ImageBitmap, points: NormalizedLandmark[]) {
  const source = facePoints(points, frame)
  if (!source) return null
  aligned.resetTransform()
  aligned.fillStyle = 'black'
  aligned.fillRect(0, 0, INPUT_SIZE, INPUT_SIZE)
  aligned.setTransform(transform(source))
  aligned.drawImage(frame, 0, 0)
  const rgba = aligned.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE).data
  const size = INPUT_SIZE * INPUT_SIZE
  const rgb = new Float32Array(size * 3)
  for (let index = 0; index < size; index++) {
    rgb[index] = rgba[index * 4]
    rgb[index + size] = rgba[index * 4 + 1]
    rgb[index + size * 2] = rgba[index * 4 + 2]
  }
  const worker = recognizer ??= new Worker(new URL('./visionRecognition.worker.ts', import.meta.url), { type: 'module' })
  return new Promise<number[] | null>((resolve) => {
    const finish = (value: number[] | null) => {
      clearTimeout(timeout)
      worker.onmessage = null
      worker.onerror = null
      resolve(value)
    }
    const reset = () => {
      worker.terminate()
      recognizer = undefined
      finish(null)
    }
    const timeout = setTimeout(reset, 15_000)
    worker.onmessage = ({ data }: MessageEvent<number[] | null>) => finish(data)
    worker.onerror = reset
    worker.postMessage(rgb, [rgb.buffer])
  })
}

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<VisionRequest>) => void) | null
  postMessage: (response: VisionResponse) => void
}

scope.onmessage = async ({ data }) => {
  try {
    if (data.type === 'init') {
      await init()
      scope.postMessage({ id: data.id, type: 'init', value: undefined })
    } else if (data.type === 'analyze') {
      const { frame, samples, timestamp } = data
      const result = detect(frame, timestamp)
      const faces = result.faceLandmarks.map((_, index) => observation(result, index, frame))
      const value = tracker.update(faces, timestamp)
      scope.postMessage({ id: data.id, type: 'analyze', value })
      if (!identifying && samples && Object.keys(samples).length) {
        const match = tracker.identifyNext(timestamp)
        if (match) {
          identifying = true
          // Extract pixels before closing the frame. Inference runs in a second worker.
          void embedding(frame, result.faceLandmarks[match.index])
            .then((value) => tracker.confirm(match, value ? findFamilyRole(value, samples) : null))
            .catch(() => tracker.confirm(match, null))
            .finally(() => { identifying = false })
        }
      }
    } else {
      if (identifying) throw new Error('vision-busy')
      const { frame } = data
      const result = detect(frame, performance.now())
      if (result.faceLandmarks.length !== 1) throw new Error('face-count')
      if (!observation(result, 0, frame).matchable) throw new Error('face-quality')
      const value = await embedding(frame, result.faceLandmarks[0])
      if (!value) throw new Error('face-quality')
      scope.postMessage({ id: data.id, type: 'capture', value })
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    const visibleError = message === 'face-count' || message === 'face-quality' ? message : 'vision-processing-error'
    scope.postMessage({ id: data.id, type: 'error', error: visibleError })
  } finally {
    if ('frame' in data) data.frame.close()
  }
}
