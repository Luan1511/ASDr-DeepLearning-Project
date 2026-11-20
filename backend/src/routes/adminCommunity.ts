import { Router } from 'express'
import { z } from 'zod'
import { UserRole } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { asyncHandler } from '../middleware/asyncHandler'
import { requireAuth } from '../middleware/auth'
import { requireRole } from '../middleware/requireRole'
import { lockCommunityUsers } from '../services/conversation'

export const adminCommunityRouter = Router()
adminCommunityRouter.use(requireAuth, requireRole(UserRole.ADMIN))

adminCommunityRouter.get('/reports', asyncHandler(async (req, res) => {
  const status = z.enum(['OPEN', 'REVIEWING', 'ACTIONED', 'DISMISSED']).optional().parse(req.query.status)
  const reports = await prisma.communityReport.findMany({
    where: status ? { status } : {},
    include: { reporter: { select: { id: true, communityProfile: { select: { displayName: true } } } }, post: { select: { id: true, hiddenAt: true } }, comment: { select: { id: true, hiddenAt: true } }, directMessage: { select: { id: true, hiddenAt: true } }, actions: { orderBy: { createdAt: 'desc' } } },
    orderBy: { createdAt: 'asc' }, take: 100,
  })
  return res.json({ reports: reports.map(({ reporter, ...report }) => ({ ...report, reporter: { id: reporter.id, displayName: reporter.communityProfile?.displayName ?? 'Thành viên' } })) })
}))

const actionSchema = z.object({ action: z.enum(['REVIEWING', 'HIDE', 'RESTORE', 'SUSPEND_AUTHOR', 'UNSUSPEND_AUTHOR', 'DISMISS']), reason: z.string().trim().min(3).max(500) })

adminCommunityRouter.post('/reports/:id/action', asyncHandler(async (req, res) => {
  const input = actionSchema.parse(req.body)
  const report = await prisma.communityReport.findUnique({ where: { id: req.params.id }, include: { post: { select: { id: true, userId: true } }, comment: { select: { id: true, userId: true } }, directMessage: { select: { id: true, senderId: true } } } })
  if (!report) return res.status(404).json({ error: 'REPORT_NOT_FOUND' })
  const authorId = report.post?.userId ?? report.comment?.userId ?? report.directMessage?.senderId
  const targetType = report.postId ? 'POST' : report.commentId ? 'COMMENT' : 'MESSAGE'
  const targetId = report.postId ?? report.commentId ?? report.directMessageId ?? report.id
  const now = new Date()
  await prisma.$transaction(async (tx) => {
    if (authorId) await lockCommunityUsers(tx, [authorId])
    if (input.action === 'HIDE' && report.directMessageId) await tx.communityDirectMessage.update({ where: { id: report.directMessageId }, data: { hiddenAt: now } })
    if (input.action === 'RESTORE' && report.directMessageId) await tx.communityDirectMessage.update({ where: { id: report.directMessageId }, data: { hiddenAt: null } })
    if (input.action === 'HIDE' && report.postId) await tx.communityPost.update({ where: { id: report.postId }, data: { hiddenAt: now } })
    if (input.action === 'HIDE' && report.commentId) await tx.communityComment.update({ where: { id: report.commentId }, data: { hiddenAt: now } })
    if (input.action === 'RESTORE' && report.postId) await tx.communityPost.update({ where: { id: report.postId }, data: { hiddenAt: null } })
    if (input.action === 'RESTORE' && report.commentId) await tx.communityComment.update({ where: { id: report.commentId }, data: { hiddenAt: null } })
    if (input.action === 'SUSPEND_AUTHOR' && authorId) await tx.user.update({ where: { id: authorId }, data: { communitySuspendedAt: now, communitySuspensionReason: input.reason } })
    if (input.action === 'UNSUSPEND_AUTHOR' && authorId) await tx.user.update({ where: { id: authorId }, data: { communitySuspendedAt: null, communitySuspensionReason: null } })
    await tx.communityModerationAction.create({ data: { reportId: report.id, adminId: req.user!.id, action: input.action, targetType: input.action.includes('AUTHOR') ? 'USER' : targetType, targetId: input.action.includes('AUTHOR') ? (authorId ?? report.id) : targetId, reason: input.reason } })
    await tx.communityReport.update({ where: { id: report.id }, data: { status: input.action === 'REVIEWING' ? 'REVIEWING' : input.action === 'DISMISS' ? 'DISMISSED' : 'ACTIONED', reviewedById: req.user!.id, reviewedAt: now, resolution: input.reason } })
  })
  return res.json({ status: input.action === 'REVIEWING' ? 'REVIEWING' : input.action === 'DISMISS' ? 'DISMISSED' : 'ACTIONED' })
}))
