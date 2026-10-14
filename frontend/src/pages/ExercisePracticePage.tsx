import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import axios from 'axios'
import {
  ArrowLeft,
  Camera,
  Check,
  Loader2,
  Play,
  RefreshCw,
  RotateCcw,
  Send,
  Square,
  Upload,
  UserPlus,
} from 'lucide-react'
import { ChildAvatar } from '../components/ChildAvatar'
import { UploadDropzone } from '../components/UploadDropzone'
import { CountdownOverlay } from '../components/exercise/CountdownOverlay'
import { ExerciseConsentPanel } from '../components/exercise/ExerciseConsentPanel'
import { FramingGuide } from '../components/exercise/FramingGuide'
import { GuidePuppet } from '../components/exercise/GuidePuppet'
import { HoldToExitButton } from '../components/exercise/HoldToExitButton'
import { ImitationResultView } from '../components/exercise/ImitationResultView'
import { WebcamRecorder } from '../components/exercise/WebcamRecorder'
import { api, apiErrorCode } from '../lib/api'
import { childApiErrorMessage } from '../lib/children'
import {
  EXERCISE_DISCLAIMER,
  PRACTICE_MODE_LABEL,
  SETUP_TIPS,
  exerciseApiErrorMessage,
  fetchExercise,
  fetchExerciseConsent,
  fetchExerciseSession,
  retryExerciseSession,
  uploadExerciseVideo,
} from '../lib/exercises'
import type {
  ExerciseConsentStatus,
  ExerciseSessionDto,
  ExerciseSummaryDto,
  GuideTemplateDto,
  PracticeMode,
  RecordedVia,
} from '../lib/exerciseTypes'
import { formatNumber } from '../lib/format'
import {
  CameraError,
  cameraErrorMessage,
  cameraUnavailableReason,
  pickRecorderMime,
  useCameraRecorder,
  useWakeLock,
} from '../lib/recording'
import type { ChildProfile } from '../lib/types'
import { useExerciseCapabilities } from '../lib/useExerciseCapabilities'
import { readVideoMetadata } from '../lib/video'

/** Recording starts this long before the guide in "làm cùng bạn Mầm" (the child settles first). */
const LEAD_MS = 1500
const TAIL_MS = 1500
const POLL_INTERVAL_MS = 2000
const DEFAULT_MAX_DURATION_SEC = 60
const DEFAULT_MAX_UPLOAD_MB = 100
const DEFAULT_EXTENSIONS = ['.mp4', '.mov', '.mkv']

type Phase = 'setup' | 'upload' | 'demo' | 'countdown' | 'recording' | 'review' | 'uploading' | 'submitted'
type PlaybackRate = 0.75 | 1

/** A recording (webcam) or a chosen file, kept only in this tab until it is sent. */
type Take = {
  blob: Blob
  url: string
  extension: string
  durationMs: number
  width: number | null
  height: number | null
  recordedVia: RecordedVia
  practiceMode: PracticeMode
  playbackRate: PlaybackRate
  guideOffsetMs: number | null
}

type ExerciseData = { exercise: ExerciseSummaryDto; guide: GuideTemplateDto }
type Keyed<T> = { childId: string; value: T }

const isPending = (s: ExerciseSessionDto) => s.status === 'QUEUED' || s.status === 'PROCESSING'

function requestFullscreen() {
  const el = document.documentElement
  if (document.fullscreenElement || typeof el.requestFullscreen !== 'function') return
  el.requestFullscreen().catch(() => {
    // iOS Safari and embedded browsers: the fixed kid layout still fills the window.
  })
}

function exitFullscreen() {
  if (document.fullscreenElement && typeof document.exitFullscreen === 'function') document.exitFullscreen().catch(() => {})
}

function subscribeResize(onChange: () => void) {
  window.addEventListener('resize', onChange)
  return () => window.removeEventListener('resize', onChange)
}
const viewportSnapshot = () => `${window.innerWidth}x${window.innerHeight}`

function useViewport() {
  const [w, h] = useSyncExternalStore(subscribeResize, viewportSnapshot, () => '1024x768').split('x').map(Number)
  return { width: w, height: h, landscape: w >= h }
}

function fileExtension(name: string) {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot).toLowerCase() : ''
}

function uploadErrorText(error: unknown): string {
  const code = apiErrorCode(error)
  if (code === 'RECORDING_TOO_LONG' && axios.isAxiosError(error)) {
    const maxMs = (error.response?.data as { maxMs?: unknown } | undefined)?.maxMs
    if (typeof maxMs === 'number') return `Video dài quá ${Math.floor(maxMs / 1000)} giây. Hãy quay ngắn hơn.`
  }
  return exerciseApiErrorMessage(error, 'Chưa gửi được video. Kiểm tra mạng rồi thử lại.')
}

const tooShortMessage = 'Video ngắn hơn bài mẫu. Để con làm hết động tác rồi mới dừng ghi nhé.'

// ---------------------------------------------------------------------------
// Layout shells
// ---------------------------------------------------------------------------

/** Parent-facing screens: normal size, link back to the library. */
function ParentShell({ backTo, title, children }: { backTo: string; title: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-duo-mist/60">
      <div className="mx-auto max-w-5xl px-4 pb-16 pt-4 md:px-8 md:pt-8">
        <div className="mb-5 flex items-center gap-3">
          <Link to={backTo} className="btn-duo-ghost !px-3 !py-2" aria-label="Về thư viện bài tập">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <h1 className="min-w-0 flex-1 truncate text-xl font-black text-duo-ink md:text-2xl">{title}</h1>
        </div>
        {children}
      </div>
    </div>
  )
}

/** Kid mode: fills the screen, no navigation; only the hold-to-exit button leaves it. */
function KidShell({ onExit, children }: { onExit: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-40 flex flex-col overflow-hidden bg-gradient-to-b from-duo-green-soft to-white">
      <div className="flex items-center justify-between px-4 pt-3">
        <HoldToExitButton onExit={onExit} />
      </div>
      <div className="relative flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  )
}

/** Big centred stage for the waiting and result screens (child and parent watch together). */
function StageShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-duo-green-soft to-white">
      <div className="mx-auto flex max-w-3xl flex-col items-center gap-6 px-4 py-8 text-center">{children}</div>
    </div>
  )
}

function Notice({ tone, children }: { tone: 'error' | 'warn' | 'info'; children: ReactNode }) {
  const cls =
    tone === 'error' ? 'bg-red-50 text-duo-red' : tone === 'warn' ? 'bg-yellow-50 text-yellow-900' : 'bg-duo-mist text-duo-ink'
  return <div className={['rounded-2xl px-4 py-3 text-sm font-bold leading-relaxed', cls].join(' ')}>{children}</div>
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

/**
 * Practice one exercise: setup (parent) → demo / countdown / recording (kid
 * mode, full screen) → review → upload → waiting → result. Without a usable
 * camera the parent can upload a video recorded on a phone instead.
 */
export function ExercisePracticePage() {
  const { exerciseId = '' } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const childId = searchParams.get('childId')
  const caps = useExerciseCapabilities()
  const viewport = useViewport()

  // ---- data ----------------------------------------------------------------
  const [data, setData] = useState<ExerciseData | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [children, setChildren] = useState<ChildProfile[] | null>(null)
  const [childrenError, setChildrenError] = useState<string | null>(null)
  const [consent, setConsent] = useState<Keyed<ExerciseConsentStatus> | null>(null)
  const [consentError, setConsentError] = useState<Keyed<string> | null>(null)

  useEffect(() => {
    let stale = false
    fetchExercise(exerciseId).then(
      (value) => {
        if (stale) return
        setData(value)
        setLoadError(null)
      },
      (e: unknown) => !stale && setLoadError(exerciseApiErrorMessage(e, 'Không tải được bài tập.')),
    )
    return () => {
      stale = true
    }
  }, [exerciseId, reloadKey])

  useEffect(() => {
    api.get('/children').then(
      (res) => setChildren(res.data.children ?? []),
      (e: unknown) => {
        setChildrenError(childApiErrorMessage(e, 'Không tải được danh sách hồ sơ trẻ.'))
        setChildren([])
      },
    )
  }, [])

  const child = children?.find((c) => c.id === childId) ?? null

  useEffect(() => {
    if (!child) return
    const id = child.id
    let stale = false
    fetchExerciseConsent(id).then(
      (value) => !stale && setConsent({ childId: id, value }),
      (e: unknown) =>
        !stale && setConsentError({ childId: id, value: exerciseApiErrorMessage(e, 'Không kiểm tra được quyền ghi hình bài tập.') }),
    )
    return () => {
      stale = true
    }
  }, [child])

  const consentStatus = consent && child && consent.childId === child.id ? consent.value : null
  const consentLoadError = consentError && child && consentError.childId === child.id ? consentError.value : null

  // ---- practice state ------------------------------------------------------
  const [phase, setPhase] = useState<Phase>('setup')
  const [mode, setMode] = useState<PracticeMode>(() => (window.innerWidth < 768 ? 'AFTER_DEMO' : 'FOLLOW_ALONG'))
  const [rate, setRate] = useState<PlaybackRate>(1)
  const [framed, setFramed] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [previewPlaying, setPreviewPlaying] = useState(false)
  const [demoRun, setDemoRun] = useState(0)
  const [demoPlaying, setDemoPlaying] = useState(false)
  const [guidePlaying, setGuidePlaying] = useState(false)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [take, setTake] = useState<Take | null>(null)
  const [uploadPct, setUploadPct] = useState(0)
  const [uploadError, setUploadError] = useState<{ code: string | undefined; message: string } | null>(null)
  const [session, setSession] = useState<ExerciseSessionDto | null>(null)
  const [retrying, setRetrying] = useState(false)
  const [retryError, setRetryError] = useState<string | null>(null)

  const recordStartRef = useRef(0)
  const guideOffsetRef = useRef<number | null>(null)
  const stoppingRef = useRef(false)

  const format = useMemo(() => pickRecorderMime(caps), [caps])
  const camera = useCameraRecorder({
    format,
    onAbort: () => {
      // The hook already shows why (tab hidden, camera unplugged) on the setup screen.
      exitFullscreen()
      setGuidePlaying(false)
      setPhase('setup')
    },
  })

  const templateSec = data?.guide.durationSec ?? data?.exercise.template.durationSec ?? 0
  const maxMs = (caps?.maxDurationSec ?? DEFAULT_MAX_DURATION_SEC) * 1000
  const minMs = Math.max(1000, 0.6 * templateSec * 1000)
  const autoStopMs = Math.min(
    maxMs,
    mode === 'FOLLOW_ALONG' ? LEAD_MS + (templateSec * 1000) / rate + TAIL_MS : 1.5 * templateSec * 1000 + 2000,
  )
  const mirrored = data?.guide.mirrorPolicy !== 'ANATOMICAL_ONLY'
  const kidMode = phase === 'demo' || phase === 'countdown' || phase === 'recording'
  useWakeLock(kidMode)

  const libraryHref = childId ? `/exercises?childId=${encodeURIComponent(childId)}` : '/exercises'

  // ---- recording -------------------------------------------------------------
  const finishRecording = useCallback(async () => {
    if (stoppingRef.current) return
    stoppingRef.current = true
    const offset = guideOffsetRef.current
    try {
      const rec = await camera.stop()
      exitFullscreen()
      setGuidePlaying(false)
      if (!rec) {
        setNotice('Chưa ghi được video lần này. Mình bật camera và thử lại nhé.')
        setPhase('setup')
        return
      }
      setTake({
        blob: rec.blob,
        url: URL.createObjectURL(rec.blob),
        extension: rec.format.extension,
        durationMs: rec.durationMs,
        width: rec.width,
        height: rec.height,
        recordedVia: 'WEBCAM',
        practiceMode: mode,
        playbackRate: rate,
        guideOffsetMs: mode === 'FOLLOW_ALONG' ? (offset ?? LEAD_MS) : null,
      })
      setUploadError(null)
      setPhase('review')
    } finally {
      stoppingRef.current = false
    }
  }, [camera, mode, rate])

  const finishRef = useRef(finishRecording)
  useEffect(() => {
    finishRef.current = finishRecording
  }, [finishRecording])

  useEffect(() => {
    if (phase !== 'recording') return
    const t0 = recordStartRef.current
    const now = performance.now()
    const timers: number[] = []
    if (mode === 'FOLLOW_ALONG') {
      timers.push(
        window.setTimeout(() => {
          guideOffsetRef.current = performance.now() - t0
          setGuidePlaying(true)
        }, Math.max(0, t0 + LEAD_MS - now)),
      )
    }
    timers.push(window.setTimeout(() => void finishRef.current(), Math.max(0, t0 + autoStopMs - now)))
    const ticker = window.setInterval(() => setElapsedMs(performance.now() - t0), 200)
    return () => {
      timers.forEach((t) => window.clearTimeout(t))
      window.clearInterval(ticker)
    }
  }, [phase, mode, autoStopMs])

  // The local recording is dropped (and its URL revoked) as soon as it is replaced or the page closes.
  useEffect(() => {
    if (!take) return
    const url = take.url
    return () => URL.revokeObjectURL(url)
  }, [take])

  useEffect(() => () => exitFullscreen(), [])

  // ---- waiting: poll while the tab is visible ---------------------------------
  const sessionId = session?.id ?? null
  const sessionPending = session ? isPending(session) : false
  useEffect(() => {
    if (phase !== 'submitted' || !sessionId || !sessionPending) return
    let stale = false
    let inFlight = false
    const poll = () => {
      if (inFlight || document.visibilityState !== 'visible') return
      inFlight = true
      fetchExerciseSession(sessionId)
        .then(
          (s) => !stale && setSession(s),
          () => {
            // A transient polling error must not look like a scoring problem.
          },
        )
        .finally(() => {
          inFlight = false
        })
    }
    const timer = window.setInterval(poll, POLL_INTERVAL_MS)
    const onVisibility = () => document.visibilityState === 'visible' && poll()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stale = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [phase, sessionId, sessionPending])

  // ---- handlers --------------------------------------------------------------
  function openCamera() {
    setNotice(null)
    void camera.open()
  }

  function enterKidMode() {
    if (camera.status !== 'ready' || !framed) return
    setNotice(null)
    requestFullscreen()
    if (mode === 'AFTER_DEMO') {
      setDemoRun((n) => n + 1)
      setDemoPlaying(true)
      setPhase('demo')
    } else {
      setPhase('countdown')
    }
  }

  function replayDemo() {
    setDemoRun((n) => n + 1)
    setDemoPlaying(true)
  }

  function onCountdownDone() {
    if (document.visibilityState === 'hidden') {
      exitFullscreen()
      setPhase('setup')
      return
    }
    const t0 = camera.start()
    if (t0 === null) {
      exitFullscreen()
      setPhase('setup')
      return
    }
    recordStartRef.current = t0
    guideOffsetRef.current = null
    setGuidePlaying(false)
    setElapsedMs(0)
    setPhase('recording')
  }

  function exitKidMode() {
    if (phase === 'recording') camera.close()
    exitFullscreen()
    setGuidePlaying(false)
    setDemoPlaying(false)
    setPhase('setup')
  }

  function practiceAgain() {
    const viaUpload = (take?.recordedVia ?? session?.recordedVia) === 'UPLOAD'
    setTake(null)
    setSession(null)
    setUploadError(null)
    setRetryError(null)
    setNotice(null)
    if (viaUpload) {
      setPhase('upload')
      return
    }
    setPhase('setup')
    void camera.open()
  }

  async function onFileChosen(file: File) {
    setNotice(null)
    const accepted = caps?.acceptedExtensions?.length ? caps.acceptedExtensions : DEFAULT_EXTENSIONS
    const extension = fileExtension(file.name)
    if (!accepted.includes(extension)) {
      setNotice(`Định dạng video chưa được hỗ trợ. Hãy dùng ${accepted.map((e) => e.slice(1).toUpperCase()).join(', ')}.`)
      return
    }
    const maxMb = caps?.maxUploadMb ?? DEFAULT_MAX_UPLOAD_MB
    if (file.size > maxMb * 1024 * 1024) {
      setNotice(`Video lớn hơn ${maxMb} MB. Hãy quay ngắn hơn hoặc giảm chất lượng.`)
      return
    }
    const meta = await readVideoMetadata(file)
    if (!meta) {
      setNotice('Không đọc được thời lượng của video này trên trình duyệt. Hãy dùng video MP4 hoặc MOV quay bằng điện thoại.')
      return
    }
    if (meta.durationMs > maxMs) {
      setNotice(`Video dài quá ${Math.floor(maxMs / 1000)} giây. Hãy quay ngắn hơn.`)
      return
    }
    if (meta.durationMs < minMs) {
      setNotice(tooShortMessage)
      return
    }
    setUploadError(null)
    setTake({
      blob: file,
      url: URL.createObjectURL(file),
      extension,
      durationMs: meta.durationMs,
      width: meta.width,
      height: meta.height,
      recordedVia: 'UPLOAD',
      practiceMode: 'AFTER_DEMO',
      playbackRate: rate,
      guideOffsetMs: null,
    })
    setPhase('review')
  }

  async function submit() {
    if (!take || !data || !child) return
    setPhase('uploading')
    setUploadPct(0)
    setUploadError(null)
    try {
      const created = await uploadExerciseVideo({
        childId: child.id,
        exerciseId: data.exercise.id,
        templateId: data.exercise.template.id,
        file: take.blob,
        // Never the original file name: only a neutral name with the container extension.
        filename: `baitap-${Date.now()}${take.extension}`,
        durationMs: take.durationMs,
        videoWidth: take.width,
        videoHeight: take.height,
        recordedVia: take.recordedVia,
        practiceMode: take.practiceMode,
        playbackRate: take.playbackRate,
        guideOffsetMs: take.guideOffsetMs,
        onProgress: setUploadPct,
      })
      setTake(null)
      setSession(created)
      setPhase('submitted')
    } catch (e) {
      const code = apiErrorCode(e)
      setUploadError({ code, message: uploadErrorText(e) })
      setPhase('review')
      if (code === 'EXERCISE_CONSENT_REQUIRED') {
        fetchExerciseConsent(child.id).then(
          (value) => setConsent({ childId: child.id, value }),
          () => {},
        )
      }
    }
  }

  function reloadExercise() {
    setTake(null)
    setUploadError(null)
    setData(null)
    setReloadKey((k) => k + 1)
    setPhase('setup')
  }

  async function retryScoring() {
    if (!session) return
    setRetrying(true)
    setRetryError(null)
    try {
      setSession(await retryExerciseSession(session.id))
    } catch (e) {
      setRetryError(exerciseApiErrorMessage(e, 'Chưa gửi lại được yêu cầu chấm. Vui lòng thử lại.'))
    } finally {
      setRetrying(false)
    }
  }

  // ---- gates -----------------------------------------------------------------
  if (loadError) {
    return (
      <ParentShell backTo={libraryHref} title="Bài tập">
        <Notice tone="error">{loadError}</Notice>
        <div className="mt-4 flex flex-wrap gap-3">
          <button type="button" className="btn-duo-secondary" onClick={() => setReloadKey((k) => k + 1)}>
            <RefreshCw className="h-4 w-4" />
            Thử lại
          </button>
          <Link to={libraryHref} className="btn-duo">
            Về thư viện bài tập
          </Link>
        </div>
      </ParentShell>
    )
  }

  if (!data || children === null) {
    return (
      <ParentShell backTo={libraryHref} title="Bài tập">
        <div className="flex items-center gap-2 text-sm font-semibold text-duo-mute">
          <Loader2 className="h-4 w-4 animate-spin" />
          Đang tải bài tập...
        </div>
      </ParentShell>
    )
  }

  const { exercise, guide } = data

  if (!child) {
    return (
      <ParentShell backTo={libraryHref} title={exercise.title}>
        <div className="card-duo space-y-4 p-6">
          <div className="text-sm font-extrabold uppercase tracking-wide text-duo-ink">Con nào tập bài này?</div>
          {childrenError && <Notice tone="error">{childrenError}</Notice>}
          {childId && children.length > 0 && <Notice tone="warn">Không tìm thấy hồ sơ trẻ này. Hãy chọn lại.</Notice>}
          {children.length === 0 && !childrenError ? (
            <Link to="/children" className="btn-duo">
              <UserPlus className="h-4 w-4" />
              Tạo hồ sơ trẻ
            </Link>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {children.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="card-duo-interactive flex items-center gap-3 p-4 text-left"
                  onClick={() => setSearchParams({ childId: c.id }, { replace: true })}
                >
                  <ChildAvatar name={c.fullName} />
                  <span className="truncate text-base font-black text-duo-ink">{c.fullName}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </ParentShell>
    )
  }

  if (consentLoadError) {
    return (
      <ParentShell backTo={libraryHref} title={exercise.title}>
        <Notice tone="error">{consentLoadError}</Notice>
      </ParentShell>
    )
  }

  if (!consentStatus?.consent) {
    return (
      <ParentShell backTo={libraryHref} title={exercise.title}>
        <div className="card-duo space-y-3 p-6">
          <div className="text-sm font-extrabold uppercase tracking-wide text-duo-ink">Quyền ghi hình bài tập</div>
          <p className="text-sm font-semibold leading-relaxed text-duo-mute">
            Trước khi con tập, bố mẹ cần đọc và đồng ý cách hệ thống dùng video bài tập của {child.fullName}.
          </p>
          <ExerciseConsentPanel
            childId={child.id}
            childName={child.fullName}
            status={consentStatus}
            onChange={(value) => setConsent({ childId: child.id, value })}
          />
        </div>
      </ParentShell>
    )
  }

  const puppetProps = { guide, mirrored, speed: rate, title: exercise.title } as const

  // ---- kid mode --------------------------------------------------------------
  if (phase === 'demo') {
    const size = Math.max(200, Math.min(viewport.width * 0.85, viewport.height * 0.58))
    return (
      <KidShell onExit={exitKidMode}>
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4 pb-6 text-center">
          <div className="text-3xl font-black text-duo-green md:text-5xl">Xem bạn Mầm làm mẫu nhé!</div>
          <GuidePuppet key={demoRun} {...puppetProps} pose="demo" playing={demoPlaying} size={size} onEnded={() => setDemoPlaying(false)} />
          <div className="max-w-2xl text-2xl font-black text-duo-ink md:text-3xl">{exercise.childPrompt}</div>
          <div className="flex flex-wrap justify-center gap-3">
            <button type="button" className="btn-duo-secondary !px-6 !py-4 !text-base" onClick={replayDemo}>
              <RotateCcw className="h-5 w-5" />
              Xem lại
            </button>
            <button type="button" className="btn-duo !px-8 !py-4 !text-base" onClick={() => setPhase('countdown')}>
              <Check className="h-5 w-5" />
              Con sẵn sàng rồi!
            </button>
          </div>
        </div>
      </KidShell>
    )
  }

  if (phase === 'countdown' || phase === 'recording') {
    const followAlong = mode === 'FOLLOW_ALONG'
    const recording = phase === 'recording'
    const progress = recording ? Math.min(1, elapsedMs / autoStopMs) : 0
    const side = viewport.landscape
    const puppetSize = followAlong
      ? Math.max(180, side ? Math.min(viewport.width * 0.45, viewport.height * 0.72) : Math.min(viewport.width * 0.88, viewport.height * 0.55))
      : Math.max(120, Math.min(viewport.width * 0.28, viewport.height * 0.3))
    const prompt = followAlong ? 'Làm theo bạn Mầm nhé!' : 'Đến lượt con!'

    const cameraView = (
      <WebcamRecorder
        stream={camera.stream}
        status={camera.status}
        className={
          followAlong
            ? side
              ? 'aspect-video w-full'
              : 'absolute bottom-24 right-4 z-10 aspect-[3/4] w-[30%]'
            : 'aspect-video w-full max-w-4xl'
        }
      />
    )

    return (
      <KidShell onExit={exitKidMode}>
        <div className="px-4 text-center text-3xl font-black text-duo-green md:text-5xl">{prompt}</div>
        {followAlong ? (
          <div className={['flex min-h-0 flex-1 items-center justify-center gap-4 px-4', side ? 'flex-row' : 'flex-col'].join(' ')}>
            <div className="flex flex-1 items-center justify-center">
              <GuidePuppet {...puppetProps} pose="demo" playing={guidePlaying} size={puppetSize} />
            </div>
            <div className={side ? 'flex flex-1 items-center' : ''}>{cameraView}</div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-4">
            {cameraView}
            <div className="flex items-center gap-3">
              <GuidePuppet {...puppetProps} pose="idle" playing={false} size={puppetSize} />
              <div className="max-w-md text-left text-xl font-black text-duo-ink md:text-2xl">{exercise.childPrompt}</div>
            </div>
          </div>
        )}

        <div className="flex items-center gap-4 px-4 pb-5 pt-2">
          <div className="h-3 flex-1 overflow-hidden rounded-full bg-white shadow-card-inner" aria-hidden>
            <div className="h-3 rounded-full bg-duo-green transition-[width] duration-200" style={{ width: `${progress * 100}%` }} />
          </div>
          <button type="button" className="btn-duo !px-6 !py-4 !text-base" disabled={!recording} onClick={() => void finishRecording()}>
            <Square className="h-5 w-5 fill-current" />
            Xong rồi
          </button>
        </div>

        {phase === 'countdown' && <CountdownOverlay onDone={onCountdownDone} />}
      </KidShell>
    )
  }

  // ---- after recording -------------------------------------------------------
  if (phase === 'review' && take) {
    const tooShort = take.durationMs < minMs
    return (
      <ParentShell backTo={libraryHref} title={exercise.title}>
        <div className="card-duo space-y-4 p-6">
          <div className="text-sm font-extrabold uppercase tracking-wide text-duo-ink">Xem lại video của {child.fullName}</div>
          <video src={take.url} controls playsInline className="max-h-[60vh] w-full rounded-2xl bg-duo-ink" />
          <div className="text-xs font-bold text-duo-mute">
            Dài khoảng {formatNumber(take.durationMs / 1000, 0)} giây • {take.recordedVia === 'WEBCAM' ? 'Quay bằng camera' : 'Video tải lên'} •{' '}
            {PRACTICE_MODE_LABEL[take.practiceMode]}
          </div>
          <Notice tone="info">Video chỉ dùng để chấm điểm và sẽ bị xoá ngay sau đó.</Notice>
          {tooShort && <Notice tone="warn">{tooShortMessage}</Notice>}
          {uploadError && (
            <Notice tone="error">
              <div>{uploadError.message}</div>
              {uploadError.code === 'TEMPLATE_OUTDATED' && (
                <button type="button" className="btn-duo-secondary mt-3" onClick={reloadExercise}>
                  <RefreshCw className="h-4 w-4" />
                  Tải lại bài
                </button>
              )}
            </Notice>
          )}
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              className="btn-duo"
              disabled={tooShort || uploadError?.code === 'TEMPLATE_OUTDATED'}
              onClick={() => void submit()}
            >
              <Send className="h-4 w-4" />
              Gửi chấm điểm
            </button>
            <button type="button" className="btn-duo-secondary" onClick={practiceAgain}>
              <RotateCcw className="h-4 w-4" />
              Quay lại lần nữa
            </button>
          </div>
        </div>
      </ParentShell>
    )
  }

  if (phase === 'uploading') {
    return (
      <ParentShell backTo={libraryHref} title={exercise.title}>
        <div className="card-duo space-y-3 p-6" aria-live="polite">
          <div className="flex justify-between text-sm font-extrabold text-duo-ink">
            <span>Đang gửi video…</span>
            <span className="tabular-nums">{uploadPct}%</span>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-duo-mist">
            <div className="h-3 rounded-full bg-duo-green transition-all" style={{ width: `${uploadPct}%` }} />
          </div>
          <p className="text-xs font-bold text-duo-mute">Đừng đóng trang cho đến khi gửi xong.</p>
        </div>
      </ParentShell>
    )
  }

  if (phase === 'submitted' && session) {
    const puppetSize = Math.max(180, Math.min(viewport.width * 0.7, viewport.height * 0.38, 340))
    const detailsHref = `/exercise-sessions/${session.id}`
    const childHref = `/children/${child.id}`
    const otherExercises = (
      <Link to={libraryHref} className="btn-duo-secondary">
        Bài khác
      </Link>
    )

    if (isPending(session)) {
      const ahead = session.status === 'QUEUED' ? (session.queuePosition ?? 0) : 0
      return (
        <StageShell>
          <GuidePuppet {...puppetProps} pose="idle" playing={false} size={puppetSize} />
          <div className="flex items-center gap-3 text-2xl font-black text-duo-ink md:text-3xl" aria-live="polite">
            <Loader2 className="h-7 w-7 animate-spin text-duo-green" />
            Bạn Mầm đang xem con tập… (thường mất 1–3 phút)
          </div>
          {(session.mlBusy || ahead > 0) && (
            <p className="max-w-xl text-base font-bold text-duo-mute">
              {ahead > 0
                ? `Máy phân tích đang bận xử lý video khác, bài của con đang chờ (còn ${ahead} video trước).`
                : 'Máy phân tích đang bận xử lý video khác, bài của con đang chờ.'}
            </p>
          )}
          {session.errorMessage && <p className="max-w-xl text-sm font-bold text-yellow-800">{session.errorMessage}</p>}
          <p className="max-w-xl text-base font-semibold text-duo-ink">
            Con có thể tập bài khác trong lúc chờ — kết quả sẽ hiện trong hồ sơ của con.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <Link to={libraryHref} className="btn-duo">
              Tập bài khác trong lúc chờ
            </Link>
            <Link to={childHref} className="btn-duo-secondary">
              Về hồ sơ của con
            </Link>
          </div>
        </StageShell>
      )
    }

    if (session.status === 'FAILED' || !session.score) {
      return (
        <StageShell>
          <GuidePuppet {...puppetProps} pose="idle" playing={false} size={puppetSize} />
          <div className="text-2xl font-black text-duo-ink md:text-3xl">Bạn Mầm chưa xem được video lần này</div>
          <p className="max-w-xl text-base font-bold leading-relaxed text-duo-ink">
            {session.errorMessage ?? 'Chưa chấm được do sự cố kỹ thuật. Bấm “Thử chấm lại” hoặc tập lại sau.'}
          </p>
          {retryError && <Notice tone="error">{retryError}</Notice>}
          <div className="flex flex-wrap justify-center gap-3">
            {session.retryable && (
              <button type="button" className="btn-duo" disabled={retrying} onClick={() => void retryScoring()}>
                {retrying ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Thử chấm lại
              </button>
            )}
            <button type="button" className={session.retryable ? 'btn-duo-secondary' : 'btn-duo'} onClick={practiceAgain}>
              <RotateCcw className="h-4 w-4" />
              Tập lại
            </button>
            {otherExercises}
          </div>
          <Link to={childHref} className="link-duo text-sm">
            Về hồ sơ của con
          </Link>
        </StageShell>
      )
    }

    const scored = session.score.status === 'SCORED'
    return (
      <StageShell>
        <GuidePuppet {...puppetProps} pose={scored ? 'cheer' : 'shrug'} playing={false} size={puppetSize} />
        <ImitationResultView score={session.score} view="child" />
        <div className="flex flex-wrap justify-center gap-3">
          <button type="button" className="btn-duo !px-6 !py-4 !text-base" onClick={practiceAgain}>
            <RotateCcw className="h-5 w-5" />
            {scored ? 'Tập lại bài này' : 'Quay lại'}
          </button>
          {otherExercises}
        </div>
        <Link to={detailsHref} className="link-duo text-sm">
          Chi tiết cho bố mẹ
        </Link>
      </StageShell>
    )
  }

  // ---- setup / upload fallback (parent) --------------------------------------
  const blocked = cameraUnavailableReason() ?? (format ? null : 'no-format')
  const blockedMessage = blocked ? cameraErrorMessage(new CameraError(blocked)) : null
  const accepted = caps?.acceptedExtensions?.length ? caps.acceptedExtensions : DEFAULT_EXTENSIONS

  const demoCard = (
    <div className="card-duo flex flex-col items-center gap-3 p-5 text-center">
      <div className="self-stretch text-left text-sm font-extrabold uppercase tracking-wide text-duo-ink">Bạn Mầm làm mẫu</div>
      <GuidePuppet
        {...puppetProps}
        pose="demo"
        playing={previewPlaying}
        size={Math.min(280, viewport.width - 80)}
        onEnded={() => setPreviewPlaying(false)}
      />
      <div className="text-base font-black text-duo-ink">{exercise.childPrompt}</div>
      <p className="text-sm font-semibold leading-relaxed text-duo-mute">{exercise.description}</p>
      <button type="button" className="btn-duo-secondary" onClick={() => setPreviewPlaying(true)} disabled={previewPlaying}>
        <Play className="h-4 w-4" />
        {previewPlaying ? 'Đang làm mẫu...' : 'Xem bạn Mầm làm mẫu'}
      </button>
    </div>
  )

  const speedPicker = (
    <div>
      <div className="mb-2 text-xs font-extrabold uppercase tracking-wide text-duo-mute">Tốc độ của bạn Mầm</div>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Tốc độ của bạn Mầm">
        {([1, 0.75] as const).map((r) => (
          <button
            key={r}
            type="button"
            role="radio"
            aria-checked={rate === r}
            onClick={() => setRate(r)}
            className={[
              'rounded-full px-4 py-2 text-sm font-extrabold transition-all',
              rate === r ? 'bg-duo-green-soft text-duo-green-dark shadow-ring-green' : 'bg-duo-mist text-duo-mute hover:text-duo-ink',
            ].join(' ')}
          >
            {r === 1 ? 'Bình thường' : 'Chậm hơn'}
          </button>
        ))}
      </div>
    </div>
  )

  if (phase === 'upload') {
    return (
      <ParentShell backTo={libraryHref} title={exercise.title}>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
          {demoCard}
          <div className="card-duo space-y-4 p-5">
            <div className="text-sm font-extrabold uppercase tracking-wide text-duo-ink">Tải video quay sẵn</div>
            <ol className="list-decimal space-y-1.5 pl-5 text-sm font-semibold leading-relaxed text-duo-ink">
              <li>Cho con xem bạn Mầm làm mẫu (nút bên cạnh).</li>
              <li>Quay con làm lại động tác bằng điện thoại, quay ngang, thấy cả người con.</li>
              <li>Chọn video vừa quay ở dưới. Video dài tối đa {Math.floor(maxMs / 1000)} giây.</li>
            </ol>
            <ul className="list-disc space-y-1 pl-5 text-xs font-bold text-duo-mute">
              {SETUP_TIPS.map((tip) => (
                <li key={tip}>{tip}</li>
              ))}
            </ul>
            {speedPicker}
            <UploadDropzone
              accept={['video/*', ...accepted].join(',')}
              onFileSelected={(file) => void onFileChosen(file)}
              helperText={`${accepted.map((e) => e.slice(1).toUpperCase()).join(', ')} • tối đa ${caps?.maxUploadMb ?? DEFAULT_MAX_UPLOAD_MB} MB`}
            />
            {notice && <Notice tone="error">{notice}</Notice>}
            {!blocked && (
              <button type="button" className="link-duo text-sm" onClick={() => setPhase('setup')}>
                Quay bằng camera của máy này
              </button>
            )}
          </div>
        </div>
        <p className="mt-6 text-xs font-semibold leading-relaxed text-duo-mute">{EXERCISE_DISCLAIMER}</p>
      </ParentShell>
    )
  }

  const cameraReady = camera.status === 'ready'
  return (
    <ParentShell backTo={libraryHref} title={exercise.title}>
      <div className="grid grid-cols-1 gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        {demoCard}

        <div className="card-duo space-y-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-extrabold uppercase tracking-wide text-duo-ink">Chuẩn bị camera</div>
            <div className="text-xs font-bold text-duo-mute">Tập cho: {child.fullName}</div>
          </div>

          {blockedMessage ? (
            <>
              <Notice tone="warn">{blockedMessage}</Notice>
              <button type="button" className="btn-duo" onClick={() => setPhase('upload')}>
                <Upload className="h-4 w-4" />
                Tải video lên
              </button>
            </>
          ) : (
            <>
              <WebcamRecorder stream={camera.stream} status={camera.status}>
                <FramingGuide />
              </WebcamRecorder>

              {(camera.status === 'idle' || camera.status === 'error') && (
                <button type="button" className="btn-duo-blue" onClick={openCamera}>
                  <Camera className="h-4 w-4" />
                  Bật camera
                </button>
              )}
              {camera.error && <Notice tone="error">{camera.error}</Notice>}
              {notice && <Notice tone="warn">{notice}</Notice>}

              <ul className="list-disc space-y-1 pl-5 text-sm font-semibold leading-relaxed text-duo-ink">
                {SETUP_TIPS.map((tip) => (
                  <li key={tip}>{tip}</li>
                ))}
              </ul>

              <label className="flex cursor-pointer items-start gap-2 text-sm font-bold text-duo-ink">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 accent-duo-green"
                  checked={framed}
                  onChange={(e) => setFramed(e.target.checked)}
                />
                <span>Tôi đã thấy cả người con trong khung hình, từ đầu đến bàn chân.</span>
              </label>

              <div>
                <div className="mb-2 text-xs font-extrabold uppercase tracking-wide text-duo-mute">Cách tập</div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Cách tập">
                  {(['FOLLOW_ALONG', 'AFTER_DEMO'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      role="radio"
                      aria-checked={mode === m}
                      onClick={() => setMode(m)}
                      className={[
                        'rounded-2xl px-4 py-3 text-left transition-all',
                        mode === m ? 'bg-duo-green-soft shadow-ring-green' : 'bg-duo-mist hover:bg-duo-line/40',
                      ].join(' ')}
                    >
                      <div className="text-sm font-extrabold text-duo-ink">{PRACTICE_MODE_LABEL[m]}</div>
                      <div className="mt-0.5 text-xs font-semibold leading-relaxed text-duo-mute">
                        {m === 'FOLLOW_ALONG'
                          ? 'Con làm cùng lúc với bạn Mầm trên màn hình (hợp với màn hình lớn).'
                          : 'Con xem bạn Mầm làm trước, rồi tự làm lại (hợp với điện thoại).'}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {speedPicker}

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <button type="button" className="btn-duo" disabled={!cameraReady || !framed} onClick={enterKidMode}>
                  <Play className="h-4 w-4" />
                  Vào chế độ cho bé
                </button>
                <button type="button" className="link-duo text-sm" onClick={() => setPhase('upload')}>
                  Không dùng camera? Tải video quay sẵn
                </button>
              </div>
              {!cameraReady && camera.status !== 'error' && (
                <div className="text-xs font-bold text-duo-mute">Bật camera và đặt máy sao cho thấy cả người con trước khi bắt đầu.</div>
              )}
            </>
          )}
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-3xl text-xs font-semibold leading-relaxed text-duo-mute">{EXERCISE_DISCLAIMER}</p>
        <button type="button" className="link-duo text-sm" onClick={() => navigate(libraryHref)}>
          Về thư viện bài tập
        </button>
      </div>
    </ParentShell>
  )
}
