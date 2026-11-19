import { afterEach, expect, it, vi } from 'vitest'
import { AxiosHeaders } from 'axios'
import { api } from '../api'
import { askBuddy, type BuddyMessage } from './api'

afterEach(() => vi.restoreAllMocks())

it('keeps long buddy speech in both the reply and the next turn history', async () => {
  const text = 'Mình kể tiếp chuyện trong khu vườn nha. '.repeat(30).trim()
  const messages: BuddyMessage[] = [
    { role: 'child', text: 'Kể chuyện cho em nghe.' },
    { role: 'buddy', text },
    { role: 'child', text: 'Rồi sao nữa?' },
  ]
  const post = vi.spyOn(api, 'post').mockResolvedValue({
    data: { script: { steps: [{ say: text }] }, fallback: false },
    status: 200,
    statusText: 'OK',
    headers: {},
    config: { headers: new AxiosHeaders() },
  })

  const reply = await askBuddy(messages)

  expect(reply.fallback).toBe(false)
  expect(reply.script.steps[0].say).toBe(text)
  expect(post).toHaveBeenCalledWith('/buddy/chat', expect.objectContaining({ messages }), { signal: undefined })
})
