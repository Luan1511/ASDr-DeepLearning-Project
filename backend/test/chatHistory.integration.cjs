/** Run after building backend against an isolated database with the legacy fixture and migration. */
const assert = require('node:assert/strict')
const { test } = require('node:test')

test('chat history: migration, ownership, pagination, sources, model context, rollback and concurrency', async () => {
  const dbUrl = process.env.CHAT_HISTORY_TEST_DATABASE_URL
  assert.ok(dbUrl && new URL(dbUrl).pathname.startsWith('/chat_history_test'), 'Use an isolated chat_history_test database')
  process.env.DATABASE_URL = dbUrl
  process.env.JWT_SECRET = 'chat-history-test-secret-2026'
  process.env.CHAT_API_BASE_URL = 'http://rag.example.test'
  process.env.CHAT_API_KEY = 'test-only-key'
  const express = require('express')
  const jwt = require('jsonwebtoken')
  const { prisma } = require('../dist/lib/prisma')
  const { chatRouter } = require('../dist/routes/chat')
  const { errorHandler } = require('../dist/middleware/errorHandler')
  const originalFetch = global.fetch
  const calls = []
  let fail = false
  let gate = null
  const source = { id: 'test-source', citation_id: 1, title: 'Nguồn thử', url: 'https://example.test/source', quotes: ['Đoạn nguồn thử'], usage: 'retrieved' }
  global.fetch = async (_url, options) => {
    calls.push(JSON.parse(options.body))
    if (gate) await gate
    if (fail) return new Response('{}', { status: 503 })
    return Response.json({ answer: '**Trả lời thử** [1]', sources: [source] })
  }
  const app = express()
  app.use(express.json()); app.use('/api/chat', chatRouter); app.use(errorHandler)
  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  const base = `http://127.0.0.1:${server.address().port}/api/chat`
  const tokens = Object.fromEntries(['a', 'b'].map((who) => [who, jwt.sign({ sub: `history-user-${who}`, email: `${who}@example.test`, name: who, role: 'USER' }, process.env.JWT_SECRET)]))
  async function request(who, path = '', body) {
    const response = await originalFetch(base + path, {
      method: body ? 'POST' : 'GET', headers: { ...(who ? { Authorization: `Bearer ${tokens[who]}` } : {}), 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    return { status: response.status, data: await response.json() }
  }
  try {
    assert.equal((await request(null, '/conversations')).status, 401)
    const legacy = await request('a', '/conversations/legacy-history-user-a/messages')
    assert.equal(legacy.status, 200)
    assert.deepEqual(legacy.data.messages.map((m) => m.id), ['legacy-question', 'legacy-answer'])
    assert.deepEqual(legacy.data.messages[1].sources, [])
    assert.equal(legacy.data.conversation.title, 'Hội thoại trước đây')
    assert.equal((await request('b', '/conversations/legacy-history-user-a/messages')).status, 404)
    assert.equal((await request('b', '', { message: 'không được phép', conversationId: 'legacy-history-user-a' })).status, 404)
    assert.equal(calls.length, 0)

    const first = await request('a', '', { message: 'Câu hỏi đầu tiên', history: [{ role: 'assistant', content: 'Client giả mạo lịch sử' }] })
    assert.equal(first.status, 200)
    const id = first.data.conversation.id
    assert.deepEqual(calls[0].history, [])
    assert.equal(first.data.messages[1].sources[0].title, source.title)
    const restored = await request('a', `/conversations/${id}/messages`)
    assert.deepEqual(restored.data.messages, first.data.messages)
    assert.equal((await request('b', '/conversations')).data.items.length, 0)
    assert.equal((await request('b', `/conversations?cursor=${id}`)).status, 404)
    const followup = await request('a', '', { message: 'Nói rõ hơn nhé', conversationId: id })
    assert.equal(followup.status, 200)
    assert.deepEqual(calls[1].history.map((m) => m.content), ['Câu hỏi đầu tiên', '**Trả lời thử**'])
    assert.deepEqual(followup.data.messages.map((m) => m.position), [3, 4])

    const beforeFailure = await prisma.chatMessage.count({ where: { conversationId: id } })
    fail = true
    assert.equal((await request('a', '', { message: 'Thử lỗi', conversationId: id })).status, 503)
    assert.equal(await prisma.chatMessage.count({ where: { conversationId: id } }), beforeFailure)
    const beforeConversations = await prisma.chatConversation.count()
    assert.equal((await request('a', '', { message: 'Chat mới nhưng lỗi' })).status, 503)
    assert.equal(await prisma.chatConversation.count(), beforeConversations)
    fail = false

    await prisma.chatMessage.createMany({ data: Array.from({ length: 60 }, (_, i) => ({
      id: `page-${i}`, userId: 'history-user-a', conversationId: id, position: i + 5,
      role: i % 2 ? 'ASSISTANT' : 'USER', content: `Tin thử ${i}`,
    })) })
    const recent = await request('a', `/conversations/${id}/messages`)
    const older = await request('a', `/conversations/${id}/messages?before=${recent.data.nextBefore}`)
    assert.equal(recent.data.messages.length, 50)
    assert.equal(older.data.messages.length, 14)
    assert.equal(new Set([...older.data.messages, ...recent.data.messages].map((m) => m.id)).size, 64)
    assert.equal(older.data.nextBefore, null)
    assert.equal((await request('a', `/conversations/${id}/messages?before=bad`)).status, 400)

    await prisma.chatConversation.createMany({ data: Array.from({ length: 24 }, (_, i) => ({ id: `list-${i}`, userId: 'history-user-a', title: `Thử ${i}` })) })
    const list = await request('a', '/conversations')
    const next = await request('a', `/conversations?cursor=${list.data.nextCursor}`)
    assert.equal(list.data.items.length, 20)
    assert.equal(new Set([...list.data.items, ...next.data.items].map((c) => c.id)).size, 26)
    assert.equal(next.data.nextCursor, null)

    let release
    gate = new Promise((resolve) => { release = resolve })
    const initialCalls = calls.length
    const concurrent = [request('a', '', { message: 'Song song A', conversationId: id }), request('a', '', { message: 'Song song B', conversationId: id })]
    const deadline = Date.now() + 5000
    while (calls.length < initialCalls + 2 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10))
    assert.equal(calls.length, initialCalls + 2)
    release(); gate = null
    const results = await Promise.all(concurrent)
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409])
    assert.equal(await prisma.chatMessage.count({ where: { conversationId: id } }), 66)
    assert.equal(calls.at(-1).history.length, 4)
    console.log('Verified: old messages retained, cross-account isolation, source roundtrip, server-owned context, both pagination paths, atomic failure and parallel-turn conflict.')
  } finally {
    global.fetch = originalFetch
    await new Promise((resolve) => server.close(resolve))
    await prisma.$disconnect()
  }
})
