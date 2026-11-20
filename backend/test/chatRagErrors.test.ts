import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.DATABASE_URL = 'postgresql://unused@localhost/test'
process.env.JWT_SECRET = 'test-only-secret-for-chat-errors'
process.env.CHAT_API_BASE_URL = 'https://rag.example.test'
process.env.CHAT_API_KEY = 'test-only-key'

test('maps safe RAG error codes, preserves history and does not expose upstream text', async () => {
  const { answerRag, ChatServiceError } = await import('../src/services/chatRag')
  const originalFetch = globalThis.fetch
  const originalWarn = console.warn
  const logs: unknown[][] = []
  console.warn = (...args: unknown[]) => { logs.push(args) }
  try {
    for (const [code, status, fragment] of [
      ['CHAT_CITATION_ERROR', 503, 'nguồn'],
      ['CHAT_LANGUAGE_ERROR', 503, 'tiếng Việt'], ['CHAT_MODEL_OUTPUT_ERROR', 503, 'hoàn tất'],
      ['CHAT_TIMEOUT', 503, 'lâu hơn'], ['CHAT_UPSTREAM_ERROR', 503, 'Dịch vụ AI'],
      ['CHAT_INTERNAL_ERROR', 503, 'xử lý'],
    ] as const) {
      globalThis.fetch = async () => Response.json({ detail: { code, message: 'private upstream text' } }, { status: 503 })
      await assert.rejects(answerRag('Câu hỏi thử', []), (error: unknown) => {
        assert.ok(error instanceof ChatServiceError)
        assert.equal(error.status, status); assert.equal(error.code, code)
        assert.ok(error.message.includes(fragment)); assert.ok(!error.message.includes('private'))
        return true
      })
    }
    globalThis.fetch = async () => Response.json({ detail: { code: '__proto__', message: 'private upstream text' } }, { status: 500 })
    await assert.rejects(answerRag('hi', []), (error: unknown) => error instanceof ChatServiceError && error.code === 'CHAT_SERVICE_UNAVAILABLE')
    globalThis.fetch = async () => new Response('private non-JSON text', { status: 429 })
    await assert.rejects(answerRag('hi', []), (error: unknown) => error instanceof ChatServiceError && error.status === 429)
    globalThis.fetch = async () => { throw new DOMException('private timeout', 'TimeoutError') }
    await assert.rejects(answerRag('hi', []), (error: unknown) => error instanceof ChatServiceError && error.code === 'CHAT_TIMEOUT')
    globalThis.fetch = async (_url, options) => {
      assert.deepEqual(JSON.parse(options!.body as string).history, [{ role: 'user', content: 'ASD là gì?' }])
      return Response.json({ answer: 'Câu trả lời thử', sources: [] })
    }
    assert.equal((await answerRag('Dấu hiệu sớm?', [{ role: 'user', content: 'ASD là gì?' }])).reply, 'Câu trả lời thử')
    for (const sources of [[], [{ id: 's', citation_id: 2, title: 'Source', url: null, quotes: ['Quote'] }]]) {
      globalThis.fetch = async () => Response.json({ answer: 'Nội dung dẫn [1].', sources })
      const result = await answerRag('Cách sàng lọc?', []); assert.equal(result.reply, 'Nội dung dẫn .'); assert.deepEqual(result.sources, sources)
    }
    const source = { id: 's', citation_id: 1, title: 'Real Source', url: 'https://example.test/asd', quotes: ['Retrieved quote'] }
    globalThis.fetch = async () => Response.json({ answer: 'Nội dung có nguồn [1].', sources: [source] })
    assert.deepEqual((await answerRag('Cách sàng lọc?', [])).sources, [source])
    assert.ok(!JSON.stringify(logs).includes('private'))
  } finally { globalThis.fetch = originalFetch; console.warn = originalWarn }
})

test('chat HTTP returns JSON 503 for model language rejection before any database write', async () => {
  const express = (await import('express')).default
  const jwt = (await import('jsonwebtoken')).default
  const { chatRouter } = await import('../src/routes/chat')
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => Response.json({ detail: { code: 'CHAT_LANGUAGE_ERROR' } }, { status: 502 })
  const app = express()
  app.use(express.json()); app.use('/api/chat', chatRouter)
  const server = app.listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.once('listening', resolve))
  try {
    const port = (server.address() as { port: number }).port
    const token = jwt.sign({ sub: 'synthetic-test-user', email: 'test@example.test', name: 'Test', role: 'USER' }, process.env.JWT_SECRET!)
    const response = await originalFetch(`http://127.0.0.1:${port}/api/chat`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Dấu hiệu sớm?' }),
    })
    assert.equal(response.status, 503)
    assert.ok(response.headers.get('content-type')?.includes('application/json'))
    assert.equal((await response.json()).error, 'CHAT_LANGUAGE_ERROR')
  } finally {
    globalThis.fetch = originalFetch
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
