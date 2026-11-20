import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { BUDDY_PERSONALIZE_VERSION, loadBuddyPersonalize, saveBuddyPersonalize } from './personalizeConsent'

let store: Map<string, string>

beforeEach(() => {
  store = new Map()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

it('is off until the parent turns it on, and per child', () => {
  expect(loadBuddyPersonalize('u1', 'c1')).toBe(false)
  expect(saveBuddyPersonalize('u1', 'c1', true)).toBe(true)
  expect(loadBuddyPersonalize('u1', 'c1')).toBe(true)
  expect(loadBuddyPersonalize('u1', 'c2')).toBe(false)
  expect(loadBuddyPersonalize('u2', 'c1')).toBe(false)
})

it('turning it off forgets the choice', () => {
  saveBuddyPersonalize('u1', 'c1', true)
  saveBuddyPersonalize('u1', 'c1', false)
  expect(loadBuddyPersonalize('u1', 'c1')).toBe(false)
  expect(store.size).toBe(0)
})

it('asks again when the notice version changes or the value is unreadable', () => {
  saveBuddyPersonalize('u1', 'c1', true)
  const [key] = [...store.keys()]
  store.set(key, JSON.stringify({ version: 'older', on: true }))
  expect(loadBuddyPersonalize('u1', 'c1')).toBe(false)
  store.set(key, '{not json')
  expect(loadBuddyPersonalize('u1', 'c1')).toBe(false)
  store.set(key, JSON.stringify({ version: BUDDY_PERSONALIZE_VERSION, on: true }))
  expect(loadBuddyPersonalize('u1', 'c1')).toBe(true)
})

it('reports a browser that refuses to store', () => {
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: () => { throw new Error('quota') },
    removeItem: () => undefined,
  })
  expect(saveBuddyPersonalize('u1', 'c1', true)).toBe(false)
  expect(loadBuddyPersonalize('', 'c1')).toBe(false)
})
