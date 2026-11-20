import { api } from '../api'
import { normalizeScript } from './engine'
import type { BuddyScript } from './types'

export type BuddyMessage = { role: 'child' | 'buddy'; text: string }
type BuddyVisionRole = 'child' | 'mother' | 'father' | 'unknown'
export type BuddyVisionCue = 'smile' | 'brow_lowered'
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

/** Bin speaks first: a registered parent sat down next to the child (see lib/buddy/presence.ts). */
export type BuddyEvent = { type: 'arrival'; role: 'mother' | 'father' }

/** `calm`: the child is sensitive to loud sounds, so Bin speaks in its plain voice. */
export type BuddyVoiceStyle = 'calm'

/**
 * One chat turn; never throws (falls back to a canned script). With
 * `personalize`, the backend adds the child's personalisation to the prompt.
 */
export async function askBuddy(
  messages: BuddyMessage[],
  child?: { age?: number; id?: string; personalize?: boolean },
  signal?: AbortSignal,
  vision?: BuddyVisionContext,
  event?: BuddyEvent,
): Promise<{ script: BuddyScript; fallback: boolean; voice?: BuddyVoiceStyle }> {
  try {
    const res = await api.post('/buddy/chat', {
      messages: recentBuddyMessages(messages).map((m) => ({
        role: m.role,
        text: m.role === 'child' ? m.text.slice(0, 500) : m.text,
      })),
      childAge: child?.age || undefined,
      ...(child?.personalize && child.id ? { childId: child.id, personalize: true } : {}),
      ...(event ? { event } : {}),
      vision: vision && {
        people: vision.people.slice(0, 4).map(({ role, cues }) => ({ role, cues })),
        speaker: vision.speaker,
      },
    }, { signal })
    const script = normalizeScript(res.data?.script)
    if (script) {
      return { script, fallback: Boolean(res.data?.fallback), ...(res.data?.voice === 'calm' ? { voice: 'calm' as const } : {}) }
    }
  } catch {
    // fall through
  }
  return { script: UNAVAILABLE_SCRIPT, fallback: true }
}

