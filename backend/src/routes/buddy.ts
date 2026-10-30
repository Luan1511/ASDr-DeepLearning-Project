import { Router } from 'express'
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

function allow(userId: string, now = Date.now()) {
  const hits = (recent.get(userId) ?? []).filter((t) => now - t < WINDOW_MS)
  if (hits.length >= MAX_PER_WINDOW) {
    recent.set(userId, hits)
    return false
  }
  hits.push(now)
  recent.set(userId, hits)
  return true
}

/**
 * POST /api/buddy/chat — one turn with "bạn Bin". Stateless: the client sends the
 * recent conversation and nothing is stored (it is a child's chat).
 */
buddyRouter.post(
  '/chat',
  asyncHandler(async (req, res) => {
    const input = buddyChatInputSchema.parse(req.body)
    if (!allow(req.user!.id)) return res.status(429).json({ error: 'BUDDY_RATE_LIMITED' })
    const { script, fallback } = await buddyReply(input)
    return res.json({ script, fallback })
  }),
)
