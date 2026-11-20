import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { asyncHandler } from '../middleware/asyncHandler'
import { requireAuth } from '../middleware/auth'
import { lockCommunityUsers } from '../services/conversation'
import { ensureCommunityProfile } from '../services/community'
import type { Prisma } from '@prisma/client'

export const communityConversationsRouter = Router()
communityConversationsRouter.use(requireAuth)
const memberSelect = { id: true, communityProfile: { select: { displayName: true } } } as const
const includeMembers = { memberA: { select: memberSelect }, memberB: { select: memberSelect } } as const
class ChatError extends Error { constructor(public status: number, public code: string, public retryAfter?: number) { super(code) } }
function fail(status: number, code: string): never { throw new ChatError(status, code) }
const action = (fn: (req: any, res: any) => Promise<any>) => asyncHandler(async (req, res) => {
  try { return await fn(req, res) } catch (error) {
    if (!(error instanceof ChatError)) throw error
    if (error.retryAfter) res.setHeader('Retry-After', error.retryAfter)
    return res.status(error.status).json({ error: error.code, retryAfter: error.retryAfter })
  }
})
async function eligible(tx: Prisma.TransactionClient, userId: string) {
  const user = await tx.user.findUnique({ where: { id: userId }, select: { role: true, communitySuspendedAt: true, doctorProfile: { select: { id: true } } } })
  if (!user || user.role !== 'USER' || user.doctorProfile || user.communitySuspendedAt) fail(403, 'CHAT_UNAVAILABLE')
}
async function blocked(tx: Prisma.TransactionClient, a: string, b: string) {
  return Boolean(await tx.communityBlock.findFirst({ where: { OR: [{ blockerId: a, blockedId: b }, { blockerId: b, blockedId: a }] } }))
}
async function writable(tx: Prisma.TransactionClient, a: string, b: string) {
  await lockCommunityUsers(tx, [a, b])
  await eligible(tx, a); await eligible(tx, b)
  if (await blocked(tx, a, b)) fail(403, 'CHAT_UNAVAILABLE')
}
async function owned(tx: Prisma.TransactionClient, id: string, userId: string) {
  const row = await tx.communityConversation.findFirst({ where: { id, OR: [{ memberAId: userId }, { memberBId: userId }] }, include: includeMembers })
  if (!row) fail(404, 'CONVERSATION_NOT_FOUND')
  return row
}
const messageDto = (message: any) => ({ id: message.id, seq: message.seq, senderId: message.senderId, clientRequestId: message.clientRequestId, content: message.hiddenAt ? null : message.content, hidden: Boolean(message.hiddenAt), createdAt: message.createdAt })
async function summary(tx: Prisma.TransactionClient, row: any, userId: string) {
  const other = row.memberAId === userId ? row.memberB : row.memberA
  const [last, unread, sourcePost, unavailableUser, ownBlock] = await Promise.all([
    tx.communityDirectMessage.findFirst({ where: { conversationId: row.id }, orderBy: { seq: 'desc' } }),
    tx.communityDirectMessage.count({ where: { conversationId: row.id, senderId: { not: userId }, seq: { gt: row.memberAId === userId ? row.readSeqA : row.readSeqB } } }),
    row.sourcePostId ? tx.communityPost.findFirst({ where: { id: row.sourcePostId, hiddenAt: null, isAnonymous: false }, select: { id: true, title: true } }) : null,
    tx.user.findUnique({ where: { id: other.id }, select: { communitySuspendedAt: true, role: true, doctorProfile: { select: { id: true } } } }),
    tx.communityBlock.findUnique({ where: { blockerId_blockedId: { blockerId: userId, blockedId: other.id } }, select: { blockerId: true } }),
  ])
  return { id: row.id, status: row.status, inviterId: row.inviterId, isInviter: row.inviterId === userId, blockedByMe: Boolean(ownBlock), peer: { id: other.id, displayName: other.communityProfile?.displayName ?? 'Thành viên' }, unavailable: !unavailableUser || unavailableUser.role !== 'USER' || Boolean(unavailableUser.communitySuspendedAt || unavailableUser.doctorProfile) || await blocked(tx, userId, other.id), sourcePost, unread, lastMessage: last ? messageDto(last) : null, updatedAt: row.updatedAt }
}

communityConversationsRouter.use(asyncHandler(async (req, res, next) => {
  try { await eligible(prisma, req.user!.id); next() }
  catch (error) { if (error instanceof ChatError) return res.status(error.status).json({ error: error.code }); throw error }
}))

communityConversationsRouter.get('/unread', action(async (req, res) => {
  const rows = await prisma.communityConversation.findMany({ where: { OR: [{ memberAId: req.user.id }, { memberBId: req.user.id }] } })
  const counts = await Promise.all(rows.map((row) => prisma.communityDirectMessage.count({ where: { conversationId: row.id, senderId: { not: req.user.id }, seq: { gt: row.memberAId === req.user.id ? row.readSeqA : row.readSeqB } } })))
  return res.json({ unread: counts.reduce((sum, count) => sum + count, 0), invitations: rows.filter((row) => row.status === 'PENDING' && row.inviterId !== req.user.id).length })
}))

communityConversationsRouter.get('/', action(async (req, res) => {
  const page = z.coerce.number().int().min(1).max(10000).default(1).parse(req.query.page)
  const tab = z.enum(['chats', 'requests']).default('chats').parse(req.query.tab)
  const where = { OR: [{ memberAId: req.user.id }, { memberBId: req.user.id }], status: tab === 'chats' ? 'ACCEPTED' : { not: 'ACCEPTED' } }
  const [rows, total] = await Promise.all([prisma.communityConversation.findMany({ where, include: includeMembers, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * 20, take: 20 }), prisma.communityConversation.count({ where })])
  return res.json({ conversations: await Promise.all(rows.map((row) => summary(prisma, row, req.user.id))), page, totalPages: Math.ceil(total / 20) })
}))

communityConversationsRouter.post('/', action(async (req, res) => {
  const input = z.object({ recipientId: z.string().uuid().optional(), postId: z.string().uuid().optional(), content: z.string().trim().min(1).max(500), clientRequestId: z.string().uuid() }).parse(req.body)
  const userId = req.user.id
  let recipientId = input.recipientId
  if (input.postId) {
    const post = await prisma.communityPost.findFirst({ where: { id: input.postId, hiddenAt: null, isAnonymous: false }, select: { userId: true } })
    if (!post) fail(404, 'POST_NOT_FOUND')
    recipientId = post.userId
  }
  if (!recipientId || recipientId === userId) fail(400, 'INVALID_RECIPIENT')
  const peerId = recipientId
  const result = await prisma.$transaction(async (tx) => {
    await writable(tx, userId, peerId)
    const [memberAId, memberBId] = [userId, peerId].sort()
    const existing = await tx.communityConversation.findUnique({ where: { memberAId_memberBId: { memberAId, memberBId } } })
    const duplicate = await tx.communityDirectMessage.findUnique({ where: { senderId_clientRequestId: { senderId: userId, clientRequestId: input.clientRequestId } } })
    if (duplicate) {
      if (!existing || duplicate.conversationId !== existing.id) fail(409, 'REQUEST_CONFLICT')
      return existing
    }
    if (existing && (existing.status === 'ACCEPTED' || existing.status === 'PENDING')) return existing
    if (existing && existing.inviterId === userId) fail(409, 'INVITATION_CLOSED')
    if (input.postId && !await tx.communityPost.findFirst({ where: { id: input.postId, userId: peerId, hiddenAt: null, isAnonymous: false } })) fail(404, 'POST_NOT_FOUND')
    // Count invitation notifications (one per invitation), including reopened requests.
    const invitations = await tx.communityNotification.count({ where: { actorId: userId, type: 'CHAT_INVITATION', createdAt: { gte: new Date(Date.now() - 86400000) } } })
    if (invitations >= 10) throw new ChatError(429, 'INVITATION_RATE_LIMIT', 86400)
    await ensureCommunityProfile(tx, userId, 'Phụ huynh'); await ensureCommunityProfile(tx, peerId, 'Phụ huynh')
    const row = existing ? await tx.communityConversation.update({ where: { id: existing.id }, data: { status: 'PENDING', inviterId: userId, sourcePostId: input.postId ?? null, updatedAt: new Date() } }) : await tx.communityConversation.create({ data: { memberAId, memberBId, inviterId: userId, sourcePostId: input.postId } })
    await tx.communityDirectMessage.create({ data: { conversationId: row.id, senderId: userId, clientRequestId: input.clientRequestId, content: input.content } })
    await tx.communityNotification.create({ data: { userId: peerId, actorId: userId, type: 'CHAT_INVITATION', conversationId: row.id } })
    return row
  })
  return res.status(201).json({ conversationId: result.id })
}))

communityConversationsRouter.get('/peer/:peerId', action(async (req, res) => {
  const [memberAId, memberBId] = [req.user.id, req.params.peerId].sort()
  const row = await prisma.communityConversation.findUnique({ where: { memberAId_memberBId: { memberAId, memberBId } } })
  return res.json({ conversationId: row?.id ?? null, status: row?.status ?? null })
}))

communityConversationsRouter.get('/:id', action(async (req, res) => {
  const row = await owned(prisma, req.params.id, req.user.id)
  return res.json({ conversation: await summary(prisma, row, req.user.id) })
}))

communityConversationsRouter.get('/:id/messages', action(async (req, res) => {
  await owned(prisma, req.params.id, req.user.id)
  const before = z.coerce.number().int().positive().optional().parse(req.query.before)
  const after = z.coerce.number().int().positive().optional().parse(req.query.after)
  if (before && after) fail(400, 'INVALID_CURSOR')
  if (after) {
    const rows = await prisma.communityDirectMessage.findMany({ where: { conversationId: req.params.id, seq: { gt: after } }, orderBy: { seq: 'asc' }, take: 31 })
    return res.json({ messages: rows.slice(0, 30).map(messageDto), nextAfter: rows.length > 30 ? rows[29].seq : null })
  }
  const rows = await prisma.communityDirectMessage.findMany({ where: { conversationId: req.params.id, ...(before ? { seq: { lt: before } } : {}) }, orderBy: { seq: 'desc' }, take: 31 })
  return res.json({ messages: rows.slice(0, 30).reverse().map(messageDto), nextCursor: rows.length > 30 ? rows[29].seq : null })
}))

communityConversationsRouter.post('/:id/action', action(async (req, res) => {
  const input = z.object({ action: z.enum(['ACCEPT', 'DECLINE', 'CANCEL']) }).parse(req.body)
  const initial = await owned(prisma, req.params.id, req.user.id)
  await prisma.$transaction(async (tx) => {
    await writable(tx, initial.memberAId, initial.memberBId)
    const row = await owned(tx, initial.id, req.user.id)
    if (row.status !== 'PENDING') fail(409, 'INVITATION_CLOSED')
    if ((input.action === 'CANCEL') !== (row.inviterId === req.user.id)) fail(403, 'FORBIDDEN')
    await tx.communityConversation.update({ where: { id: row.id }, data: { status: input.action === 'ACCEPT' ? 'ACCEPTED' : input.action === 'DECLINE' ? 'DECLINED' : 'CANCELLED' } })
    if (input.action === 'ACCEPT') await tx.communityNotification.create({ data: { userId: row.inviterId, actorId: req.user.id, type: 'CHAT_ACCEPTED', conversationId: row.id } })
  })
  return res.json({ ok: true })
}))

communityConversationsRouter.post('/:id/messages', action(async (req, res) => {
  const input = z.object({ content: z.string().trim().min(1).max(2000), clientRequestId: z.string().uuid() }).parse(req.body)
  const initial = await owned(prisma, req.params.id, req.user.id)
  const result = await prisma.$transaction(async (tx) => {
    await writable(tx, initial.memberAId, initial.memberBId)
    const row = await owned(tx, initial.id, req.user.id)
    if (row.status !== 'ACCEPTED') fail(409, 'INVITATION_REQUIRED')
    const duplicate = await tx.communityDirectMessage.findUnique({ where: { senderId_clientRequestId: { senderId: req.user.id, clientRequestId: input.clientRequestId } } })
    if (duplicate) { if (duplicate.conversationId !== row.id) fail(409, 'REQUEST_CONFLICT'); return duplicate }
    const recent = await tx.communityDirectMessage.findMany({ where: { senderId: req.user.id, createdAt: { gt: new Date(Date.now() - 60000) } }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } })
    if (recent.length >= 20) throw new ChatError(429, 'MESSAGE_RATE_LIMIT', Math.max(1, Math.ceil((recent[0].createdAt.getTime() + 60000 - Date.now()) / 1000)))
    const message = await tx.communityDirectMessage.create({ data: { ...input, conversationId: row.id, senderId: req.user.id } })
    await tx.communityConversation.update({ where: { id: row.id }, data: { updatedAt: new Date() } })
    return message
  })
  return res.status(201).json({ message: messageDto(result) })
}))

communityConversationsRouter.patch('/:id/read', action(async (req, res) => {
  const input = z.object({ messageId: z.string().uuid() }).parse(req.body)
  const row = await owned(prisma, req.params.id, req.user.id)
  const message = await prisma.communityDirectMessage.findFirst({ where: { id: input.messageId, conversationId: row.id } })
  if (!message) fail(404, 'MESSAGE_NOT_FOUND')
  // Read receipts must not change or roll back the conversation's last activity.
  if (row.memberAId === req.user.id) await prisma.$executeRaw`UPDATE "CommunityConversation" SET "readSeqA" = GREATEST("readSeqA", ${message.seq}) WHERE "id" = ${row.id}`
  else await prisma.$executeRaw`UPDATE "CommunityConversation" SET "readSeqB" = GREATEST("readSeqB", ${message.seq}) WHERE "id" = ${row.id}`
  return res.json({ ok: true })
}))

communityConversationsRouter.post('/:id/messages/:messageId/report', action(async (req, res) => {
  const input = z.object({ reason: z.enum(['HARASSMENT','PRIVACY','MISINFORMATION','SPAM','OTHER']), details: z.string().trim().max(500).default('') }).parse(req.body)
  await owned(prisma, req.params.id, req.user.id)
  const message = await prisma.communityDirectMessage.findFirst({ where: { id: req.params.messageId, conversationId: req.params.id, senderId: { not: req.user.id } }, include: { sender: { select: memberSelect } } })
  if (!message || message.hiddenAt) fail(404, 'MESSAGE_NOT_FOUND')
  const report = await prisma.$transaction(async (tx) => {
    await lockCommunityUsers(tx, [req.user.id])
    const duplicate = await tx.communityReport.findFirst({ where: { reporterId: req.user.id, directMessageId: message.id, status: { in: ['OPEN','REVIEWING'] } } })
    if (duplicate) fail(409, 'ALREADY_REPORTED')
    return tx.communityReport.create({ data: { ...input, reporterId: req.user.id, directMessageId: message.id, contentSnapshot: message.content, authorSnapshot: message.sender.communityProfile?.displayName ?? 'Thành viên' } })
  })
  return res.status(201).json({ reportId: report.id })
}))
