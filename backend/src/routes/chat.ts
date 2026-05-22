import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../middleware/asyncHandler'
import { answerAsdQuestion } from '../services/chatMock'
import { ChatRole } from '@prisma/client'
import { env } from '../lib/env'

export const chatRouter = Router()

chatRouter.use(requireAuth)

// GET /api/chat/models
chatRouter.get(
  '/models',
  asyncHandler(async (req, res) => {
    try {
      const url = new URL('/chat/models', env.CHAT_API_BASE_URL).toString()
      const response = await fetch(url)
      if (!response.ok) {
        throw new Error(`Failed to fetch models: ${response.status}`)
      }
      const data = await response.json()
      return res.json(data) // e.g. { "models": ["asd_lora_1", "asd_lora_2"] }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Failed to get chat models:', error)
      return res.json({ models: ['asd_lora_1'] }) // default fallback
    }
  }),
)

const chatSchema = z.object({
  message: z.string().min(1),
  modelName: z.string().optional(),
})

chatRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const userId = req.user!.id
    const input = chatSchema.parse(req.body)
    
    // Default model if none selected
    const modelName = input.modelName || 'asd_lora_1'

    // Fetch recent history to build context
    const history = await prisma.chatMessage.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 6, // last 3 pairs
    })
    
    // Build context string from history (oldest first)
    const context = history.reverse().map(msg => `${msg.role === ChatRole.USER ? 'User' : 'Assistant'}: ${msg.content}`).join('\n')

    let reply = ''
    try {
      const url = new URL(`/chat/${modelName}`, env.CHAT_API_BASE_URL).toString()
      
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: input.message,
          context: context,
          max_new_tokens: 512,
          temperature: 0.6,
        }),
      })

      if (!response.ok) {
        const errText = await response.text()
        throw new Error(`Chat API error: ${response.status} - ${errText}`)
      }

      const data = await response.json() as any
      if (data && data.answer) {
        reply = data.answer
      } else {
        throw new Error('Invalid response format from Chat API')
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Chat API failed, falling back to mock:', error)
      reply = answerAsdQuestion(input.message)
    }

    await prisma.chatMessage.createMany({
      data: [
        { userId, role: ChatRole.USER, content: input.message },
        { userId, role: ChatRole.ASSISTANT, content: reply },
      ],
    })

    return res.json({ reply })
  }),
)
