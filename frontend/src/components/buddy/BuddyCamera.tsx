import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Camera, CameraOff } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { BuddyVisionContext } from '../../lib/buddy/api'
import { FAMILY_ROLE_LABELS, loadFamilyFaceSamples, type FamilyRole } from '../../lib/buddy/visionProfiles'
import type { BuddyFace, BuddyVision } from '../../lib/buddy/vision'
import type { BuddyVoiceTiming } from '../../lib/buddy/voice'

const SAMPLE_INTERVAL = 125
const MAX_FRAME_AGE = 650
const WINDOW_MS = 14_000
const CUE_LABELS = { smile: 'Cười', brow_lowered: 'Nhíu mày' }

type VisionFrame = { time: number; faces: BuddyFace[] }
type CameraSession = {
  stream?: MediaStream
  vision?: BuddyVision
  timer?: number
  frames: VisionFrame[]
}

type VisionSnapshot = { context: BuddyVisionContext; isCurrent: () => boolean }
export type BuddyCameraHandle = { snapshot: (timing?: BuddyVoiceTiming) => VisionSnapshot | undefined }

function correlation(a: number[], b: number[]) {
  const meanA = a.reduce((sum, value) => sum + value, 0) / a.length
  const meanB = b.reduce((sum, value) => sum + value, 0) / b.length
  let covariance = 0
  let varianceA = 0
  let varianceB = 0
  for (let i = 0; i < a.length; i++) {
    const x = a[i] - meanA
    const y = b[i] - meanB
    covariance += x * y
    varianceA += x * x
    varianceB += y * y
  }
  return varianceA > 0 && varianceB > 0 ? covariance / Math.sqrt(varianceA * varianceB) : 0
}

function likelySpeaker(frames: VisionFrame[], timing: BuddyVoiceTiming): FamilyRole | 'unknown' {
  const beganAt = timing.endedAt - timing.frameMs * timing.energy.length
  const observed = frames.filter(({ time }) => time >= beganAt && time <= timing.endedAt)
  if (observed.length < 7 || observed[0].time - beganAt > 250 || timing.endedAt - observed.at(-1)!.time > 250) return 'unknown'
  const first = observed[0].faces
  if (!first.length) return 'unknown'

  const loudness: number[] = []
  const movements = first.map(() => [] as number[])
  for (let i = 1; i < observed.length; i++) {
    const earlier = observed[i - 1]
    const later = observed[i]
    if (later.time - earlier.time > 280 || later.faces.length !== first.length) return 'unknown'
    const from = Math.max(0, Math.floor((earlier.time - beganAt) / timing.frameMs))
    const until = Math.min(timing.energy.length, Math.ceil((later.time - beganAt) / timing.frameMs))
    loudness.push(Math.max(0, ...timing.energy.slice(from, until)))
    for (const [index, expected] of first.entries()) {
      const before = earlier.faces.find(({ id }) => id === expected.id)
      const after = later.faces.find(({ id }) => id === expected.id)
      if (!before || !after || before.role !== expected.role || after.role !== expected.role) return 'unknown'
      movements[index].push(Math.abs(after.mouthActivity - before.mouthActivity))
    }
  }

  const scores = movements.map((values, index) => ({
    role: first[index].role,
    activity: values.filter((value, sample) => value >= 0.10 && loudness[sample] > 0.015).length,
    score: correlation(values, loudness),
  })).sort((a, b) => b.score - a.score)
  const [best, next] = scores
  if (!best.role || best.activity < 3 || best.score < 0.55) return 'unknown'
  if (scores.slice(1).some(({ activity }) => activity >= 2) || (next && best.score - next.score < 0.25)) return 'unknown'
  return best.role
}

export const BuddyCamera = forwardRef<BuddyCameraHandle, { userId: string; childId: string }>(
  function BuddyCamera({ userId, childId }, ref) {
    const video = useRef<HTMLVideoElement>(null)
    const current = useRef<CameraSession | null>(null)
    const [state, setState] = useState<'off' | 'opening' | 'on'>('off')
    const [faces, setFaces] = useState<BuddyFace[]>([])
    const [error, setError] = useState('')
    const [hasSamples, setHasSamples] = useState(false)

    const release = useCallback(() => {
      const session = current.current
      current.current = null
      window.clearTimeout(session?.timer)
      session?.stream?.getTracks().forEach((track) => track.stop())
      void session?.vision?.close().catch(() => undefined)
      if (video.current) video.current.srcObject = null
    }, [])

    const stop = useCallback(() => {
      release()
      setState('off')
      setFaces([])
    }, [release])

    useEffect(() => {
      const hide = () => { if (document.hidden) stop() }
      document.addEventListener('visibilitychange', hide)
      window.addEventListener('pagehide', stop)
      return () => {
        document.removeEventListener('visibilitychange', hide)
        window.removeEventListener('pagehide', stop)
        release()
      }
    }, [release, stop])

    useImperativeHandle(ref, () => ({
      snapshot(timing) {
        const session = current.current
        if (!session) return undefined
        const { frames } = session
        const last = frames.at(-1)
        if (!last || performance.now() - last.time > MAX_FRAME_AGE || !last.faces.length) return undefined
        return {
          context: {
            people: last.faces.map(({ role, cue }) => ({
              role: role ?? 'unknown',
              ...(cue ? { cues: [cue] } : {}),
            })),
            speaker: timing ? likelySpeaker(frames, timing) : 'unknown',
          },
          isCurrent: () => current.current === session,
        }
      },
    }), [])

    async function start() {
      if (current.current || document.hidden) return
      const session: CameraSession = { frames: [] }
      current.current = session
      setError('')
      setState('opening')
      const fail = () => {
        if (current.current !== session) return
        stop()
        setError('Bin chưa dùng được camera. Cậu vẫn có thể nói chuyện với Bin.')
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 15 } },
          audio: false,
        })
        if (current.current !== session) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        session.stream = stream
        stream.getVideoTracks().forEach((track) => track.addEventListener('ended', fail, { once: true }))
        const preview = video.current
        if (!preview) throw new Error('Camera preview unavailable')
        preview.srcObject = stream
        await preview.play()
        if (current.current !== session) return

        const { createBuddyVision } = await import('../../lib/buddy/vision')
        const vision = await createBuddyVision()
        if (current.current !== session) {
          await vision.close()
          return
        }
        session.vision = vision
        const samples = userId && childId ? loadFamilyFaceSamples(userId, childId) : undefined
        setHasSamples(Boolean(samples && Object.keys(samples).length))
        setState('on')

        async function sample() {
          const now = performance.now()
          try {
            const next = await vision.analyze(preview!, now, samples)
            if (current.current !== session) return
            session.frames.push({ time: now, faces: next })
            while (session.frames[0].time < now - WINDOW_MS) session.frames.shift()
            setFaces(next)
            session.timer = window.setTimeout(() => void sample(), Math.max(0, SAMPLE_INTERVAL - (performance.now() - now)))
          } catch {
            fail()
          }
        }
        void sample()
      } catch {
        fail()
      }
    }

    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) return null

    return (
      <div className="relative shrink-0 self-start">
        <button type="button" className="btn-duo-ghost !px-3" aria-pressed={state !== 'off'}
          title={state === 'off' ? 'Bật camera cho Bạn Bin' : 'Tắt camera'}
          aria-label={state === 'off' ? 'Bật camera' : 'Tắt camera'}
          onClick={() => { if (state === 'off') void start(); else stop() }}>
          {state === 'off' ? <Camera className="h-5 w-5" /> : <CameraOff className="h-5 w-5" />}
        </button>
        <div hidden={state === 'off' && !error} className="absolute right-0 top-full z-20 mt-2 w-40 rounded-xl bg-white p-2 shadow-card sm:w-52">
          <div hidden={state === 'off'} className="relative overflow-hidden rounded-lg bg-[#DFE9FF]">
            <video ref={video} autoPlay playsInline muted aria-label="Hình xem trước camera" className="block w-full" />
            {faces.map(({ id, role, cue, box }) => (
              <div key={id} className="pointer-events-none absolute rounded-md border-2 border-white"
                style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.width * 100}%`, height: `${box.height * 100}%` }}>
                <span className="absolute left-0 top-0 whitespace-nowrap rounded-br bg-[#172B6B] px-1 text-[10px] font-bold text-white">
                  {role ? FAMILY_ROLE_LABELS[role] : 'Chưa rõ'}{cue ? ` · ${CUE_LABELS[cue]}` : ''}
                </span>
              </div>
            ))}
          </div>
          {state === 'opening' && <p role="status" className="mt-1 text-xs text-[#172B6B]">Đang mở camera…</p>}
          {error && <p role="status" className="text-xs text-[#172B6B]">{error}</p>}
          {state === 'on' && !childId && <p className="mt-1 text-xs text-[#172B6B]">Chọn hồ sơ bé để nhận ra người đã đăng ký.</p>}
          {state === 'on' && childId && !hasSamples && (
            <Link to={`/children/${encodeURIComponent(childId)}`} className="link-duo mt-1 inline-block text-xs">
              Đăng ký khuôn mặt trong hồ sơ
            </Link>
          )}
        </div>
      </div>
    )
  },
)
