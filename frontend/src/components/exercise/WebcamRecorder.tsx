import { useEffect, useRef, type ReactNode } from 'react'
import { CameraOff, Loader2 } from 'lucide-react'
import type { CameraRecorderStatus } from '../../lib/recording'

/**
 * Live camera preview of `useCameraRecorder()`. The preview is mirrored with CSS
 * only, so the child sees a mirror while the recorded stream stays unmirrored.
 */
export function WebcamRecorder({
  stream,
  status,
  className,
  children,
}: {
  stream: MediaStream | null
  status: CameraRecorderStatus
  className?: string
  /** Overlays (framing guide, countdown). */
  children?: ReactNode
}) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    video.srcObject = stream
    if (stream) void video.play().catch(() => {})
    return () => {
      video.srcObject = null
    }
  }, [stream])

  const recording = status === 'recording'

  return (
    <div
      className={[
        'relative overflow-hidden rounded-2xl bg-duo-ink/90',
        recording ? 'shadow-[0_0_0_4px_rgba(255,75,75,0.85)]' : 'shadow-card-inner',
        className ?? 'aspect-video w-full',
      ].join(' ')}
    >
      <video
        ref={videoRef}
        muted
        playsInline
        autoPlay
        aria-label="Hình ảnh camera (lật như gương)"
        className={['h-full w-full -scale-x-100 object-cover', stream ? '' : 'invisible'].join(' ')}
      />

      {!stream && (
        <div className="absolute inset-0 grid place-items-center p-4 text-center text-sm font-bold text-white/80">
          {status === 'opening' ? (
            <span className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Đang mở camera...
            </span>
          ) : (
            <span className="flex flex-col items-center gap-2">
              <CameraOff className="h-8 w-8" />
              Camera đang tắt
            </span>
          )}
        </div>
      )}

      {stream && children}

      {recording && (
        <div className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-white/90 px-2.5 py-1 text-xs font-extrabold text-duo-red">
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-duo-red motion-reduce:animate-none" />
          Đang ghi hình
        </div>
      )}
    </div>
  )
}
