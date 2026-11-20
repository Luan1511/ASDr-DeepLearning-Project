import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, HeartHandshake, Mic, MicOff, SendHorizontal, Sparkles } from 'lucide-react'
import { BuddyCharacter } from '../components/buddy/BuddyCharacter'
import { BuddyCamera, type BuddyCameraHandle } from '../components/buddy/BuddyCamera'
import { BuddyDuck } from '../components/buddy/BuddyDuck'
import { BuddyPropPicture } from '../components/buddy/BuddyProps'
import type { BuddyProp } from '../lib/buddy/types'
import { playBuddySong } from '../lib/buddy/song'
import { api } from '../lib/api'
import { askBuddy, recentBuddyMessages, type BuddyEvent, type BuddyMessage, type BuddyVisionContext } from '../lib/buddy/api'
import type { ArrivalRole } from '../lib/buddy/presence'
import {
  clearBuddyHistory, loadBuddyHistory, loadGreetedParents, loadLastBuddyChild, rememberBuddyChild, rememberGreetedParent, saveBuddyHistory,
} from '../lib/buddy/history'
import { BuddyDirector, useBuddyFrame } from '../lib/buddy/engine'
import {
  buddyVoiceStatus, openBuddyMic, speakBuddyLine, transcribeBuddyTurn,
  type BuddyMic, type BuddyVoiceTiming,
} from '../lib/buddy/voice'
import { BUDDY_PERSONALIZE_NOTICE, loadBuddyPersonalize, saveBuddyPersonalize } from '../lib/buddy/personalizeConsent'
import type { BuddyScript } from '../lib/buddy/types'
import type { ChildProfile } from '../lib/types'
import { useAuth } from '../state/useAuth'

const DEFAULT_SUGGESTIONS = ['Chào Bin!', 'Mình chơi đố vui nhé', 'Kể chuyện cho tớ nghe']

function greeting(name?: string): BuddyScript {
  return {
    steps: [
      { say: name ? `Chào ${name}! Mình chơi gì nhỉ?` : 'Chào bạn, Bin đây. Mình chơi gì nhỉ?', expression: 'happy', gesture: 'wave', ears: 'wiggle' },
    ],
    idle: 'listening',
  }
}

function ageInYears(dateOfBirth: string) {
  const dob = new Date(dateOfBirth)
  const now = new Date()
  let age = now.getUTCFullYear() - dob.getUTCFullYear()
  if (now.getUTCMonth() < dob.getUTCMonth() || (now.getUTCMonth() === dob.getUTCMonth() && now.getUTCDate() < dob.getUTCDate())) age--
  return age >= 1 && age <= 18 ? age : undefined
}

type TurnPhase = 'idle' | 'permission' | 'listening' | 'recording' | 'thinking' | 'speaking' | 'music'
/** `arrival`: Bin speaks first because a parent sat down next to the child. */
type TurnSource = 'typed' | 'voice' | 'retry' | 'arrival'
type VoiceSession = {
  controller: AbortController
  context: AudioContext
  mic?: BuddyMic
  resumeTimer?: number
}

const SPEAKER_TAIL_MS = 240
/** How long a picture stays next to Bin. */
const PROP_VISIBLE_MS = 8000
/** A greeting that could not be said within this time (Bin busy) is dropped. */
const ARRIVAL_WAIT_MS = 30_000

const TURN_STATUS: Record<TurnPhase, string> = {
  idle: '',
  permission: 'Đang mở mic…',
  listening: 'Bin đang nghe. Bạn cứ nói nhé!',
  recording: 'Đang nghe lời bạn…',
  thinking: 'Bin đang nghĩ…',
  speaking: 'Bin đang nói',
  music: 'Bin đang mở nhạc',
}

/** Kid mode: text and optional Vietnamese voice turns with Bạn Bin. */
export function BuddyPage() {
  const { user } = useAuth()
  const [params, setParams] = useSearchParams()
  const [family, setFamily] = useState<{ userId: string; profiles: ChildProfile[] } | null>(null)
  const userId = user?.id
  const childId = params.get('childId') ?? ''

  useEffect(() => {
    if (!userId) return
    const request = new AbortController()
    api.get('/children', { signal: request.signal })
      .then((res) => {
        if (request.signal.aborted) return
        const profiles: ChildProfile[] = res.data.children ?? []
        setFamily({ userId, profiles })
        // One child per account: the only child is chosen; older accounts fall back to the last one used.
        const previous = profiles.length === 1 ? profiles[0].id : loadLastBuddyChild(userId)
        if (previous && profiles.some((child) => child.id === previous)) {
          setParams((current) => current.has('childId') ? current : { childId: previous }, { replace: true })
        }
      })
      .catch(() => undefined)
    return () => request.abort()
  }, [userId, setParams])

  useEffect(() => {
    if (userId && childId) rememberBuddyChild(userId, childId)
  }, [userId, childId])

  return (
    <BuddyConversation
      key={`${userId ?? ''}:${childId}`}
      profiles={family && family.userId === userId ? family.profiles : []}
      userId={userId ?? ''}
      childId={childId}
      showStudio={user?.role === 'ADMIN'}
      onChildChange={(id) => {
        rememberBuddyChild(userId ?? '', id)
        setParams(id ? { childId: id } : {}, { replace: true })
      }}
    />
  )
}

function BuddyConversation({ profiles, userId, childId, showStudio, onChildChange }: {
  profiles: ChildProfile[]
  userId: string
  childId: string
  showStudio: boolean
  onChildChange: (id: string) => void
}) {
  const director = useMemo(() => new BuddyDirector(), [])
  const frame = useBuddyFrame(director)
  const child = profiles.find((c) => c.id === childId)
  const firstName = child?.fullName.trim().split(/\s+/).pop()
  const profile = useRef(child)

  useEffect(() => { profile.current = child }, [child])

  const [savedHistory] = useState(() => loadBuddyHistory(userId, childId))
  const messages = useRef<BuddyMessage[]>(savedHistory)
  const activeTurn = useRef<AbortController | null>(null)
  const voiceSession = useRef<VoiceSession | null>(null)
  const camera = useRef<BuddyCameraHandle>(null)
  const [input, setInput] = useState('')
  const [phase, setPhase] = useState<TurnPhase>('idle')
  const [voiceAvailable, setVoiceAvailable] = useState(false)
  const [voiceOn, setVoiceOn] = useState(false)
  const [voiceError, setVoiceError] = useState('')
  const busy = phase === 'thinking'
  const recording = phase === 'recording' || phase === 'permission'
  const [suggestions, setSuggestions] = useState<string[]>(DEFAULT_SUGGESTIONS)
  const [canRetry, setCanRetry] = useState(savedHistory.at(-1)?.role === 'child')
  const [lastChild, setLastChild] = useState<{ text: string; fromVoice: boolean } | null>(() => {
    const message = savedHistory.filter(({ role }) => role === 'child').at(-1)
    return message ? { text: message.text, fromVoice: false } : null
  })
  const [historyWarning, setHistoryWarning] = useState('')
  const [editingTranscript, setEditingTranscript] = useState(false)
  const [songPlaying, setSongPlaying] = useState(false)
  // The picture Bin holds up while talking about something (cat, house…); `key` replays its entrance.
  const [shownProp, setShownProp] = useState<{ prop: BuddyProp; key: number } | null>(null)
  useEffect(() => {
    if (!shownProp) return
    const timer = window.setTimeout(() => setShownProp(null), PROP_VISIBLE_MS)
    return () => window.clearTimeout(timer)
  }, [shownProp])
  // The parent's choice to let Bin use the personalisation; a ref so voice turns read the latest value.
  const [personalize, setPersonalize] = useState(() => loadBuddyPersonalize(userId, childId))
  const personalizeRef = useRef(personalize)
  const [personalizeWarning, setPersonalizeWarning] = useState('')

  function choosePersonalize(on: boolean) {
    personalizeRef.current = on
    setPersonalize(on)
    setPersonalizeWarning(saveBuddyPersonalize(userId, childId, on) ? '' : 'Trình duyệt chưa lưu được lựa chọn; lựa chọn chỉ có hiệu lực đến khi tải lại trang.')
  }
  const inputRef = useRef<HTMLInputElement>(null)

  const cancelTurn = useCallback(() => {
    const session = voiceSession.current
    window.clearTimeout(session?.resumeTimer)
    session?.mic?.setListening(false)
    activeTurn.current?.abort()
    activeTurn.current = null
    director.cancelScript()
    director.stopAll()
  }, [director])

  const closeVoice = useCallback(() => {
    cancelTurn()
    const session = voiceSession.current
    voiceSession.current = null
    if (!session) return
    session.controller.abort()
    void session.context.close().catch(() => undefined)
  }, [cancelTurn])

  const stopVoice = useCallback((message = '') => {
    closeVoice()
    setVoiceOn(false)
    setVoiceError(message)
    setPhase('idle')
    director.setExpression('listening')
  }, [closeVoice, director])

  useEffect(() => {
    const request = new AbortController()
    if (window.isSecureContext && navigator.mediaDevices?.getUserMedia && typeof AudioWorkletNode !== 'undefined' && typeof AudioContext !== 'undefined') {
      void buddyVoiceStatus(request.signal).then(({ enabled }) => setVoiceAvailable(enabled), () => undefined)
    }
    return () => request.abort()
  }, [])

  useEffect(() => {
    const stopOnExit = () => { if (voiceSession.current) stopVoice() }
    const stopWhenHidden = () => { if (document.hidden) stopOnExit() }
    document.addEventListener('visibilitychange', stopWhenHidden)
    window.addEventListener('pagehide', stopOnExit)
    return () => {
      document.removeEventListener('visibilitychange', stopWhenHidden)
      window.removeEventListener('pagehide', stopOnExit)
      closeVoice()
    }
  }, [closeVoice, stopVoice])

  useEffect(() => {
    const timer = setTimeout(() => {
      if (activeTurn.current) return
      if (messages.current.length > 0) {
        const previous = messages.current.filter(({ role }) => role === 'buddy').at(-1)
        if (previous) {
          const now = performance.now()
          const duration = director.say(previous.text, now)
          director.say(previous.text, now - duration)
        }
        director.setExpression('listening')
      } else void director.runScript(greeting(firstName))
    }, 500)
    return () => clearTimeout(timer)
  }, [director, firstName])

  function beginTurn() {
    cancelTurn()
    director.say('')
    const turn = new AbortController()
    activeTurn.current = turn
    setVoiceError('')
    setPhase('thinking')
    return turn
  }

  function listenAgain(session: VoiceSession, delay = 0) {
    if (voiceSession.current !== session || !session.mic) return
    window.clearTimeout(session.resumeTimer)
    const start = () => {
      if (voiceSession.current !== session) return
      if (document.hidden || session.context.state !== 'running') {
        stopVoice('Mic đã tạm dừng. Bật lại để nói tiếp nhé.')
        return
      }
      session.mic?.setListening(true)
      director.setExpression('listening')
      setPhase('listening')
    }
    if (delay) session.resumeTimer = window.setTimeout(start, delay)
    else start()
  }

  function finishTurn(turn: AbortController, session: VoiceSession | null) {
    if (turn.signal.aborted) return
    if (activeTurn.current === turn) activeTurn.current = null
    if (session) listenAgain(session, SPEAKER_TAIL_MS)
    else setPhase('idle')
  }

  function rememberHistory(history: BuddyMessage[]) {
    messages.current = recentBuddyMessages(history)
    setHistoryWarning(saveBuddyHistory(userId, childId, messages.current)
      ? ''
      : 'Trình duyệt chưa lưu được lịch sử. Bin có thể quên khi bạn rời trang.')
  }

  async function respond(
    raw: string,
    turn: AbortController,
    voice: AudioContext | null,
    source: TurnSource,
    vision?: BuddyVisionContext,
    event?: BuddyEvent,
  ) {
    const text = raw.trim()
    if ((!text && source !== 'arrival') || turn.signal.aborted) return null
    if (source === 'typed' || source === 'voice') setLastChild({ text, fromVoice: source === 'voice' })
    setCanRetry(false)
    setSuggestions([])
    setPhase('thinking')
    director.setExpression('thinking')
    director.play('think', { id: 'waiting', loop: true })

    const activeChild = profile.current
    const name = activeChild?.fullName.trim().normalize('NFC').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const outbound = name
      ? text.normalize('NFC').replace(new RegExp(`(^|[^\\p{L}\\p{M}\\p{N}])${name}(?=$|[^\\p{L}\\p{M}\\p{N}])`, 'giu'), '$1bạn')
      : text
    const history = source === 'retry'
      ? messages.current
      : source === 'arrival'
        ? recentBuddyMessages(messages.current)
        : recentBuddyMessages([...messages.current, { role: 'child', text: outbound }])
    rememberHistory(history)
    const { script, fallback, voice: voiceStyle } = await askBuddy(
      history,
      {
        age: activeChild ? ageInYears(activeChild.dateOfBirth) : undefined,
        id: activeChild?.id,
        personalize: personalizeRef.current,
      },
      turn.signal,
      vision,
      event,
    )
    if (turn.signal.aborted) return null
    director.stop('waiting')
    // Bin speaking first is a nice-to-have: when the chat service fails, stay quiet.
    if (source === 'arrival' && fallback) return null
    setCanRetry(fallback)
    setShownProp(!fallback && script.prop ? { prop: script.prop, key: Date.now() } : null)

    if (!voice) {
      setPhase('idle')
      inputRef.current?.focus()
    }

    const shown: string[] = []
    await director.runScript(script, (index, step) => {
      if (turn.signal.aborted || fallback || !step.say) return
      shown[index] = step.say
      rememberHistory([...history, { role: 'buddy', text: shown.join(' ') }])
      setSuggestions(script.suggestions ?? [])
    }, voice ? async (line, start) => {
      try {
        await speakBuddyLine(voice, line, turn.signal, (level) => {
          setPhase('speaking')
          start(level)
        }, { calm: voiceStyle === 'calm' })
      } catch (error) {
        if (!turn.signal.aborted) {
          setVoiceError('Bin chưa phát được tiếng. Bạn có thể đọc câu trả lời trên màn hình.')
        }
        throw error
      }
    } : undefined)
    if (!fallback && script.song && !turn.signal.aborted) {
      // The mic stays off while the song plays (the turn is still open); Bin dances with the duck.
      setPhase('music')
      setShownProp(null)
      setSongPlaying(true)
      director.play('dance', { id: 'song', loop: true })
      const result = await playBuddySong(script.song, turn.signal, voiceStyle === 'calm' ? 0.5 : 0.9)
      director.stop('song')
      setSongPlaying(false)
      if (result === 'failed') setVoiceError('Bin chưa mở được bài hát lúc này.')
      if (!voice && !turn.signal.aborted) setPhase('idle')
    }
    return fallback ? null : script
  }

  /** "Dừng nhạc": ends the turn; with the mic on, Bin listens again. */
  function stopSong() {
    if (voiceSession.current?.mic) {
      interruptVoice()
      return
    }
    cancelTurn()
    setSongPlaying(false)
    setPhase('idle')
  }

  // A parent sat down next to the child (seen by the camera): Bin greets them when it is free.
  const pendingArrival = useRef<{ role: ArrivalRole; at: number } | null>(null)
  const tryGreetRef = useRef<() => void>(() => {})

  async function greet(role: ArrivalRole) {
    const session = voiceSession.current
    const voice = session?.context.state === 'running' ? session.context : null
    const turn = beginTurn()
    try {
      const spoken = await respond('', turn, voice, 'arrival', camera.current?.snapshot()?.context, { type: 'arrival', role })
      // Greeted once per conversation: not again after a reload or when the camera is turned on again.
      if (spoken) rememberGreetedParent(userId, childId, role)
    } finally {
      finishTurn(turn, session)
    }
  }

  function handleArrival(role: ArrivalRole) {
    if (loadGreetedParents(userId, childId).includes(role)) return
    pendingArrival.current = { role, at: performance.now() }
    tryGreetRef.current()
  }

  function tryGreet() {
    const pending = pendingArrival.current
    if (!pending) return
    if (performance.now() - pending.at > ARRIVAL_WAIT_MS) {
      pendingArrival.current = null
      return
    }
    if (activeTurn.current || editingTranscript || (phase !== 'idle' && phase !== 'listening')) return
    pendingArrival.current = null
    void greet(pending.role)
  }

  useEffect(() => {
    tryGreetRef.current = tryGreet
  })
  useEffect(() => {
    tryGreetRef.current()
  }, [phase, editingTranscript])

  async function send(raw: string, mode: 'typed' | 'retry' | 'correction' = 'typed') {
    const text = raw.trim()
    if (!text || recording) return
    const session = voiceSession.current
    const turn = beginTurn()
    if (mode === 'correction') {
      // Replace the last transcript and the answer that relied on it.
      const remove = messages.current.at(-1)?.role === 'buddy' ? 2 : 1
      messages.current = messages.current.slice(0, -remove)
    }
    setEditingTranscript(false)
    setInput('')
    const voice = session?.context.state === 'running' ? session.context : null
    try {
      await respond(text, turn, voice, mode === 'correction' ? 'voice' : mode, camera.current?.snapshot()?.context)
    } finally {
      finishTurn(turn, session)
    }
  }

  function editTranscript() {
    if (!lastChild?.fromVoice || recording) return
    cancelTurn()
    director.setExpression('listening')
    setPhase('idle')
    setVoiceError('')
    setInput(lastChild.text)
    setEditingTranscript(true)
    inputRef.current?.focus()
  }

  async function listenToTurn(audio: Blob, session: VoiceSession, timing: BuddyVoiceTiming) {
    if (voiceSession.current !== session) return
    const vision = camera.current?.snapshot(timing)
    const turn = beginTurn()
    director.setExpression('thinking')
    try {
      const transcript = (await transcribeBuddyTurn(audio, turn.signal)).trim()
      turn.signal.throwIfAborted()
      if (transcript) {
        await respond(transcript, turn, session.context, 'voice', vision?.isCurrent() ? vision.context : undefined)
      }
      else setVoiceError('Bin chưa nghe rõ. Bạn nói lại nhé.')
    } catch {
      if (!turn.signal.aborted) setVoiceError('Bin chưa nghe được lần này. Bạn thử nói lại hoặc gõ cho Bin nhé.')
    } finally {
      finishTurn(turn, session)
    }
  }

  async function enableVoice() {
    if (voiceSession.current || editingTranscript || document.hidden) return
    cancelTurn()
    setVoiceOn(true)
    setVoiceError('')
    setPhase('permission')
    const controller = new AbortController()
    try {
      const context = new AudioContext()
      const session: VoiceSession = { context, controller }
      voiceSession.current = session
      const [mic] = await Promise.all([
        openBuddyMic(context, controller.signal, {
          onSpeech: () => {
            if (voiceSession.current !== session) return
            setVoiceError('')
            setPhase('recording')
          },
          onTurn: (audio, timing) => void listenToTurn(audio, session, timing),
          onError: () => {
            if (voiceSession.current === session) stopVoice('Mic đã ngắt. Bật lại để nói tiếp nhé.')
          },
        }),
        context.resume(),
      ])
      controller.signal.throwIfAborted()
      session.mic = mic
      listenAgain(session)
    } catch (error) {
      if (controller.signal.aborted) return
      stopVoice(error instanceof DOMException && error.name === 'NotAllowedError'
        ? 'Bạn có thể cho phép mic trong trình duyệt hoặc tiếp tục bằng cách gõ.'
        : 'Bin chưa mở được mic. Bạn thử lại hoặc gõ cho Bin nhé.')
    }
  }

  function interruptVoice() {
    const session = voiceSession.current
    if (!session?.mic) return
    cancelTurn()
    setVoiceError('')
    listenAgain(session, SPEAKER_TAIL_MS)
  }

  function resetHistory() {
    if (!window.confirm('Xóa lịch sử trò chuyện với Bin của hồ sơ này trên trình duyệt này?')) return
    stopVoice()
    messages.current = []
    setHistoryWarning(clearBuddyHistory(userId, childId) ? '' : 'Trình duyệt chưa xóa được lịch sử. Hãy thử lại.')
    setLastChild(null)
    setCanRetry(false)
    setSuggestions(DEFAULT_SUGGESTIONS)
    setEditingTranscript(false)
    setInput('')
    void director.runScript(greeting(firstName))
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    void send(input, editingTranscript ? 'correction' : 'typed')
  }

  const caption = frame.caption

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-gradient-to-b from-[#DFE9FF] via-[#EEF3FF] to-white">
      <header className="flex items-center justify-between gap-3 px-4 py-3 md:px-8">
        <Link to="/" className="btn-duo-ghost !px-3" aria-label="Thoát">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex items-center gap-2 text-xl font-black text-[#172B6B]">
          <Sparkles className="h-5 w-5 text-[#FACC15]" /> Bạn Bin
        </div>
        <div className="flex items-center gap-2">
          <BuddyCamera ref={camera} userId={userId} childId={childId} onArrival={handleArrival} />
          {profiles.length > 1 && (
            <select
              value={childId}
              onChange={(e) => onChildChange(e.target.value)}
              className="rounded-2xl bg-white px-3 py-2 text-sm font-bold text-duo-ink shadow-chip outline-none"
              aria-label="Bé đang trò chuyện"
            >
              <option value="">Chọn bé</option>
              {profiles.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.fullName}
                </option>
              ))}
            </select>
          )}
          {showStudio && (
            <Link to="/admin/buddy" className="btn-duo-ghost !px-3 !py-2 !text-xs">
              Studio
            </Link>
          )}
        </div>
      </header>

      <main className="relative flex min-h-0 flex-1 flex-col items-center justify-end gap-3 px-4 md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:items-center md:gap-6 md:px-10">
        <div className="relative order-2 flex h-full min-h-0 w-full items-end justify-center md:order-1 md:justify-end">
          <BuddyCharacter frame={frame} className="h-full max-h-[640px] w-auto max-w-full translate-y-8" />
          {songPlaying && <BuddyDuck />}
          {!songPlaying && shownProp && <BuddyPropPicture key={shownProp.key} prop={shownProp.prop} />}
          {songPlaying && (
            <button type="button" onClick={stopSong}
              className="absolute right-4 top-4 z-20 rounded-full bg-white px-4 py-2 text-sm font-bold text-[#172B6B] shadow-card">
              Dừng nhạc
            </button>
          )}
        </div>

        <div className="order-1 flex w-full max-w-xl flex-col gap-3 md:order-2 md:self-center md:pb-24">
          <div className="relative max-h-[42dvh] overflow-y-auto rounded-[28px] bg-white px-6 py-5 shadow-card-hover md:max-h-[65dvh]">
            <span className="absolute -bottom-3 left-1/2 h-6 w-6 -translate-x-1/2 rotate-45 rounded-sm bg-white md:-left-3 md:bottom-auto md:top-10 md:translate-x-0" />
            <div className="relative min-h-[4.5rem] text-2xl font-extrabold leading-snug text-[#172B6B] md:text-[28px]">
              {caption?.visible || (busy ? '' : ' ')}
              {caption?.speaking && <span className="ml-0.5 inline-block h-7 w-1 animate-pulse rounded bg-[#FACC15] align-middle" />}
              {busy && !caption?.visible && (
                <span className="inline-flex gap-1.5 align-middle" aria-label="Bin đang nghĩ">
                  {[0, 1, 2].map((i) => (
                    <span key={i} className="h-3 w-3 animate-bounce rounded-full bg-[#3A62D4]" style={{ animationDelay: `${i * 150}ms` }} />
                  ))}
                </span>
              )}
            </div>
          </div>
          {lastChild && (
            <div className="self-end rounded-[22px] rounded-br-md bg-[#1E3F9E] px-5 py-3 text-lg font-bold text-white shadow-card">
              {lastChild.text}
              {lastChild.fromVoice && !editingTranscript && (
                <button type="button" disabled={recording} onClick={editTranscript} className="mt-1 block text-xs font-bold text-white/90 underline disabled:opacity-50">
                  Sửa lời vừa nói
                </button>
              )}
            </div>
          )}
        </div>
      </main>

      <footer className="relative z-10 rounded-t-[32px] bg-white px-4 pb-5 pt-4 shadow-nav-bar md:px-10">
        <div className="mx-auto max-w-3xl">
          <div className="mb-2 flex items-center justify-between gap-3 text-xs text-duo-mute">
            <span role="status">{historyWarning || 'Bin nhớ 32 tin nhắn gần nhất trong 30 ngày trên trình duyệt này.'}</span>
            <button type="button" onClick={resetHistory} className="shrink-0 font-bold underline">Xóa lịch sử</button>
          </div>
          {!editingTranscript && (suggestions.length > 0 || canRetry) && <div className="mb-3 flex flex-wrap justify-center gap-2">
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                disabled={recording}
                onClick={() => void send(s)}
                className="rounded-full bg-[#EEF3FF] px-4 py-2 text-base font-extrabold text-[#1E3F9E] shadow-chip transition hover:bg-[#DCE6FA] disabled:opacity-50"
              >
                {s}
              </button>
            ))}
            {canRetry && (
              <button type="button" disabled={recording} onClick={() => void send(lastChild?.text ?? '', 'retry')} className="btn-duo-ghost !py-2">
                Thử lại
              </button>
            )}
          </div>}
          {editingTranscript && (
            <div className="mb-2 flex items-center justify-between gap-2 text-sm font-bold text-[#172B6B]">
              <span>Sửa câu Bin vừa nghe rồi bấm gửi</span>
              <button type="button" className="link-duo" onClick={() => {
                setInput('')
                setEditingTranscript(false)
                if (voiceSession.current) listenAgain(voiceSession.current)
              }}>Hủy</button>
            </div>
          )}
          {child && !personalize && (
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-[#EEF3FF] px-4 py-2">
              <p className="max-w-lg text-xs font-semibold text-[#172B6B]">
                Phụ huynh có thể cho Bin biết những điều bố mẹ kể về con để Bin trò chuyện hợp với con hơn. {BUDDY_PERSONALIZE_NOTICE}
              </p>
              <button type="button" className="link-duo inline-flex items-center gap-1.5 text-sm" onClick={() => choosePersonalize(true)}>
                <HeartHandshake className="h-4 w-4" aria-hidden="true" /> Cho Bin biết về con
              </button>
            </div>
          )}
          {child && personalize && (
            <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-semibold text-[#172B6B]">
              <span className="inline-flex items-center gap-1.5">
                <HeartHandshake className="h-4 w-4" aria-hidden="true" /> Bin đang dùng hồ sơ cá nhân hoá của con
              </span>
              <Link to={`/children/${encodeURIComponent(child.id)}`} className="link-duo">Sửa hồ sơ</Link>
              <button type="button" className="link-duo" onClick={() => choosePersonalize(false)}>Tắt</button>
            </div>
          )}
          {personalizeWarning && <p role="status" className="mb-2 text-xs font-semibold text-duo-red">{personalizeWarning}</p>}
          {voiceAvailable && !voiceOn && (
            <div className="mb-3 flex justify-center">
              <button type="button" className="link-duo inline-flex items-center gap-1.5 text-sm disabled:opacity-50" disabled={editingTranscript} onClick={() => void enableVoice()}>
                <Mic className="h-4 w-4" aria-hidden="true" /> Bật mic rảnh tay
              </button>
            </div>
          )}
          {(voiceOn || voiceError) && (
            <div className="mb-2 flex min-h-6 flex-wrap items-center justify-between gap-2 text-sm font-bold text-[#172B6B]">
              <span role="status">{voiceError || (editingTranscript ? 'Mic tạm ngưng khi sửa lời' : TURN_STATUS[phase])}</span>
              {voiceOn && (
                <div className="flex items-center gap-3">
                  {(phase === 'thinking' || phase === 'speaking') && (
                    <button type="button" className="link-duo" onClick={interruptVoice}>
                      {phase === 'speaking' ? 'Ngắt lời' : 'Nói lại'}
                    </button>
                  )}
                  <button type="button" className="link-duo inline-flex items-center gap-1.5" onClick={() => stopVoice()}>
                    <MicOff className="h-4 w-4" aria-hidden="true" /> Tạm dừng mic
                  </button>
                </div>
              )}
            </div>
          )}
          <form onSubmit={onSubmit} className="flex items-center gap-3">
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              maxLength={300}
              placeholder="Nói gì đó với Bin nhé..."
              className="input-duo min-w-0 !rounded-full !px-6 !py-4 !text-lg"
              aria-label="Tin nhắn cho Bin"
            />
            <button
              type="submit"
              disabled={recording || !input.trim()}
              className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-full bg-[#1E3F9E] text-white shadow-[0_4px_0_#0D1B45] transition active:translate-y-0.5 disabled:opacity-40"
              aria-label="Gửi"
            >
              <SendHorizontal className="h-6 w-6" />
            </button>
          </form>
        </div>
      </footer>
    </div>
  )
}
