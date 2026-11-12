import type { Response } from 'express'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { env } from '../lib/env'

export async function proxyBuddyVoice(
  res: Response,
  path: '/transcribe' | '/speak',
  body: Uint8Array<ArrayBuffer> | string,
  contentType: string,
) {
  if (!env.BUDDY_VOICE_URL) return res.status(503).json({ error: 'BUDDY_VOICE_DISABLED' })

  const disconnect = new AbortController()
  const close = () => disconnect.abort()
  res.once('close', close)
  try {
    const upstream = await fetch(`${env.BUDDY_VOICE_URL.replace(/\/$/, '')}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body,
      signal: AbortSignal.any([disconnect.signal, AbortSignal.timeout(25_000)]),
    })
    if (!upstream.ok || !upstream.body) {
      await upstream.body?.cancel()
      if (upstream.status === 429) return res.status(429).json({ error: 'BUDDY_VOICE_BUSY' })
      if (upstream.status === 413 || upstream.status === 422) {
        return res.status(upstream.status).json({ error: 'BUDDY_VOICE_INVALID_INPUT' })
      }
      return res.status(502).json({ error: 'BUDDY_VOICE_UNAVAILABLE' })
    }

    if (path === '/transcribe') {
      const data = (await upstream.json()) as { text?: unknown }
      return res.json({ text: typeof data.text === 'string' ? data.text.slice(0, 300) : '' })
    }
    res.set({
      'Content-Type': 'application/octet-stream',
      'Cache-Control': 'no-store, no-transform',
      'X-Accel-Buffering': 'no',
    })
    await pipeline(Readable.fromWeb(upstream.body as import('node:stream/web').ReadableStream), res)
  } catch {
    if (!disconnect.signal.aborted && !res.headersSent && !res.destroyed) {
      return res.status(502).json({ error: 'BUDDY_VOICE_UNAVAILABLE' })
    }
    if (!res.destroyed) res.destroy()
  } finally {
    res.off('close', close)
  }
}
