export type VideoMetadata = {
  durationMs: number
  width: number
  height: number
}

/**
 * Duration and size from the browser's own decoder, sent with the upload so the
 * backend can derive the frame rate. Resolves null for formats the browser
 * cannot open (often .avi) — the upload still works without it.
 */
export function readVideoMetadata(file: File, timeoutMs = 8000): Promise<VideoMetadata | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    let settled = false

    const finish = (value: VideoMetadata | null) => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      video.removeAttribute('src')
      video.load()
      URL.revokeObjectURL(url)
      resolve(value)
    }
    const timer = window.setTimeout(() => finish(null), timeoutMs)

    video.preload = 'metadata'
    video.muted = true
    video.onloadedmetadata = () => {
      const duration = video.duration
      if (!Number.isFinite(duration) || duration <= 0 || !video.videoWidth || !video.videoHeight) {
        finish(null)
        return
      }
      finish({ durationMs: Math.round(duration * 1000), width: video.videoWidth, height: video.videoHeight })
    }
    video.onerror = () => finish(null)
    video.src = url
  })
}
