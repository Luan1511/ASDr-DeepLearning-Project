import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../middleware/asyncHandler'
import { answerAsdQuestion } from '../services/chatMock'
import { ChatRole } from '@prisma/client'

export const chatRouter = Router()

chatRouter.use(requireAuth)

const chatSchema = z.object({
  message: z.string().min(1),
})

chatRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const userId = req.user!.id
    const input = chatSchema.parse(req.body)

    const reply = answerAsdQuestion(input.message)

    await prisma.chatMessage.createMany({
      data: [
        { userId, role: ChatRole.USER, content: input.message },
        { userId, role: ChatRole.ASSISTANT, content: reply },
      ],
    })

    return res.json({ reply })
  }),
)
