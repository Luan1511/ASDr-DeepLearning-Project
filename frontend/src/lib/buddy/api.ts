import { api } from '../api'
import { normalizeScript } from './engine'
import type { BuddyScript } from './types'

export type BuddyMessage = { role: 'child' | 'buddy'; text: string }
type BuddyVisionRole = 'child' | 'mother' | 'father' | 'unknown'
type BuddyVisionCue = 'smile' | 'brow_lowered' | 'mouth_open'
export type BuddyVisionContext = {
  people: Array<{ role: BuddyVisionRole; cues?: BuddyVisionCue[] }>
  /** Leave unset when the voice turn cannot be attributed independently. */
  speaker?: BuddyVisionRole
}

const MAX_HISTORY_MESSAGES = 32

const UNAVAILABLE_SCRIPT: BuddyScript = {
  steps: [
    {
      say: 'Bin chưa trả lời được lúc này. Mình thử lại nhé.',
      expression: 'listening',
    },
  ],
  idle: 'listening',
  suggestions: [],
}

export function recentBuddyMessages(messages: BuddyMessage[]) {
  const recent = messages.slice(-MAX_HISTORY_MESSAGES)
  return recent[0]?.role === 'buddy' ? recent.slice(1) : recent
}

/** One chat turn; never throws (falls back to a canned script). */
export async function askBuddy(
  messages: BuddyMessage[],
  child?: { age?: number },
  signal?: AbortSignal,
  vision?: BuddyVisionContext,
): Promise<{ script: BuddyScript; fallback: boolean }> {
  try {
    const res = await api.post('/buddy/chat', {
      messages: recentBuddyMessages(messages).map((m) => ({ role: m.role, text: m.text.slice(0, 500) })),
      childAge: child?.age || undefined,
      vision: vision && {
        people: vision.people.slice(0, 4).map(({ role, cues }) => ({ role, cues })),
        speaker: vision.speaker,
      },
    }, { signal })
    const script = normalizeScript(res.data?.script)
    if (script) return { script, fallback: Boolean(res.data?.fallback) }
  } catch {
    // fall through
  }
  return { script: UNAVAILABLE_SCRIPT, fallback: true }
}

