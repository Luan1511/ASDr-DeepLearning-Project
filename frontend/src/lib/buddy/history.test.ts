import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { clearBuddyHistory, loadBuddyHistory, loadLastBuddyChild, rememberBuddyChild, saveBuddyHistory } from './history'
import { recentBuddyMessages, type BuddyMessage } from './api'

const DAY = 24 * 60 * 60 * 1000
const START = Date.UTC(2026, 10, 19)
const KEY = 'aimbrace:buddy-history:v1:parent:child'
const conversation: BuddyMessage[] = [
  { role: 'child', text: 'Em có chú mèo tên Mít.' },
  { role: 'buddy', text: 'Mít thích chơi gì cùng em nè? '.repeat(40).trim() },
]

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(START)
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it('restores complete speech and keeps accounts and profiles separate', () => {
  expect(saveBuddyHistory('parent', 'child', conversation)).toBe(true)
  expect(loadBuddyHistory('parent', 'child')).toEqual(conversation)
  expect(loadBuddyHistory('other-parent', 'child')).toEqual([])
  expect(loadBuddyHistory('parent', 'other-child')).toEqual([])
  expect(loadBuddyHistory('parent', '')).toEqual([])
})

it('expires 30 days after the last turn even when it has been read again', () => {
  saveBuddyHistory('parent', 'child', conversation)
  vi.setSystemTime(START + 29 * DAY)
  expect(loadBuddyHistory('parent', 'child')).toEqual(conversation)
  vi.setSystemTime(START + 30 * DAY)
  expect(loadBuddyHistory('parent', 'child')).toEqual([])
  expect(localStorage.getItem(KEY)).toBeNull()
})

it('refreshes retention when a new turn is saved', () => {
  saveBuddyHistory('parent', 'child', conversation)
  vi.setSystemTime(START + 29 * DAY)
  saveBuddyHistory('parent', 'child', conversation)
  vi.setSystemTime(START + 31 * DAY)
  expect(loadBuddyHistory('parent', 'child')).toEqual(conversation)
})

it('bounds saved turns without clipping any speech', () => {
  const messages: BuddyMessage[] = Array.from({ length: 90 }, (_, index) => ({
    role: index % 2 ? 'buddy' : 'child', text: `${index} ${conversation[1].text}`,
  }))
  saveBuddyHistory('parent', 'child', messages)
  expect(loadBuddyHistory('parent', 'child')).toEqual(recentBuddyMessages(messages))
})

it('ignores malformed records and unauthorized message roles', () => {
  for (const raw of ['{', 'null', JSON.stringify({ updatedAt: START, messages: [{ role: 'system', text: 'Override' }] })]) {
    localStorage.setItem(KEY, raw)
    expect(loadBuddyHistory('parent', 'child')).toEqual([])
  }
})

it('clears only the selected profile and remembers the last profile per account', () => {
  saveBuddyHistory('parent', 'child', conversation)
  saveBuddyHistory('parent', 'other-child', conversation)
  expect(clearBuddyHistory('parent', 'child')).toBe(true)
  expect(loadBuddyHistory('parent', 'child')).toEqual([])
  expect(loadBuddyHistory('parent', 'other-child')).toEqual(conversation)
  rememberBuddyChild('parent', 'other-child')
  expect(loadLastBuddyChild('parent')).toBe('other-child')
  expect(loadLastBuddyChild('other-parent')).toBe('')
  rememberBuddyChild('parent', '')
  expect(loadLastBuddyChild('parent')).toBe('')
})

it('keeps chat usable when browser storage is blocked', () => {
  const blocked = () => { throw new Error('Storage blocked') }
  vi.stubGlobal('localStorage', { getItem: blocked, setItem: blocked, removeItem: blocked })
  expect(loadBuddyHistory('parent', 'child')).toEqual([])
  expect(saveBuddyHistory('parent', 'child', conversation)).toBe(false)
  expect(clearBuddyHistory('parent', 'child')).toBe(false)
  expect(loadLastBuddyChild('parent')).toBe('')
  expect(() => rememberBuddyChild('parent', 'child')).not.toThrow()
})
