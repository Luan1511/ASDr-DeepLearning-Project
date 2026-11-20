import { useEffect, useRef, useState } from 'react'
import { api } from './api'
import { chatErrorMessage } from './chatErrors'

export type ChatSource = { id: string; citation_id?: number; title: string; url: string | null; quotes: string[]; usage?: 'cited' | 'retrieved' }
export type ChatMessage = { id: string; role: 'user' | 'assistant'; content: string; sources?: ChatSource[]; position?: number }
export type ChatConversation = { id: string; title: string; createdAt: string; updatedAt: string }
type MessagePage = { conversation: ChatConversation; messages: ChatMessage[]; nextBefore: number | null }
type ConversationPage = { items: ChatConversation[]; nextCursor: string | null }
type Busy = 'initial' | 'send' | 'open' | 'older' | 'list' | null

function remember(userId: string, id: string) {
  try { sessionStorage.setItem(`aimbrace-chat:${userId}`, id) } catch { /* Storage may be disabled. */ }
}
function remembered(userId: string) {
  try { return sessionStorage.getItem(`aimbrace-chat:${userId}`) } catch { return null }
}

export function useChatHistory(userId: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [conversations, setConversations] = useState<ChatConversation[]>([])
  const [current, setCurrent] = useState<ChatConversation | null>(null)
  const [nextBefore, setNextBefore] = useState<number | null>(null)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [busy, setBusy] = useState<Busy>('initial')
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const locked = useRef(true)
  const epoch = useRef(0)

  useEffect(() => {
    const request = ++epoch.current
    const controller = new AbortController()
    locked.current = true
    async function load() {
      try {
        const { data } = await api.get<ConversationPage>('/chat/conversations', { signal: controller.signal })
        if (epoch.current !== request) return
        setConversations(data.items); setNextCursor(data.nextCursor)
        const saved = remembered(userId)
        const selected = saved === 'new' ? null : saved ?? data.items[0]?.id
        if (selected) {
          try {
            const { data: page } = await api.get<MessagePage>(`/chat/conversations/${encodeURIComponent(selected)}/messages`, { signal: controller.signal })
            if (epoch.current !== request) return
            setCurrent(page.conversation); setMessages(page.messages); setNextBefore(page.nextBefore)
            remember(userId, selected)
          } catch (cause) {
            if ((cause as { response?: { status: number } }).response?.status !== 404) throw cause
            if (epoch.current !== request) return
            setCurrent(null); setMessages([]); setNextBefore(null)
            remember(userId, 'new')
          }
        }
      } catch (cause) {
        if (epoch.current === request) setError(chatErrorMessage(cause))
      } finally {
        if (epoch.current === request) { locked.current = false; setBusy(null) }
      }
    }
    void load()
    return () => { epoch.current = request + 1; controller.abort() }
  }, [userId, retry])

  async function run(kind: Exclude<Busy, null | 'initial'>, task: (isCurrent: () => boolean) => Promise<void>) {
    if (locked.current) return
    locked.current = true
    const request = epoch.current
    const isCurrent = () => epoch.current === request
    setBusy(kind); setError('')
    try { await task(isCurrent) } catch (cause) {
      if (isCurrent()) setError(chatErrorMessage(cause))
    } finally {
      if (isCurrent()) { locked.current = false; setBusy(null) }
    }
  }

  function newChat() {
    if (locked.current) return
    setCurrent(null); setMessages([]); setNextBefore(null); setError('')
    remember(userId, 'new')
  }

  async function openChat(id: string) {
    await run('open', async (isCurrent) => {
      const { data } = await api.get<MessagePage>(`/chat/conversations/${encodeURIComponent(id)}/messages`)
      if (!isCurrent()) return
      setCurrent(data.conversation); setMessages(data.messages); setNextBefore(data.nextBefore)
      remember(userId, id)
    })
  }

  async function olderMessages() {
    if (!current || nextBefore === null) return
    await run('older', async (isCurrent) => {
      const { data } = await api.get<MessagePage>(`/chat/conversations/${encodeURIComponent(current.id)}/messages`, { params: { before: nextBefore } })
      if (!isCurrent()) return
      setMessages((old) => [...data.messages, ...old]); setNextBefore(data.nextBefore)
    })
  }

  async function moreConversations() {
    if (!nextCursor) return
    await run('list', async (isCurrent) => {
      const { data } = await api.get<ConversationPage>('/chat/conversations', { params: { cursor: nextCursor } })
      if (!isCurrent()) return
      setConversations((old) => [...old, ...data.items.filter((item) => !old.some((entry) => entry.id === item.id))])
      setNextCursor(data.nextCursor)
    })
  }

  async function send(text: string): Promise<boolean> {
    const trimmed = text.trim()
    if (!trimmed || locked.current) return false
    let succeeded = false
    await run('send', async (isCurrent) => {
      const optimisticId = `pending-${Date.now()}`
      setMessages((old) => [...old, { id: optimisticId, role: 'user', content: trimmed }])
      try {
        const { data } = await api.post<{ conversation: ChatConversation; messages: ChatMessage[] }>('/chat', {
          message: trimmed, ...(current ? { conversationId: current.id } : {}),
        }, { timeout: 190_000 })
        if (!isCurrent()) return
        setCurrent(data.conversation)
        setMessages((old) => [...old.filter((message) => message.id !== optimisticId), ...data.messages])
        setConversations((old) => [data.conversation, ...old.filter((item) => item.id !== data.conversation.id)])
        remember(userId, data.conversation.id)
        succeeded = true
      } catch (cause) {
        if (isCurrent()) setMessages((old) => old.filter((message) => message.id !== optimisticId))
        throw cause
      }
    })
    return succeeded
  }

  return { messages, conversations, current, nextBefore, nextCursor, busy, error,
    newChat, openChat, olderMessages, moreConversations, send, reload: () => {
      if (locked.current) return
      locked.current = true; setBusy('initial'); setError(''); setRetry((n) => n + 1)
    } }
}
