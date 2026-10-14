/**
 * Webcam recording for exercise practice: format choice, camera constraints,
 * parent-facing error text and the recorder hook. Nothing here uploads; the
 * page decides what to do with the recording.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ExerciseCapabilitiesDto } from './exerciseTypes'

export type RecorderFormat = {
  /** Exact type passed to MediaRecorder (may include codecs). */
  mimeType: string
  /** Container type of the resulting Blob. */
  blobType: 'video/mp4' | 'video/webm'
  extension: '.mp4' | '.webm'
}

const MP4_CANDIDATES = ['video/mp4;codecs=avc1.42E01E', 'video/mp4;codecs=avc1', 'video/mp4']
// The deployed ML 1.0 rejects .webm, so WebM is only offered when the backend says it can be analysed.
const WEBM_CANDIDATES = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']

/** Every candidate in preference order (used by the admin recorder probe to show support). */
export const RECORDER_MIME_CANDIDATES = [...MP4_CANDIDATES, ...WEBM_CANDIDATES]

export function recorderFormatFor(mimeType: string): RecorderFormat {
  return mimeType.startsWith('video/webm')
    ? { mimeType, blobType: 'video/webm', extension: '.webm' }
    : { mimeType, blobType: 'video/mp4', extension: '.mp4' }
}

export function isRecorderMimeSupported(mimeType: string): boolean {
  return typeof MediaRecorder !== 'undefined' && typeof MediaRecorder.isTypeSupported === 'function'
    ? MediaRecorder.isTypeSupported(mimeType)
    : false
}

/** First recordable format the ML server can read; null → the UI offers a file upload instead. */
export function pickRecorderMime(caps: Pick<ExerciseCapabilitiesDto, 'acceptsWebm'> | null): RecorderFormat | null {
  const candidates = caps?.acceptsWebm ? RECORDER_MIME_CANDIDATES : MP4_CANDIDATES
  const found = candidates.find(isRecorderMimeSupported)
  return found ? recorderFormatFor(found) : null
}

/** No audio; 15 fps halves the OpenPose work because scoring resamples to 15 Hz anyway. */
export const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  video: {
    facingMode: 'user',
    width: { ideal: 960 },
    height: { ideal: 540 },
    frameRate: { ideal: 15, max: 20 },
  },
}

export const RECORDER_BITS_PER_SECOND = 2_500_000
const RECORDER_TIMESLICE_MS = 1000

export type CameraErrorKind = 'insecure' | 'unsupported' | 'no-format' | 'tab-hidden' | 'track-ended'

/** Failures detected by this module (as opposed to DOMExceptions thrown by the browser). */
export class CameraError extends Error {
  readonly kind: CameraErrorKind
  constructor(kind: CameraErrorKind) {
    super(kind)
    this.name = 'CameraError'
    this.kind = kind
  }
}

const KIND_MESSAGE: Record<CameraErrorKind, string> = {
  insecure:
    'Camera chỉ hoạt động khi trang được mở bằng https:// hoặc trên localhost. Hãy dùng địa chỉ https, hoặc tải lên video quay sẵn.',
  unsupported: 'Trình duyệt này không hỗ trợ dùng camera trên trang web. Bạn có thể quay bằng điện thoại rồi tải video lên.',
  'no-format':
    'Trình duyệt này chưa ghi được định dạng video mà máy phân tích đọc được. Hãy dùng Chrome (bản 126 trở lên), Edge hoặc Safari, hoặc tải video quay bằng điện thoại.',
  'tab-hidden': 'Ghi hình đã dừng vì bạn chuyển sang ứng dụng khác. Mình quay lại nhé.',
  'track-ended': 'Camera bị ngắt kết nối. Kiểm tra camera rồi thử lại.',
}

const DOM_ERROR_MESSAGE: Record<string, string> = {
  NotAllowedError:
    'Trình duyệt chưa được phép dùng camera. Bấm biểu tượng ổ khoá cạnh địa chỉ trang → cho phép Camera, rồi tải lại trang, hoặc tải lên video quay sẵn.',
  NotFoundError: 'Không tìm thấy camera trên thiết bị này. Bạn có thể quay bằng điện thoại rồi tải video lên.',
  NotReadableError: 'Camera đang được ứng dụng khác sử dụng (Zalo, Meet…). Hãy đóng ứng dụng đó rồi thử lại.',
  OverconstrainedError: 'Camera không hỗ trợ chế độ quay yêu cầu. Thử lại hoặc tải video lên.',
}
// Older browser names for the same failures.
const DOM_ERROR_ALIAS: Record<string, string> = {
  PermissionDeniedError: 'NotAllowedError',
  SecurityError: 'NotAllowedError',
  DevicesNotFoundError: 'NotFoundError',
  TrackStartError: 'NotReadableError',
  ConstraintNotSatisfiedError: 'OverconstrainedError',
}

/** Parent-facing Vietnamese text for any camera/recorder failure. */
export function cameraErrorMessage(err: unknown): string {
  if (err instanceof CameraError) return KIND_MESSAGE[err.kind]
  const name = (err as { name?: unknown } | null)?.name
  if (typeof name === 'string') {
    const message = DOM_ERROR_MESSAGE[DOM_ERROR_ALIAS[name] ?? name]
    if (message) return message
  }
  return 'Không mở được camera. Hãy thử lại, hoặc tải lên video quay sẵn.'
}

/** Why the camera cannot be used at all on this page, or null when it may work. */
export function cameraUnavailableReason(): CameraErrorKind | null {
  if (typeof window !== 'undefined' && window.isSecureContext === false) return 'insecure'
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return 'unsupported'
  return null
}

export type CameraRecording = {
  blob: Blob
  format: RecorderFormat
  /** Wall-clock length (performance.now()), more reliable than container metadata. */
  durationMs: number
  width: number | null
  height: number | null
}

export type CameraRecorderStatus = 'idle' | 'opening' | 'ready' | 'recording' | 'error'

type Session = {
  recorder: MediaRecorder
  chunks: Blob[]
  startedAt: number
  aborted: boolean
  stopped: Promise<void>
}

export type CameraRecorder = {
  status: CameraRecorderStatus
  stream: MediaStream | null
  /** Parent-facing message of the last failure (cleared by open()). */
  error: string | null
  errorKind: CameraErrorKind | 'browser' | null
  /** Asks for the camera; resolves true when the preview stream is ready. */
  open: () => Promise<boolean>
  /** Starts recording; returns the performance.now() start time, or null if it could not start. */
  start: () => number | null
  /** Stops recording and the camera; resolves the recording (null if nothing was recorded). */
  stop: () => Promise<CameraRecording | null>
  /** Discards any recording in progress and stops the camera. */
  close: () => void
}

/**
 * Camera preview + MediaRecorder with the exercise settings (15 fps, no audio,
 * 2.5 Mbps, 1 s chunks). Recording aborts when the tab is hidden or the camera
 * track ends; camera tracks are stopped on stop(), close() and unmount.
 */
export function useCameraRecorder({
  format,
  onAbort,
}: {
  format: RecorderFormat | null
  /** Called when a recording in progress is aborted (tab hidden, camera disconnected). */
  onAbort?: (message: string) => void
}): CameraRecorder {
  const [status, setStatus] = useState<CameraRecorderStatus>('idle')
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [error, setError] = useState<{ message: string; kind: CameraRecorder['errorKind'] } | null>(null)

  const streamRef = useRef<MediaStream | null>(null)
  const sessionRef = useRef<Session | null>(null)
  // Bumped by close(): a getUserMedia() that resolves after it is released at once.
  const openTokenRef = useRef(0)
  const onAbortRef = useRef(onAbort)
  useEffect(() => {
    onAbortRef.current = onAbort
  }, [onAbort])

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setStream(null)
  }, [])

  const discardSession = useCallback(() => {
    const session = sessionRef.current
    sessionRef.current = null
    if (!session) return
    session.aborted = true
    session.chunks = []
    if (session.recorder.state !== 'inactive') {
      try {
        session.recorder.stop()
      } catch {
        // Already stopping.
      }
    }
  }, [])

  const close = useCallback(() => {
    openTokenRef.current += 1
    discardSession()
    releaseStream()
    setStatus('idle')
  }, [discardSession, releaseStream])

  const abort = useCallback(
    (kind: CameraErrorKind) => {
      const wasRecording = sessionRef.current !== null
      openTokenRef.current += 1
      discardSession()
      releaseStream()
      const message = KIND_MESSAGE[kind]
      setError({ message, kind })
      setStatus('error')
      if (wasRecording) onAbortRef.current?.(message)
    },
    [discardSession, releaseStream],
  )

  const open = useCallback(async () => {
    const unavailable = cameraUnavailableReason()
    if (unavailable) {
      setError({ message: KIND_MESSAGE[unavailable], kind: unavailable })
      setStatus('error')
      return false
    }
    if (streamRef.current) return true
    const token = ++openTokenRef.current
    setError(null)
    setStatus('opening')
    try {
      const media = await navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS)
      if (token !== openTokenRef.current) {
        media.getTracks().forEach((t) => t.stop())
        return false
      }
      media.getVideoTracks().forEach((track) =>
        track.addEventListener('ended', () => {
          if (streamRef.current === media) abort('track-ended')
        }),
      )
      streamRef.current = media
      setStream(media)
      setStatus('ready')
      return true
    } catch (err) {
      if (token !== openTokenRef.current) return false
      setError({ message: cameraErrorMessage(err), kind: 'browser' })
      setStatus('error')
      return false
    }
  }, [abort])

  const start = useCallback(() => {
    const media = streamRef.current
    if (!media || sessionRef.current) return null
    if (!format) {
      setError({ message: KIND_MESSAGE['no-format'], kind: 'no-format' })
      setStatus('error')
      return null
    }
    let recorder: MediaRecorder
    try {
      recorder = new MediaRecorder(media, { mimeType: format.mimeType, videoBitsPerSecond: RECORDER_BITS_PER_SECOND })
    } catch {
      setError({ message: KIND_MESSAGE['no-format'], kind: 'no-format' })
      setStatus('error')
      return null
    }
    let resolveStopped: () => void = () => {}
    const session: Session = {
      recorder,
      chunks: [],
      startedAt: 0,
      aborted: false,
      stopped: new Promise<void>((resolve) => {
        resolveStopped = resolve
      }),
    }
    recorder.ondataavailable = (ev) => {
      if (!session.aborted && ev.data && ev.data.size > 0) session.chunks.push(ev.data)
    }
    recorder.onstop = () => resolveStopped()
    recorder.onerror = () => {
      if (sessionRef.current === session) abort('track-ended')
    }
    try {
      recorder.start(RECORDER_TIMESLICE_MS)
    } catch {
      setError({ message: KIND_MESSAGE['no-format'], kind: 'no-format' })
      setStatus('error')
      return null
    }
    session.startedAt = performance.now()
    sessionRef.current = session
    setStatus('recording')
    return session.startedAt
  }, [format, abort])

  const stop = useCallback(async (): Promise<CameraRecording | null> => {
    const session = sessionRef.current
    const media = streamRef.current
    if (!session || !format) {
      close()
      return null
    }
    const durationMs = performance.now() - session.startedAt
    const settings = media?.getVideoTracks()[0]?.getSettings()
    // Detached first: hiding the tab while the last chunk flushes must not discard a finished take.
    sessionRef.current = null
    if (session.recorder.state !== 'inactive') session.recorder.stop()
    await session.stopped
    openTokenRef.current += 1
    releaseStream()
    setStatus('idle')
    if (session.aborted || session.chunks.length === 0) return null
    return {
      blob: new Blob(session.chunks, { type: format.blobType }),
      format,
      durationMs,
      width: settings?.width ?? null,
      height: settings?.height ?? null,
    }
  }, [format, close, releaseStream])

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden' && sessionRef.current) abort('tab-hidden')
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [abort])

  useEffect(
    () => () => {
      openTokenRef.current += 1
      const session = sessionRef.current
      sessionRef.current = null
      if (session) {
        session.aborted = true
        session.chunks = []
        if (session.recorder.state !== 'inactive') session.recorder.stop()
      }
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    },
    [],
  )

  return { status, stream, error: error?.message ?? null, errorKind: error?.kind ?? null, open, start, stop, close }
}

/** Keeps the screen awake while `active` (demo, countdown, recording); silently unsupported elsewhere. */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || typeof navigator === 'undefined' || !('wakeLock' in navigator)) return
    let sentinel: WakeLockSentinel | null = null
    let cancelled = false
    const acquire = () => {
      if (document.visibilityState !== 'visible') return
      navigator.wakeLock.request('screen').then(
        (lock) => {
          if (cancelled) void lock.release().catch(() => {})
          else sentinel = lock
        },
        () => {
          // Battery saver or policy: the page still works without it.
        },
      )
    }
    // The browser drops the lock whenever the tab is hidden; take it again on return.
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && (!sentinel || sentinel.released)) acquire()
    }
    acquire()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibility)
      void sentinel?.release().catch(() => {})
    }
  }, [active])
}
