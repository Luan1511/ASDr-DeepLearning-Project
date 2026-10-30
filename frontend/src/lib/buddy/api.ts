import { api } from '../api'
import { normalizeScript } from './engine'
import type { BuddyScript } from './types'

export type BuddyMessage = { role: 'child' | 'buddy'; text: string }

export const OFFLINE_SCRIPT: BuddyScript = {
  steps: [
    {
      say: 'Ôi, Bin chưa nghe rõ. Bạn nói lại cho Bin nghe nhé!',
      expression: 'thinking',
      gesture: 'shrug',
      ears: 'droop',
    },
  ],
  idle: 'listening',
  suggestions: ['Chào Bin!', 'Kể chuyện đi'],
}

/** One chat turn; never throws (falls back to a canned script). */
export async function askBuddy(
  messages: BuddyMessage[],
  child?: { name?: string; age?: number },
): Promise<{ script: BuddyScript; fallback: boolean }> {
  try {
    const res = await api.post('/buddy/chat', {
      messages: messages.slice(-12).map((m) => ({ role: m.role, text: m.text.slice(0, 500) })),
      childName: child?.name || undefined,
      childAge: child?.age || undefined,
    })
    const script = normalizeScript(res.data?.script)
    if (script) return { script, fallback: Boolean(res.data?.fallback) }
  } catch {
    // fall through
  }
  return { script: OFFLINE_SCRIPT, fallback: true }
}

/** Text of a script as one chat message. */
export function scriptText(script: BuddyScript) {
  return script.steps
    .map((s) => s.say)
    .filter(Boolean)
    .join(' ')
}
