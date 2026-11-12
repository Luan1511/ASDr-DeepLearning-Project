/**
 * "Bạn Bin" chat turn through Groq (OpenAI-compatible API). The script format and
 * its validation live in lib/buddyScript.ts.
 */
import { env } from '../lib/env'
import {
  FALLBACK_SCRIPT, buildSystemPrompt, repeatsBuddySpeech, sanitizeBuddyScript, type BuddyChatInput, type BuddyScript,
} from '../lib/buddyScript'

type GroqResponse = { choices?: Array<{ message?: { content?: string | null } }> }

/** Calls Groq once; throws on transport errors, returns null when the reply is unusable. */
async function callGroq(input: BuddyChatInput, signal: AbortSignal, retry = false): Promise<BuddyScript | null> {
  if (!env.GROQ_API_KEY) throw new Error('GROQ_API_KEY is not set')
  const instruction = retry
    ? '\nViết một lời đáp mới nối vào câu cuối, tránh lặp câu đã nói. Giữ câu ngắn và đúng dạng JSON.'
    : ''
  const messages = [
    { role: 'system', content: buildSystemPrompt(input.childAge) + instruction },
    ...input.messages.map((m) => ({ role: m.role === 'child' ? 'user' : 'assistant', content: m.text })),
  ]
  const res = await fetch(`${env.GROQ_BASE_URL.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    signal,
    headers: { Authorization: `Bearer ${env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: env.GROQ_MODEL,
      messages,
      temperature: 0.7,
      max_completion_tokens: 700,
      response_format: { type: 'json_object' },
      ...(env.GROQ_MODEL.startsWith('openai/gpt-oss') ? { reasoning_effort: 'low' } : {}),
    }),
  })
  if (!res.ok) {
    await res.body?.cancel()
    throw new Error(`Groq HTTP ${res.status}`)
  }
  const data = (await res.json()) as GroqResponse
  const content = data.choices?.[0]?.message?.content
  if (!content) return null
  try {
    const reply = JSON.parse(content) as { say?: unknown; suggestions?: unknown } | null
    if (!reply || typeof reply !== 'object') return null
    const suggestions = typeof reply.say === 'string' && reply.say.includes('?') ? reply.suggestions : []
    return sanitizeBuddyScript({ steps: [reply], suggestions })
  } catch {
    return null
  }
}

export async function buddyReply(input: BuddyChatInput, disconnect?: AbortSignal): Promise<{ script: BuddyScript; fallback: boolean }> {
  const deadline = AbortSignal.timeout(env.GROQ_TIMEOUT_MS)
  const signal = disconnect ? AbortSignal.any([disconnect, deadline]) : deadline
  let script: BuddyScript | null = null
  try {
    script = await callGroq(input, signal)
    if (!script || repeatsBuddySpeech(script, input.messages)) {
      const revised = await callGroq(input, signal, true)
      script = revised ?? script
    }
  } catch (err) {
    if (!disconnect?.aborted) console.error('[buddy] Groq call failed:', err instanceof Error ? err.message : err)
  }
  return script ? { script, fallback: false } : { script: FALLBACK_SCRIPT, fallback: true }
}
