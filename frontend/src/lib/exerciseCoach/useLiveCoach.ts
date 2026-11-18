import { useEffect, useRef, useState } from 'react'
import type { MovementProfile } from '../exerciseTypes'
import type { CoachRequest, CoachResponse } from './pose.worker'
import { CUE_TEXT, CoachPacer, PRAISE_TEXT, PROFILE_CUE } from './rules'

/** What Bin is saying right now; a praise is shown only, a reminder is also spoken. */
export type CoachMessage = { kind: 'cue' | 'praise'; text: string }
/** Bin's face while the message is up. */
export type CoachMood = 'neutral' | 'encourage' | 'happy'

const FRAME_INTERVAL_MS = 100
/** Longest side of the frame given to the pose model. */
const FRAME_SIZE = 480
/** A result older than this describes a moment the child already left. */
const STALE_RESULT_MS = 900
const CUE_VISIBLE_MS = 4500
const PRAISE_VISIBLE_MS = 3000

type WorkerState = { instance: Worker; ready: boolean; pending: boolean }
type Result = Extract<CoachResponse, { type: 'result' }>

/**
 * Live coaching during the recording: the camera preview is analysed in a
 * worker on this device (nothing is sent anywhere) and Bin gives one short
 * reminder when a mistake repeats, or a praise after a few good repetitions.
 *
 * `enabled` loads the pose model as soon as the camera is on; `recording`
 * starts the analysis; `voice` = false keeps the reminders written only (a
 * child who is sensitive to sound). Attach `video` to the preview element.
 */
export function useLiveCoach(profile: MovementProfile | undefined, enabled: boolean, recording: boolean, voice = true) {
  const video = useRef<HTMLVideoElement | null>(null)
  const worker = useRef<WorkerState | null>(null)
  const [failedFor, setFailedFor] = useState<MovementProfile | null>(null)
  const [message, setMessage] = useState<CoachMessage | null>(null)
  const audio = useRef<AudioContext | null>(null)
  const clip = useRef<AudioBuffer | null>(null)
  const accept = useRef<(result: Result) => void>(() => {})

  const supported = typeof window !== 'undefined' && 'Worker' in window && 'OffscreenCanvas' in window
  const wanted = Boolean(profile && enabled)
  const unavailable = wanted && (!supported || failedFor === profile)

  useEffect(() => {
    if (!profile || !enabled || !supported) return
    // Failures are reported from callbacks (never synchronously from this effect).
    const fail = () => setFailedFor(profile)
    let instance: Worker
    try {
      instance = new Worker(new URL('./pose.worker.ts', import.meta.url), { type: 'module' })
    } catch {
      queueMicrotask(fail)
      return
    }
    const state: WorkerState = { instance, ready: false, pending: false }
    worker.current = state
    const failed = () => {
      state.ready = false
      instance.terminate()
      fail()
    }
    instance.onerror = failed
    instance.onmessage = ({ data }: MessageEvent<CoachResponse>) => {
      if (data.type === 'ready') state.ready = true
      if (data.type === 'error') failed()
      if (data.type === 'result') {
        state.pending = false
        accept.current(data)
      }
    }
    const request: CoachRequest = { type: 'init', profile }
    instance.postMessage(request)
    return () => {
      if (worker.current === state) worker.current = null
      instance.terminate()
    }
  }, [profile, enabled, supported])

  useEffect(() => {
    if (!profile || !enabled || !recording || unavailable) return
    const pacer = new CoachPacer()
    const startedAt = performance.now()
    let spoken: AudioBufferSourceNode | null = null
    let hideTimer = 0
    let praises = 0
    let canvas: OffscreenCanvas | null = null
    let drawing: OffscreenCanvasRenderingContext2D | null = null

    accept.current = ({ event, time }) => {
      const now = performance.now()
      if (document.hidden || time < startedAt || now - time > STALE_RESULT_MS) return
      const shown = pacer.accept(event, now)
      if (!shown) return
      window.clearTimeout(hideTimer)
      if (shown.kind === 'praise') {
        setMessage({ kind: 'praise', text: PRAISE_TEXT[praises % PRAISE_TEXT.length] })
        praises += 1
        hideTimer = window.setTimeout(() => setMessage(null), PRAISE_VISIBLE_MS)
        return
      }
      setMessage({ kind: 'cue', text: CUE_TEXT[shown.cue] })
      hideTimer = window.setTimeout(() => setMessage(null), CUE_VISIBLE_MS)
      const context = audio.current
      if (voice && context?.state === 'running' && clip.current && !spoken) {
        const source = context.createBufferSource()
        spoken = source
        source.buffer = clip.current
        source.connect(context.destination)
        source.onended = () => {
          spoken = null
          source.disconnect()
        }
        source.start()
      }
    }

    const timer = window.setInterval(() => {
      const target = worker.current
      const input = video.current
      if (!target?.ready || target.pending || !input || input.readyState < 2 || document.hidden) return
      if (!drawing) {
        canvas = new OffscreenCanvas(1, 1)
        drawing = canvas.getContext('2d')
        if (!canvas || !drawing) {
          setFailedFor(profile)
          return
        }
      }
      target.pending = true
      const time = performance.now()
      let frame: ImageBitmap | undefined
      try {
        const scale = Math.min(1, FRAME_SIZE / Math.max(input.videoWidth, input.videoHeight))
        const width = Math.max(1, Math.round(input.videoWidth * scale))
        const height = Math.max(1, Math.round(input.videoHeight * scale))
        if (canvas!.width !== width || canvas!.height !== height) {
          canvas!.width = width
          canvas!.height = height
        }
        drawing.drawImage(input, 0, 0, width, height)
        frame = canvas!.transferToImageBitmap()
        const request: CoachRequest = { type: 'frame', frame, time }
        target.instance.postMessage(request, [frame])
      } catch {
        frame?.close()
        target.pending = false
      }
    }, FRAME_INTERVAL_MS)

    return () => {
      accept.current = () => {}
      window.clearInterval(timer)
      window.clearTimeout(hideTimer)
      if (spoken) spoken.stop()
      setMessage(null)
    }
  }, [profile, enabled, recording, unavailable, voice])

  useEffect(
    () => () => {
      if (audio.current) void audio.current.close().catch(() => {})
      audio.current = null
      clip.current = null
    },
    [profile, enabled],
  )

  /** Call directly from the Start button: browsers only allow sound after a tap. */
  function unlockAudio() {
    if (!profile || !enabled || !voice || !window.AudioContext) return
    try {
      const context = (audio.current ??= new AudioContext())
      void context.resume().catch(() => {})
      if (clip.current) return
      void fetch(`${import.meta.env.BASE_URL}exercise-coach/${PROFILE_CUE[profile]}.wav`)
        .then((response) => {
          if (!response.ok) throw new Error('Audio unavailable')
          return response.arrayBuffer()
        })
        .then((bytes) => context.decodeAudioData(bytes))
        .then((buffer) => {
          if (audio.current === context) clip.current = buffer
        })
        .catch(() => {})
    } catch {
      // The caption still shows the reminder.
    }
  }

  const mood: CoachMood = message?.kind === 'cue' ? 'encourage' : message?.kind === 'praise' ? 'happy' : 'neutral'
  return { video, message, mood, unavailable, unlockAudio }
}
