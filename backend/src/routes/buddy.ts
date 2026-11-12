import { raw, Router } from 'express'
import { z } from 'zod'
import { env } from '../lib/env'
import { proxyBuddyVoice } from '../services/buddyVoice'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../middleware/asyncHandler'
import { buddyChatInputSchema } from '../lib/buddyScript'
import { buddyReply } from '../services/buddyChat'

export const buddyRouter = Router()

buddyRouter.use(requireAuth)

// The LLM key is shared by every user: cap each account at a child's chatting pace.
const WINDOW_MS = 60_000
const MAX_PER_WINDOW = 20
const recent = new Map<string, number[]>()

const voiceRecent = new Map<string, number[]>()

function allow(userId: string, bucket = recent, limit = MAX_PER_WINDOW, now = Date.now()) {
  const hits = (bucket.get(userId) ?? []).filter((t) => now - t < WINDOW_MS)
  if (hits.length >= limit) {
    bucket.set(userId, hits)
    return false
  }
  hits.push(now)
  bucket.set(userId, hits)
  return true
}

const audioTypes = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/wav']
const utterance = z.object({ text: z.string().trim().min(1).max(160) })

buddyRouter.get('/voice', (_req, res) => res.json({ enabled: Boolean(env.BUDDY_VOICE_URL) }))

buddyRouter.post(
  '/voice/transcribe',
  raw({ type: audioTypes, limit: '1mb', inflate: false }),
  asyncHandler(async (req, res) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) {
      return res.status(400).json({ error: 'BUDDY_VOICE_INVALID_INPUT' })
    }
    if (!allow(req.user!.id, voiceRecent, 50)) return res.status(429).json({ error: 'BUDDY_VOICE_BUSY' })
    await proxyBuddyVoice(res, '/transcribe', Uint8Array.from(req.body), req.get('Content-Type') ?? 'application/octet-stream')
  }),
)

buddyRouter.post(
  '/voice/speak',
  asyncHandler(async (req, res) => {
    const input = utterance.parse(req.body)
    if (!allow(req.user!.id, voiceRecent, 50)) return res.status(429).json({ error: 'BUDDY_VOICE_BUSY' })
    await proxyBuddyVoice(res, '/speak', JSON.stringify(input), 'application/json')
  }),
)

/**
 * POST /api/buddy/chat — one turn with "bạn Bin". Stateless: the client sends the
 * recent conversation and nothing is stored (it is a child's chat).
 */
buddyRouter.post(
  '/chat',
  asyncHandler(async (req, res) => {
    const input = buddyChatInputSchema.parse(req.body)
    if (!allow(req.user!.id)) return res.status(429).json({ error: 'BUDDY_RATE_LIMITED' })
    const disconnect = new AbortController()
    const close = () => disconnect.abort()
    res.once('close', close)
    try {
      const result = await buddyReply(input, disconnect.signal)
      if (!disconnect.signal.aborted) return res.json(result)
    } finally {
      res.off('close', close)
    }
  }),
)
