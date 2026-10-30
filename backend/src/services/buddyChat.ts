/**
 * "Bạn Bin" chat turn through Groq (OpenAI-compatible API). The script format and
 * its validation live in lib/buddyScript.ts.
 */
import { env } from '../lib/env'
import { FALLBACK_SCRIPT, buildSystemPrompt, sanitizeBuddyScript, type BuddyChatInput, type BuddyScript } from '../lib/buddyScript'

type GroqResponse = { choices?: Array<{ message?: { content?: string | null } }> }

/** Calls Groq once; throws on transport errors, returns null when the reply is unusable. */
async function callGroq(input: BuddyChatInput): Promise<BuddyScript | null> {
  if (!env.GROQ_API_KEY) throw new Error('GROQ_API_KEY is not set')
  const messages = [
    { role: 'system', content: buildSystemPrompt(input.childName, input.childAge) },
    ...input.messages.map((m) => ({ role: m.role === 'child' ? 'user' : 'assistant', content: m.text })),
  ]
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), env.GROQ_TIMEOUT_MS)
  try {
    const res = await fetch(`${env.GROQ_BASE_URL.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
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
    if (!res.ok) throw new Error(`Groq HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)
    const data = (await res.json()) as GroqResponse
    const content = data.choices?.[0]?.message?.content
    if (!content) return null
    try {
      return sanitizeBuddyScript(JSON.parse(content))
    } catch {
      return null
    }
  } finally {
    clearTimeout(timer)
  }
}

export async function buddyReply(input: BuddyChatInput): Promise<{ script: BuddyScript; fallback: boolean }> {
  try {
    const script = (await callGroq(input)) ?? (await callGroq(input))
    if (script) return { script, fallback: false }
  } catch (err) {
    console.error('[buddy] Groq call failed:', err instanceof Error ? err.message : err)
  }
  return { script: FALLBACK_SCRIPT, fallback: true }
}
