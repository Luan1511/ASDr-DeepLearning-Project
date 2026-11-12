import { api } from '../api'
import { normalizeScript } from './engine'
import type { BuddyScript } from './types'

export type BuddyMessage = { role: 'child' | 'buddy'; text: string }

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
): Promise<{ script: BuddyScript; fallback: boolean }> {
  try {
    const res = await api.post('/buddy/chat', {
      messages: recentBuddyMessages(messages).map((m) => ({ role: m.role, text: m.text.slice(0, 500) })),
      childAge: child?.age || undefined,
    }, { signal })
    const script = normalizeScript(res.data?.script)
    if (script) return { script, fallback: Boolean(res.data?.fallback) }
  } catch {
    // fall through
  }
  return { script: UNAVAILABLE_SCRIPT, fallback: true }
}

