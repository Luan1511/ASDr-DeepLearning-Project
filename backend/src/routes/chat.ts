import { Router } from 'express'
import { z } from 'zod'
import { Prisma, ChatRole } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../middleware/asyncHandler'
import { answerRag, ChatServiceError } from '../services/chatRag'

export const chatRouter = Router()
chatRouter.use(requireAuth)
chatRouter.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next() })

const conversationIdSchema = z.string().min(1).max(100)
const chatSchema = z.object({
  message: z.string().trim().min(1).max(2000),
  conversationId: conversationIdSchema.optional(),
})
const summarySelect = { id: true, title: true, createdAt: true, updatedAt: true } as const
const messageSelect = { id: true, role: true, content: true, sources: true, createdAt: true, position: true } as const
const serializeMessage = (message: { role: ChatRole; sources: Prisma.JsonValue } & Record<string, unknown>) => ({
  ...message,
  role: message.role === ChatRole.USER ? 'user' : 'assistant',
  sources: Array.isArray(message.sources) ? message.sources : [],
})

chatRouter.get('/conversations', asyncHandler(async (req, res) => {
  const { cursor } = z.object({ cursor: conversationIdSchema.optional() }).parse(req.query)
  const userId = req.user!.id
  if (cursor && !await prisma.chatConversation.findFirst({ where: { id: cursor, userId }, select: { id: true } })) {
    return res.status(404).json({ message: 'Không tìm thấy cuộc trò chuyện.' })
  }
  const rows = await prisma.chatConversation.findMany({
    where: { userId }, select: summarySelect,
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], take: 21,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  })
  const items = rows.slice(0, 20)
  return res.json({ items, nextCursor: rows.length > 20 ? items[items.length - 1].id : null })
}))

chatRouter.get('/conversations/:id/messages', asyncHandler(async (req, res) => {
  const id = conversationIdSchema.parse(req.params.id)
  const { before } = z.object({ before: z.coerce.number().int().positive().optional() }).parse(req.query)
  const conversation = await prisma.chatConversation.findFirst({
    where: { id, userId: req.user!.id }, select: summarySelect,
  })
  if (!conversation) return res.status(404).json({ message: 'Không tìm thấy cuộc trò chuyện.' })
  const rows = await prisma.chatMessage.findMany({
    where: { conversationId: id, userId: req.user!.id, ...(before ? { position: { lt: before } } : {}) },
    select: messageSelect, orderBy: { position: 'desc' }, take: 51,
  })
  const messages = rows.slice(0, 50).reverse()
  return res.json({ conversation, messages: messages.map(serializeMessage), nextBefore: rows.length > 50 ? messages[0].position : null })
}))

chatRouter.post('/', asyncHandler(async (req, res) => {
  const userId = req.user!.id
  const input = chatSchema.parse(req.body)
  const conversation = input.conversationId ? await prisma.chatConversation.findFirst({
    where: { id: input.conversationId, userId },
  }) : null
  if (input.conversationId && !conversation) return res.status(404).json({ message: 'Không tìm thấy cuộc trò chuyện.' })
  const previous = conversation ? await prisma.chatMessage.findMany({
    where: { conversationId: conversation.id, userId }, orderBy: { position: 'desc' }, take: 4,
  }) : []
  const lastPosition = previous[0]?.position ?? 0
  const history = previous.reverse().map(({ role, content }) => ({
    role: role === ChatRole.USER ? 'user' as const : 'assistant' as const, content: content.slice(0, 4000),
  }))
  try {
    const result = await answerRag(input.message, history)
    const saved = await prisma.$transaction(async (tx) => {
      let active
      if (conversation) {
        // Reject parallel turns rather than mixing answers based on stale context.
        const changed = await tx.chatConversation.updateMany({
          where: { id: conversation.id, userId, revision: conversation.revision },
          data: { revision: { increment: 1 }, updatedAt: new Date() },
        })
        if (!changed.count) throw new ChatServiceError(409, 'Cuộc trò chuyện vừa có tin nhắn mới. Bạn mở lại cuộc chat rồi gửi tiếp nhé.')
        active = await tx.chatConversation.findUniqueOrThrow({ where: { id: conversation.id }, select: summarySelect })
      } else {
        active = await tx.chatConversation.create({
          data: { userId, title: Array.from(input.message.replace(/\s+/g, ' ')).slice(0, 80).join(''), revision: 1 }, select: summarySelect,
        })
      }
      const userMessage = await tx.chatMessage.create({
        data: { userId, conversationId: active.id, position: lastPosition + 1, role: ChatRole.USER, content: input.message }, select: messageSelect,
      })
      const assistantMessage = await tx.chatMessage.create({
        data: { userId, conversationId: active.id, position: lastPosition + 2, role: ChatRole.ASSISTANT, content: result.reply, sources: result.sources }, select: messageSelect,
      })
      return { conversation: active, messages: [userMessage, assistantMessage].map(serializeMessage) }
    })
    return res.json({ ...result, ...saved })
  } catch (error) {
    if (error instanceof ChatServiceError) return res.status(error.status).json({ error: error.code, message: error.message })
    throw error
  }
}))
