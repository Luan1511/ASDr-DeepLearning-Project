import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, CameraOff, Check } from 'lucide-react'
import {
  FACE_VIEW_LABELS,
  PROBE_NOTICES,
  enrollmentHint,
  isEnrollmentComplete,
  toFaceTemplate,
  viewsToCapture,
  type CollectedViews,
  type EnrollProbe,
} from '../../lib/buddy/faceEnrollment'
import type { BuddyVision } from '../../lib/buddy/vision'
import {
  FACE_VIEWS,
  FAMILY_ROLES,
  FAMILY_ROLE_LABELS,
  faceTemplateViews,
  type FaceView,
  type FamilyFaceSamples,
  type FamilyFaceUpdates,
  type FamilyRole,
} from '../../lib/buddy/visionProfiles'
import { cameraUnavailableReason } from '../../lib/recording'

/** One camera session. The views collected so far live here so the probe loop always sees the latest. */
type CameraSession = {
  stream?: MediaStream
  vision?: BuddyVision
  timer?: number
  collected: CollectedViews
  /** Pitch of the frontal sample; tilt is judged against it. */
  neutralPitch: number | null
  /** View seen by the previous look (a view is captured on its second look in a row). */
  previousView: FaceView | null
}

const PROBE_INTERVAL_MS = 250
// A face-sized preview uses a taller frame than the full-body exercise camera.
const FACE_CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  video: {
    facingMode: 'user',
    width: { ideal: 960 },
    height: { ideal: 720 },
    aspectRatio: { ideal: 4 / 3 },
    frameRate: { ideal: 15, max: 20 },
  },
}

const CAMERA_ERRORS: Record<string, string> = {
  NotAllowedError: 'Cho phép truy cập camera trong trình duyệt rồi thử lại.',
  NotFoundError: 'Không tìm thấy camera trên thiết bị này.',
  NotReadableError: 'Không mở được camera. Kiểm tra xem ứng dụng khác có đang sử dụng camera không.',
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
  const [status, setStatus] = useState<'idle' | 'opening' | 'collecting'>('idle')
  const [collected, setCollected] = useState<CollectedViews>({})
  const [notice, setNotice] = useState<Exclude<EnrollProbe['status'], 'ok'> | null>(null)
  const [poseNotice, setPoseNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const video = useRef<HTMLVideoElement>(null)
  const camera = useRef<CameraSession | null>(null)
  // The probe loop outlives renders; it reads the current props from here.
  const latest = useRef({ updates, onChange, role })
  useEffect(() => {
    latest.current = { updates, onChange, role }
  })

  const closeCamera = useCallback(() => {
    const session = camera.current
    camera.current = null
    window.clearTimeout(session?.timer)
    session?.stream?.getTracks().forEach((track) => track.stop())
    void session?.vision?.close().catch(() => undefined)
    if (video.current) video.current.srcObject = null
  }, [])

  const stopCamera = useCallback(() => {
    closeCamera()
    setStatus('idle')
    setCollected({})
    setNotice(null)
    setPoseNotice(null)
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

  /** Keeps whatever views were collected (the frontal one is required) and closes the camera. */
  function finish(session: CameraSession) {
    const template = toFaceTemplate(session.collected)
    if (!template || camera.current !== session) return
    const { updates: current, onChange: change, role: person } = latest.current
    change({ ...current, [person]: template })
    stopCamera()
  }

  /** One look at the camera, then schedules the next one until every view is collected. */
  async function probe(session: CameraSession) {
    if (camera.current !== session || !session.vision || !video.current) return
    try {
      const capture = viewsToCapture(session.collected, session.previousView)
      const result = await session.vision.enroll(video.current, capture, session.neutralPitch)
      if (camera.current !== session) return
      if (result.status !== 'ok') {
        session.previousView = null
        setNotice(result.status)
        setPoseNotice(null)
      } else {
        session.previousView = result.view
        setNotice(null)
        setPoseNotice(result.hint ?? null)
        if (result.view && result.sample) {
          session.collected = { ...session.collected, [result.view]: result.sample }
          if (result.view === 'front') session.neutralPitch = result.pitch
          setCollected(session.collected)
          if (isEnrollmentComplete(session.collected)) {
            finish(session)
            return
          }
        }
      }
    } catch (err) {
      if (camera.current !== session) return
      // A frame that is not ready yet is retried; anything else ends the session.
      if (!(err instanceof Error) || err.message !== 'video-not-ready') {
        stopCamera()
        setError(enrollmentError(err))
        return
      }
    }
    session.timer = window.setTimeout(() => void probe(session), PROBE_INTERVAL_MS)
  }

  async function openCamera() {
    if (!accepted || camera.current || disabled) return
    const unavailable = cameraUnavailableReason()
    if (unavailable) {
      setError(unavailable === 'insecure' ? 'Camera cần kết nối HTTPS hoặc localhost.' : 'Trình duyệt này không hỗ trợ camera.')
      return
    }
    const session: CameraSession = { collected: {}, neutralPitch: null, previousView: null }
    camera.current = session
    onCameraActiveChange(true)
    setError(null)
    setCollected({})
    setNotice(null)
    setPoseNotice(null)
    setStatus('opening')
    try {
      const stream = await navigator.mediaDevices.getUserMedia(FACE_CAMERA_CONSTRAINTS)
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
      setStatus('collecting')
      void probe(session)
    } catch (err) {
      if (camera.current !== session) return
      stopCamera()
      setError(enrollmentError(err))
    }
  }

  const hasSamples = FAMILY_ROLES.some((key) => Boolean(updates[key] === undefined ? saved?.[key] : updates[key]))
  const collectedCount = FACE_VIEWS.filter((view) => collected[view]).length

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
            Gắn nhãn Bé, Mẹ hoặc Bố để Bin nhận ra từng người. Bin lấy mẫu ở vài góc mặt (thẳng, nghiêng hai bên, hơi ngẩng, hơi cúi) để vẫn nhận ra khi người đó xoay nhẹ đầu. Mẫu khuôn mặt lưu trên trình duyệt này khi bạn lưu hồ sơ. Ảnh camera không được lưu hay gửi lên máy chủ.
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
                      {sample && ` (${faceTemplateViews(sample).length}/${FACE_VIEWS.length} góc)`}
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
          {status === 'opening' && (
            <p className="text-xs font-semibold text-duo-mute" role="status">Đang mở camera và tải bộ nhận diện…</p>
          )}
          <div className="relative w-full max-w-lg overflow-hidden rounded-2xl bg-black" hidden={status === 'idle'}>
            <video
              ref={video}
              playsInline
              muted
              aria-label="Xem trước camera lấy mẫu khuôn mặt"
              className="block h-auto w-full"
            />
            {!collected.front && (
              <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="h-3/4 w-[45%] rounded-[50%] border-2 border-dashed border-white/80" />
              </div>
            )}
          </div>
          {status === 'collecting' && (
            <div className="space-y-2">
              <ul className="flex flex-wrap gap-1.5" aria-label="Các góc mặt đã lấy mẫu">
                {FACE_VIEWS.map((view) => (
                  <li
                    key={view}
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-extrabold ${
                      collected[view] ? 'bg-duo-green text-white' : 'bg-white text-duo-mute'
                    }`}
                  >
                    {collected[view] && <Check className="h-3 w-3" aria-hidden />}
                    {FACE_VIEW_LABELS[view]}
                    <span className="sr-only">{collected[view] ? ': đã lấy' : ': chưa lấy'}</span>
                  </li>
                ))}
              </ul>
              <p className="text-sm font-bold text-duo-ink" role="status">
                {notice ? PROBE_NOTICES[notice] : poseNotice ?? enrollmentHint(collected)}
              </p>
              <p className="text-xs font-semibold text-duo-mute">
                {collected.front
                  ? 'Đã có góc thẳng. Bạn có thể dùng mẫu ngay hoặc lấy thêm các góc để Bin nhận diện khi xoay đầu.'
                  : 'Đặt camera ngang tầm mắt, hướng mặt về phía ánh sáng và đưa mặt vào giữa khung hướng dẫn.'}
              </p>
              <p className="text-xs font-semibold text-duo-mute">
                Chỉ để {FAMILY_ROLE_LABELS[role]} trong khung hình. Bin tự lấy mẫu khi mặt giữ yên ở từng góc.
                {role === 'child' && ' Với bé, hãy cầm một món đồ bé thích và di chuyển chậm sang hai bên, lên và xuống gần camera.'}
              </p>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {status === 'idle' ? (
              <button type="button" className="btn-duo-secondary" disabled={disabled || !accepted} onClick={() => void openCamera()}>
                Mở camera
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="btn-duo-secondary"
                  disabled={disabled || !collected.front}
                  onClick={() => camera.current && finish(camera.current)}
                >
                  {collectedCount === 1 ? 'Dùng mẫu chính diện' : `Dùng ${collectedCount}/${FACE_VIEWS.length} góc đã lấy`}
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
