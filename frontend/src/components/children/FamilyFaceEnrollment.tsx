import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, CameraOff } from 'lucide-react'
import type { BuddyVision } from '../../lib/buddy/vision'
import { FAMILY_ROLES, FAMILY_ROLE_LABELS, type FamilyFaceSamples, type FamilyFaceUpdates, type FamilyRole } from '../../lib/buddy/visionProfiles'
import { CAMERA_CONSTRAINTS, cameraUnavailableReason } from '../../lib/recording'

type CameraSession = { stream?: MediaStream; vision?: BuddyVision }

const CAMERA_ERRORS: Record<string, string> = {
  NotAllowedError: 'Cho phép truy cập camera trong trình duyệt rồi thử lại.',
  NotFoundError: 'Không tìm thấy camera trên thiết bị này.',
  NotReadableError: 'Không mở được camera. Kiểm tra xem ứng dụng khác có đang sử dụng camera không.',
  'face-count': 'Chỉ để một người trong khung hình rồi thử lại.',
  'face-quality': 'Mời người cần đăng ký nhìn thẳng vào camera, tiến gần hơn và thử lại.',
  'video-not-ready': 'Camera đang khởi động. Chờ một chút rồi thử lại.',
}

function enrollmentError(error: unknown) {
  if (!(error instanceof Error)) return 'Không lấy được mẫu khuôn mặt. Hãy thử lại.'
  return CAMERA_ERRORS[error.message] ?? CAMERA_ERRORS[error.name] ?? 'Không lấy được mẫu khuôn mặt. Hãy thử lại.'
}

export function FamilyFaceEnrollment({
  saved,
  updates,
  onChange,
  onCameraActiveChange,
  disabled = false,
}: {
  saved?: FamilyFaceSamples
  updates: FamilyFaceUpdates
  onChange: (updates: FamilyFaceUpdates) => void
  onCameraActiveChange: (active: boolean) => void
  disabled?: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const [accepted, setAccepted] = useState(false)
  const [role, setRole] = useState<FamilyRole>('child')
  const [status, setStatus] = useState<'idle' | 'opening' | 'ready' | 'capturing'>('idle')
  const [error, setError] = useState<string | null>(null)
  const video = useRef<HTMLVideoElement>(null)
  const camera = useRef<CameraSession | null>(null)

  const closeCamera = useCallback(() => {
    const session = camera.current
    camera.current = null
    session?.stream?.getTracks().forEach((track) => track.stop())
    void session?.vision?.close().catch(() => undefined)
    if (video.current) video.current.srcObject = null
  }, [])

  const stopCamera = useCallback(() => {
    closeCamera()
    setStatus('idle')
    onCameraActiveChange(false)
  }, [closeCamera, onCameraActiveChange])

  useEffect(() => {
    function stopWhenHidden() {
      if (document.hidden && camera.current) stopCamera()
    }
    document.addEventListener('visibilitychange', stopWhenHidden)
    window.addEventListener('pagehide', stopCamera)
    return () => {
      document.removeEventListener('visibilitychange', stopWhenHidden)
      window.removeEventListener('pagehide', stopCamera)
      closeCamera()
    }
  }, [closeCamera, stopCamera])

  useEffect(() => {
    if (disabled && camera.current) stopCamera()
  }, [disabled, stopCamera])

  async function openCamera() {
    if (!accepted || camera.current || disabled) return
    const unavailable = cameraUnavailableReason()
    if (unavailable) {
      setError(unavailable === 'insecure' ? 'Camera cần kết nối HTTPS hoặc localhost.' : 'Trình duyệt này không hỗ trợ camera.')
      return
    }
    const session: CameraSession = {}
    camera.current = session
    onCameraActiveChange(true)
    setError(null)
    setStatus('opening')
    try {
      const stream = await navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS)
      if (camera.current !== session) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      session.stream = stream
      stream.getVideoTracks().forEach((track) => track.addEventListener('ended', () => {
        if (camera.current !== session) return
        stopCamera()
        setError('Camera bị ngắt. Hãy mở lại để lấy mẫu.')
      }, { once: true }))
      if (!video.current) throw new Error('video-not-ready')
      video.current.srcObject = stream
      await video.current.play()
      const { createBuddyVision } = await import('../../lib/buddy/vision')
      const vision = await createBuddyVision()
      if (camera.current !== session) {
        await vision.close()
        return
      }
      session.vision = vision
      setStatus('ready')
    } catch (err) {
      if (camera.current !== session) return
      stopCamera()
      setError(enrollmentError(err))
    }
  }

  async function capture() {
    const session = camera.current
    if (!accepted || disabled || status !== 'ready' || !session?.vision || !video.current) return
    setStatus('capturing')
    setError(null)
    try {
      const sample = await session.vision.capture(video.current)
      if (camera.current !== session) return
      onChange({ ...updates, [role]: sample })
      stopCamera()
    } catch (err) {
      if (camera.current !== session) return
      setError(enrollmentError(err))
      setStatus('ready')
    }
  }

  const hasSamples = FAMILY_ROLES.some((key) => Boolean(updates[key] === undefined ? saved?.[key] : updates[key]))

  return (
    <div className="space-y-3 rounded-2xl bg-duo-mist p-4">
      <button
        type="button"
        className="link-duo inline-flex items-center gap-2 text-sm"
        aria-expanded={expanded}
        disabled={disabled}
        onClick={() => {
          if (expanded) stopCamera()
          setExpanded(!expanded)
        }}
      >
        <Camera className="h-4 w-4" aria-hidden />
        Nhận diện gia đình với Bạn Bin (tuỳ chọn)
      </button>
      {expanded && (
        <div className="space-y-3">
          <p className="text-xs font-semibold text-duo-mute">
            Gắn nhãn Bé, Mẹ hoặc Bố để Bin nhận ra từng người. Mẫu khuôn mặt lưu trên trình duyệt này khi bạn lưu hồ sơ. Ảnh camera không được lưu hay gửi lên máy chủ.
          </p>
          {(hasSamples || Object.keys(updates).length > 0) && (
            <ul className="space-y-2 text-sm">
              {FAMILY_ROLES.map((key) => {
                const update = updates[key]
                const sample = update === undefined ? saved?.[key] : update
                if (!sample && update !== null) return null
                return (
                  <li key={key} className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-bold text-duo-ink">
                      {FAMILY_ROLE_LABELS[key]} · {update === null ? 'Sẽ xoá khi lưu' : update ? 'Sẽ đăng ký khi lưu' : 'Đã đăng ký'}
                    </span>
                    {sample && (
                      <button
                        type="button"
                        className="link-duo text-xs text-duo-red"
                        disabled={disabled || status !== 'idle'}
                        onClick={() => onChange({ ...updates, [key]: null })}
                      >
                        Xoá mẫu {FAMILY_ROLE_LABELS[key]}
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
          <label className="flex items-start gap-2 text-sm font-semibold text-duo-ink">
            <input
              type="checkbox"
              className="mt-1"
              checked={accepted}
              disabled={disabled}
              onChange={(e) => {
                setAccepted(e.target.checked)
                if (!e.target.checked) {
                  stopCamera()
                  onChange(Object.fromEntries(Object.entries(updates).filter(([, sample]) => sample === null)))
                }
              }}
            />
            Tôi là phụ huynh hoặc người giám hộ của bé và đồng ý lưu mẫu của bé. Tôi đã hỏi ý kiến những người lớn sẽ đăng ký.
          </label>
          <label className="block max-w-xs text-xs font-extrabold text-duo-mute">
            Người lấy mẫu
            <select className="input-duo mt-1" value={role} onChange={(e) => setRole(e.target.value as FamilyRole)} disabled={disabled || status !== 'idle'}>
              {FAMILY_ROLES.map((key) => <option key={key} value={key}>{FAMILY_ROLE_LABELS[key]}</option>)}
            </select>
          </label>
          {status !== 'idle' && (
            <p className="text-xs font-semibold text-duo-mute" role="status">
              {status === 'opening' ? 'Đang mở camera và tải bộ nhận diện…' : 'Chỉ để người vừa chọn nhìn thẳng vào camera.'}
            </p>
          )}
          <video
            ref={video}
            playsInline
            muted
            aria-label="Xem trước camera lấy mẫu khuôn mặt"
            hidden={status === 'idle'}
            className="max-h-48 w-full max-w-xs rounded-2xl bg-black object-contain"
          />
          <div className="flex flex-wrap gap-2">
            {status === 'idle' ? (
              <button type="button" className="btn-duo-secondary" disabled={disabled || !accepted} onClick={() => void openCamera()}>
                Mở camera
              </button>
            ) : (
              <>
                <button type="button" className="btn-duo-secondary" disabled={disabled || status !== 'ready'} onClick={() => void capture()}>
                  {status === 'capturing' ? 'Đang lấy mẫu…' : 'Lấy mẫu'}
                </button>
                <button type="button" className="link-duo inline-flex items-center gap-1 text-sm" onClick={stopCamera}>
                  <CameraOff className="h-4 w-4" aria-hidden />
                  Tắt camera
                </button>
              </>
            )}
          </div>
          {error && <p role="alert" className="text-xs font-bold text-duo-red">{error}</p>}
        </div>
      )}
    </div>
  )
}
