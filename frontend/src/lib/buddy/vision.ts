import type { FamilyFaceSamples } from './visionProfiles'
import type { VisionRequest, VisionResponse } from './visionProtocol'
import type { BuddyFace } from './visionTracking'

export type { BuddyFace } from './visionTracking'

export type BuddyVision = {
  analyze(video: HTMLVideoElement, timestamp: number, samples?: FamilyFaceSamples): Promise<BuddyFace[]>
  capture(video: HTMLVideoElement): Promise<number[]>
  close(): Promise<void>
}

type RequestPayload =
  | { type: 'init' }
  | { type: 'analyze'; frame: ImageBitmap; timestamp: number; samples?: FamilyFaceSamples }
  | { type: 'capture'; frame: ImageBitmap }
type ResponseValues = { init: undefined; analyze: BuddyFace[]; capture: number[] }

export async function createBuddyVision(): Promise<BuddyVision> {
  const worker = new Worker(new URL('./vision.worker.ts', import.meta.url), { type: 'module' })
  let closed = false
  let processingFrame = false
  let nextId = 0
  const pending = new Map<number, { resolve: (value: VisionResponse) => void; reject: (error: Error) => void }>()
  const stop = (reason: string) => {
    if (closed) return
    closed = true
    worker.terminate()
    for (const { reject } of pending.values()) reject(new Error(reason))
    pending.clear()
  }

  worker.onmessage = ({ data }: MessageEvent<VisionResponse>) => {
    const request = pending.get(data.id)
    if (!request) return
    pending.delete(data.id)
    if (data.type === 'error') request.reject(new Error(data.error))
    else request.resolve(data)
  }
  worker.onerror = () => stop('vision-worker-error')
  worker.onmessageerror = () => stop('vision-worker-error')

  async function send<T extends RequestPayload>(payload: T): Promise<ResponseValues[T['type']]> {
    if (closed) throw new Error('vision-closed')
    const id = nextId++
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      const result = await new Promise<VisionResponse>((resolve, reject) => {
        pending.set(id, { resolve, reject })
        timeout = setTimeout(() => stop('vision-timeout'), 30_000)
        worker.postMessage({ id, ...payload } satisfies VisionRequest, 'frame' in payload ? [payload.frame] : [])
      })
      if (result.type === 'error' || result.type !== payload.type) throw new Error('vision-worker-error')
      return result.value as ResponseValues[T['type']]
    } finally {
      clearTimeout(timeout)
      pending.delete(id)
    }
  }

  async function withFrame<T>(video: HTMLVideoElement, run: (frame: ImageBitmap) => Promise<T>) {
    if (closed) throw new Error('vision-closed')
    if (processingFrame) throw new Error('vision-busy')
    if (!video.videoWidth || !video.videoHeight || video.readyState < 2) throw new Error('video-not-ready')
    processingFrame = true
    let frame: ImageBitmap | undefined
    try {
      const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight))
      frame = await createImageBitmap(video, {
        resizeWidth: Math.max(1, Math.round(video.videoWidth * scale)),
        resizeHeight: Math.max(1, Math.round(video.videoHeight * scale)),
      })
      return await run(frame)
    } finally {
      frame?.close()
      processingFrame = false
    }
  }

  try {
    await send({ type: 'init' })
  } catch (error) {
    stop('vision-init-error')
    throw error
  }

  return {
    analyze: (video, timestamp, samples) => withFrame(video, (frame) => send({ type: 'analyze', frame, timestamp, samples })),
    capture: (video) => withFrame(video, (frame) => send({ type: 'capture', frame })),
    close: async () => { stop('vision-closed') },
  }
}
