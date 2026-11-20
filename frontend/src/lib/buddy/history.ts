import { recentBuddyMessages, type BuddyMessage } from './api'

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000

function historyKey(userId: string, childId: string) {
  return `aimbrace:buddy-history:v1:${encodeURIComponent(userId)}:${encodeURIComponent(childId)}`
}

/** Parents Bin already greeted in this conversation (see lib/buddy/presence.ts); cleared with the history. */
function greetedKey(userId: string, childId: string) {
  return `aimbrace:buddy-greeted:v1:${encodeURIComponent(userId)}:${encodeURIComponent(childId)}`
}

const PARENT_ROLES = ['mother', 'father'] as const
export type GreetedParent = (typeof PARENT_ROLES)[number]

export function loadGreetedParents(userId: string, childId: string): GreetedParent[] {
  if (!userId) return []
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(greetedKey(userId, childId)) ?? '[]')
    return Array.isArray(saved) ? PARENT_ROLES.filter((role) => saved.includes(role)) : []
  } catch {
    return []
  }
}

export function rememberGreetedParent(userId: string, childId: string, role: GreetedParent): boolean {
  if (!userId) return false
  try {
    const roles = new Set(loadGreetedParents(userId, childId)).add(role)
    localStorage.setItem(greetedKey(userId, childId), JSON.stringify([...roles]))
    return true
  } catch {
    return false
  }
}

function profileKey(userId: string) {
  return `aimbrace:buddy-last-child:v1:${encodeURIComponent(userId)}`
}

export function loadBuddyHistory(userId: string, childId: string): BuddyMessage[] {
  if (!userId) return []
  try {
    const raw = localStorage.getItem(historyKey(userId, childId))
    if (!raw) return []
    const record: unknown = JSON.parse(raw)
    if (!record || typeof record !== 'object') return []
    const { updatedAt, messages } = record as { updatedAt?: unknown; messages?: unknown }
    if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt)) return []
    if (Date.now() - updatedAt >= RETENTION_MS || updatedAt > Date.now()) {
      clearBuddyHistory(userId, childId)
      return []
    }
    if (!Array.isArray(messages) || !messages.every((message): message is BuddyMessage =>
      !!message && typeof message === 'object'
      && (message.role === 'child' || message.role === 'buddy')
      && typeof message.text === 'string' && message.text.trim().length > 0,
    )) return []
    return recentBuddyMessages(messages)
  } catch {
    return []
  }
}

export function saveBuddyHistory(userId: string, childId: string, messages: BuddyMessage[]): boolean {
  if (!userId) return false
  try {
    localStorage.setItem(historyKey(userId, childId), JSON.stringify({
      updatedAt: Date.now(),
      messages: recentBuddyMessages(messages),
    }))
    return true
  } catch {
    return false
  }
}

export function clearBuddyHistory(userId: string, childId: string): boolean {
  if (!userId) return false
  try {
    localStorage.removeItem(historyKey(userId, childId))
    localStorage.removeItem(greetedKey(userId, childId))
    return true
  } catch {
    return false
  }
}

export function loadLastBuddyChild(userId: string): string {
  if (!userId) return ''
  try {
    return localStorage.getItem(profileKey(userId)) ?? ''
  } catch {
    return ''
  }
}

export function rememberBuddyChild(userId: string, childId: string): void {
  if (!userId) return
  try {
    localStorage.setItem(profileKey(userId), childId)
  } catch {
    // Profile selection stays usable while storage is unavailable.
  }
}
