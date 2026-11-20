import { raw, Router, type Response } from 'express'
import { z } from 'zod'
import { env } from '../lib/env'
import { proxyBuddyVoice } from '../services/buddyVoice'
import { DeepgramError, transcribeWithDeepgram } from '../services/deepgramStt'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../middleware/asyncHandler'
import { buddyChatInputSchema, buddyProfileFrom, buddyVoiceStyle, type BuddyChildProfile } from '../lib/buddyScript'
import { buddyReply } from '../services/buddyChat'
import { loadPersonalization } from './childPersonalization'
import { findOwnedChild } from './exercises'

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
// `calm`: plain voice for a child sensitive to loud sounds (see buddyVoiceStyle).
const utterance = z.object({ text: z.string().trim().min(1), calm: z.boolean().optional() })

// `stt` tells the page who turns speech into text, so the parent notice names it.
buddyRouter.get('/voice', (_req, res) => res.json({
  enabled: Boolean(env.BUDDY_VOICE_URL),
  stt: env.DEEPGRAM_API_KEY ? 'deepgram' : 'local',
}))

/** Deepgram turn: same answers as the local service ({ text } or a BUDDY_VOICE_* error). */
async function transcribeTurn(res: Response, audio: Uint8Array<ArrayBuffer>, contentType: string) {
  const disconnect = new AbortController()
  const close = () => disconnect.abort()
  res.once('close', close)
  try {
    const text = await transcribeWithDeepgram(audio, contentType, {
      apiKey: env.DEEPGRAM_API_KEY!,
      model: env.DEEPGRAM_MODEL,
      signal: AbortSignal.any([disconnect.signal, AbortSignal.timeout(env.DEEPGRAM_TIMEOUT_MS)]),
    })
    if (!res.destroyed) res.json({ text: text.slice(0, 300) })
  } catch (error) {
    if (disconnect.signal.aborted || res.headersSent || res.destroyed) return
    const status = error instanceof DeepgramError ? error.status : 0
    if (status === 429) return res.status(429).json({ error: 'BUDDY_VOICE_BUSY' })
    if (status === 400 || status === 413) return res.status(422).json({ error: 'BUDDY_VOICE_INVALID_INPUT' })
    // eslint-disable-next-line no-console
    console.error('Deepgram transcription failed:', status || (error instanceof Error ? error.name : 'unknown'))
    return res.status(502).json({ error: 'BUDDY_VOICE_UNAVAILABLE' })
  } finally {
    res.off('close', close)
  }
}

buddyRouter.post(
  '/voice/transcribe',
  raw({ type: audioTypes, limit: '1mb', inflate: false }),
  asyncHandler(async (req, res) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) {
      return res.status(400).json({ error: 'BUDDY_VOICE_INVALID_INPUT' })
    }
    if (!allow(req.user!.id, voiceRecent, 50)) return res.status(429).json({ error: 'BUDDY_VOICE_BUSY' })
    const audio = Uint8Array.from(req.body)
    const contentType = req.get('Content-Type') ?? 'application/octet-stream'
    if (env.DEEPGRAM_API_KEY) return transcribeTurn(res, audio, contentType)
    await proxyBuddyVoice(res, '/transcribe', audio, contentType)
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
 * recent conversation and nothing is stored (it is a child's chat). With
 * `personalize` (the parent's choice on the Bin page) the child's personalisation
 * is read here, for the owner only, and goes into the prompt of this turn.
 */
buddyRouter.post(
  '/chat',
  asyncHandler(async (req, res) => {
    const input = buddyChatInputSchema.parse(req.body)
    if (!allow(req.user!.id)) return res.status(429).json({ error: 'BUDDY_RATE_LIMITED' })
    let profile: BuddyChildProfile | undefined
    if (input.personalize && input.childId) {
      const child = await findOwnedChild(input.childId, req.user!.id)
      if (!child) return res.status(404).json({ error: 'CHILD_NOT_FOUND' })
      profile = buddyProfileFrom(await loadPersonalization(child.id))
    }
    const disconnect = new AbortController()
    const close = () => disconnect.abort()
    res.once('close', close)
    try {
      const result = await buddyReply(input, disconnect.signal, profile)
      const voice = buddyVoiceStyle(profile)
      if (!disconnect.signal.aborted) return res.json(voice ? { ...result, voice } : result)
    } finally {
      res.off('close', close)
    }
  }),
)
