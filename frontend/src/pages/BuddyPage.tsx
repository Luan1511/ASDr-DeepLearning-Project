import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, SendHorizontal, Sparkles } from 'lucide-react'
import { BuddyCharacter } from '../components/buddy/BuddyCharacter'
import { api } from '../lib/api'
import { askBuddy, scriptText, type BuddyMessage } from '../lib/buddy/api'
import { BuddyDirector, useBuddyFrame } from '../lib/buddy/engine'
import type { BuddyScript } from '../lib/buddy/types'
import type { ChildProfile } from '../lib/types'
import { useAuth } from '../state/auth'

const DEFAULT_SUGGESTIONS = ['Chào Bin!', 'Mình chơi đố vui nhé', 'Kể chuyện cho tớ nghe']

function greeting(name?: string): BuddyScript {
  return {
    steps: [
      { say: name ? `Xin chào ${name}! Bin đây!` : 'Xin chào! Bin đây!', expression: 'happy', gesture: 'wave', ears: 'wiggle' },
      { say: 'Hôm nay bạn muốn chơi gì cùng Bin nào?', expression: 'curious', gesture: 'listen' },
    ],
    idle: 'listening',
  }
}

function ageInYears(dateOfBirth: string) {
  const dob = new Date(dateOfBirth)
  const now = new Date()
  let age = now.getUTCFullYear() - dob.getUTCFullYear()
  if (now.getUTCMonth() < dob.getUTCMonth() || (now.getUTCMonth() === dob.getUTCMonth() && now.getUTCDate() < dob.getUTCDate())) age--
  return age >= 1 ? age : undefined
}

/** Kid mode: full screen chat with "bạn Bin" (text only for now). */
export function BuddyPage() {
  const { user } = useAuth()
  const director = useMemo(() => new BuddyDirector(), [])
  const frame = useBuddyFrame(director)
  const [params, setParams] = useSearchParams()
  const [children, setChildren] = useState<ChildProfile[]>([])
  const childId = params.get('childId') ?? ''
  const child = children.find((c) => c.id === childId)
  const firstName = child?.fullName.trim().split(/\s+/).pop()

  const [messages, setMessages] = useState<BuddyMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [suggestions, setSuggestions] = useState<string[]>(DEFAULT_SUGGESTIONS)
  const [lastChildText, setLastChildText] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    api
      .get('/children')
      .then((res) => setChildren(res.data.children ?? []))
      .catch(() => setChildren([]))
  }, [])

  // Greet again whenever the selected child changes.
  useEffect(() => {
    const t = setTimeout(() => void director.runScript(greeting(firstName)), 500)
    return () => {
      clearTimeout(t)
      director.cancelScript()
    }
  }, [director, firstName])

  async function send(raw: string) {
    const text = raw.trim()
    if (!text || busy) return
    director.cancelScript()
    director.say('')
    setInput('')
    setLastChildText(text)
    setBusy(true)
    director.setExpression('listening')
    director.play('ears_perk', { id: 'react-ears' })
    director.play('nod', { id: 'react-head' })
    const thinking = setTimeout(() => {
      director.setExpression('thinking')
      director.play('think', { id: 'waiting', loop: true })
    }, 900)

    const history: BuddyMessage[] = [...messages, { role: 'child', text }]
    setMessages(history)
    const [{ script }] = await Promise.all([
      askBuddy(history, { name: firstName, age: child ? ageInYears(child.dateOfBirth) : undefined }),
      new Promise((r) => setTimeout(r, 1400)),
    ])
    clearTimeout(thinking)
    director.stop('waiting')
    setMessages([...history, { role: 'buddy', text: scriptText(script) }])
    setSuggestions(script.suggestions?.length ? script.suggestions : DEFAULT_SUGGESTIONS)
    setBusy(false)
    void director.runScript(script)
    inputRef.current?.focus()
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    void send(input)
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
          {children.length > 0 && (
            <select
              value={childId}
              onChange={(e) => {
                // A new child starts a new conversation.
                setMessages([])
                setLastChildText(null)
                setParams(e.target.value ? { childId: e.target.value } : {}, { replace: true })
              }}
              className="rounded-2xl bg-white px-3 py-2 text-sm font-bold text-duo-ink shadow-chip outline-none"
              aria-label="Bé đang trò chuyện"
            >
              <option value="">Chọn bé</option>
              {children.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.fullName}
                </option>
              ))}
            </select>
          )}
          {user?.role === 'ADMIN' && (
            <Link to="/admin/buddy" className="btn-duo-ghost !px-3 !py-2 !text-xs">
              Studio
            </Link>
          )}
        </div>
      </header>

      <main className="relative flex min-h-0 flex-1 flex-col items-center justify-end gap-3 px-4 md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:items-center md:gap-6 md:px-10">
        <div className="order-2 flex h-full min-h-0 w-full items-end justify-center md:order-1 md:justify-end">
          <BuddyCharacter frame={frame} className="h-full max-h-[640px] w-auto max-w-full translate-y-8" />
        </div>

        <div className="order-1 flex w-full max-w-xl flex-col gap-3 md:order-2 md:self-center md:pb-24">
          <div className="relative rounded-[28px] bg-white px-6 py-5 shadow-card-hover">
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
          {lastChildText && (
            <div className="self-end rounded-[22px] rounded-br-md bg-[#1E3F9E] px-5 py-3 text-lg font-bold text-white shadow-card">
              {lastChildText}
            </div>
          )}
        </div>
      </main>

      <footer className="relative z-10 rounded-t-[32px] bg-white px-4 pb-5 pt-4 shadow-nav-bar md:px-10">
        <div className="mx-auto max-w-3xl">
          <div className="mb-3 flex flex-wrap justify-center gap-2">
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                disabled={busy}
                onClick={() => void send(s)}
                className="rounded-full bg-[#EEF3FF] px-4 py-2 text-base font-extrabold text-[#1E3F9E] shadow-chip transition hover:bg-[#DCE6FA] disabled:opacity-50"
              >
                {s}
              </button>
            ))}
          </div>
          <form onSubmit={onSubmit} className="flex items-center gap-3">
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              maxLength={300}
              placeholder="Nói gì đó với Bin nhé..."
              className="input-duo !rounded-full !px-6 !py-4 !text-lg"
              aria-label="Tin nhắn cho Bin"
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
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
