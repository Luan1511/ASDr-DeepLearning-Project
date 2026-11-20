import { Router } from 'express'
import { PostCategory } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { asyncHandler } from '../middleware/asyncHandler'
import { requireAuth } from '../middleware/auth'
import { requireCommunityActive } from '../middleware/community'
import { ensureCommunityProfile, notifyUsers, communityBlockedUserIds } from '../services/community'
import { lockCommunityUsers } from '../services/conversation'

export const communitySocialRouter = Router()
communitySocialRouter.use(requireAuth, requireCommunityActive)

const memberProfile = z.object({ displayName: z.string().trim().min(2).max(32), bio: z.string().trim().max(280).default('') })

communitySocialRouter.get('/profile', asyncHandler(async (req, res) => {
  const profile = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { id: true, name: true } })
  if (!profile) return res.status(404).json({ error: 'USER_NOT_FOUND' })
  const community = await ensureCommunityProfile(prisma, profile.id, 'Phụ huynh')
  const [followers, following, posts] = await Promise.all([
    prisma.communityMemberFollow.count({ where: { followingId: profile.id } }),
    prisma.communityMemberFollow.count({ where: { followerId: profile.id } }),
    prisma.communityPost.count({ where: { userId: profile.id, hiddenAt: null } }),
  ])
  return res.json({ profile: { userId: profile.id, displayName: community!.displayName, bio: community!.bio, followers, following, posts } })
}))

communitySocialRouter.patch('/profile', asyncHandler(async (req, res) => {
  const input = memberProfile.parse(req.body)
  await ensureCommunityProfile(prisma, req.user!.id, 'Phụ huynh')
  const profile = await prisma.communityProfile.update({ where: { userId: req.user!.id }, data: input })
  return res.json({ profile })
}))

communitySocialRouter.get('/members/:id', asyncHandler(async (req, res) => {
  const viewerId = req.user!.id
  const blocked = await communityBlockedUserIds(prisma, viewerId)
  if (blocked.includes(req.params.id)) return res.status(404).json({ error: 'MEMBER_NOT_FOUND' })
  const user = await prisma.user.findUnique({ where: { id: req.params.id }, select: { id: true, communityProfile: true } })
  if (!user) return res.status(404).json({ error: 'MEMBER_NOT_FOUND' })
  const profile = await ensureCommunityProfile(prisma, user.id, 'Phụ huynh')
  const [followers, following, posts, followed] = await Promise.all([
    prisma.communityMemberFollow.count({ where: { followingId: user.id } }),
    prisma.communityMemberFollow.count({ where: { followerId: user.id } }),
    prisma.communityPost.count({ where: { userId: user.id, hiddenAt: null } }),
    prisma.communityMemberFollow.findUnique({ where: { followerId_followingId: { followerId: viewerId, followingId: user.id } } }),
  ])
  return res.json({ profile: { userId: user.id, displayName: profile!.displayName, bio: profile!.bio, followers, following, posts, isSelf: viewerId === user.id, isFollowing: Boolean(followed) } })
}))

communitySocialRouter.post('/members/:id/follow', asyncHandler(async (req, res) => {
  const followerId = req.user!.id
  const followingId = req.params.id
  if (followerId === followingId) return res.status(400).json({ error: 'CANNOT_FOLLOW_SELF' })
  if ((await communityBlockedUserIds(prisma, followerId)).includes(followingId)) return res.status(404).json({ error: 'MEMBER_NOT_FOUND' })
  const target = await prisma.user.findUnique({ where: { id: followingId }, select: { id: true } })
  if (!target) return res.status(404).json({ error: 'MEMBER_NOT_FOUND' })
  const key = { followerId_followingId: { followerId, followingId } }
  const existing = await prisma.communityMemberFollow.findUnique({ where: key })
  if (existing) {
    await prisma.communityMemberFollow.delete({ where: key })
    return res.json({ following: false })
  }
  await prisma.communityMemberFollow.create({ data: { followerId, followingId } })
  await notifyUsers(prisma, [followingId], { type: 'MEMBER_FOLLOW', actorId: followerId })
  return res.json({ following: true })
}))

communitySocialRouter.post('/topics/:category/follow', asyncHandler(async (req, res) => {
  const parsed = z.nativeEnum(PostCategory).safeParse(req.params.category)
  if (!parsed.success) return res.status(400).json({ error: 'INVALID_CATEGORY' })
  const key = { userId_category: { userId: req.user!.id, category: parsed.data } }
  const existing = await prisma.communityTopicFollow.findUnique({ where: key })
  if (existing) {
    await prisma.communityTopicFollow.delete({ where: key })
    return res.json({ following: false })
  }
  await prisma.communityTopicFollow.create({ data: { userId: req.user!.id, category: parsed.data } })
  return res.json({ following: true })
}))

communitySocialRouter.get('/topics/following', asyncHandler(async (req, res) => {
  const rows = await prisma.communityTopicFollow.findMany({ where: { userId: req.user!.id }, select: { category: true } })
  return res.json({ categories: rows.map((row) => row.category) })
}))

communitySocialRouter.get('/groups', asyncHandler(async (req, res) => {
  const defaults = [
    ['chuyen-cua-gia-dinh', 'Chuyện của gia đình', 'Chia sẻ hành trình, cảm xúc và những khoảnh khắc nhỏ.', PostCategory.STORY],
    ['dong-hanh-cung-con', 'Đồng hành cùng con', 'Kinh nghiệm chăm sóc, giao tiếp và sinh hoạt hằng ngày.', PostCategory.PARENTING],
    ['doi-song-gia-dinh', 'Đời sống gia đình', 'Thói quen, vui chơi, giấc ngủ và những điều giúp nhà mình dễ chịu hơn.', PostCategory.LIFESTYLE],
    ['hoc-tap-va-phat-trien', 'Học tập và phát triển', 'Trao đổi kinh nghiệm với trường học và hoạt động phát triển.', PostCategory.EDUCATION],
    ['hoi-dap-phu-huynh', 'Hỏi đáp phụ huynh', 'Đặt câu hỏi và cùng nhau chia sẻ kinh nghiệm.', PostCategory.QA],
  ] as const
  await Promise.all(defaults.map(([slug, name, description, category]) => prisma.communityGroup.upsert({
    where: { slug }, create: { slug, name, description, category }, update: {},
  })))
  const groups = await prisma.communityGroup.findMany({ where: { isActive: true }, orderBy: [{ category: 'asc' }, { name: 'asc' }], include: { _count: { select: { members: true } }, members: { where: { userId: req.user!.id }, select: { userId: true } } } })
  return res.json({ groups: groups.map(({ members, _count, ...group }) => ({ ...group, memberCount: _count.members, joined: members.length > 0 })) })
}))

communitySocialRouter.post('/groups/:id/join', asyncHandler(async (req, res) => {
  const group = await prisma.communityGroup.findFirst({ where: { id: req.params.id, isActive: true }, select: { id: true } })
  if (!group) return res.status(404).json({ error: 'GROUP_NOT_FOUND' })
  await prisma.communityGroupMember.upsert({ where: { groupId_userId: { groupId: group.id, userId: req.user!.id } }, create: { groupId: group.id, userId: req.user!.id }, update: {} })
  return res.json({ joined: true })
}))

communitySocialRouter.delete('/groups/:id/join', asyncHandler(async (req, res) => {
  await prisma.communityGroupMember.deleteMany({ where: { groupId: req.params.id, userId: req.user!.id } })
  return res.json({ joined: false })
}))

communitySocialRouter.get('/notifications', asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1)
  const [notifications, unread] = await Promise.all([
    prisma.communityNotification.findMany({ where: { userId: req.user!.id }, include: { post: { select: { id: true, title: true } }, comment: { select: { id: true, content: true, postId: true } } }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * 30, take: 30 }),
    prisma.communityNotification.count({ where: { userId: req.user!.id, readAt: null } }),
  ])
  return res.json({ notifications, unread, page })
}))

communitySocialRouter.patch('/notifications/read', asyncHandler(async (req, res) => {
  const ids = z.array(z.string().uuid()).max(100).optional().parse(req.body.ids)
  const result = await prisma.communityNotification.updateMany({ where: { userId: req.user!.id, readAt: null, ...(ids ? { id: { in: ids } } : {}) }, data: { readAt: new Date() } })
  return res.json({ updated: result.count })
}))

communitySocialRouter.get('/blocks', asyncHandler(async (req, res) => {
  const rows = await prisma.communityBlock.findMany({ where: { blockerId: req.user!.id }, include: { blocked: { select: { id: true, communityProfile: { select: { displayName: true } } } } }, orderBy: { createdAt: 'desc' } })
  return res.json({ members: rows.map((row) => ({ id: row.blocked.id, displayName: row.blocked.communityProfile?.displayName ?? 'Thành viên cộng đồng', createdAt: row.createdAt })) })
}))

communitySocialRouter.post('/members/:id/block', asyncHandler(async (req, res) => {
  const blockerId = req.user!.id
  const blockedId = req.params.id
  if (blockerId === blockedId) return res.status(400).json({ error: 'CANNOT_BLOCK_SELF' })
  const target = await prisma.user.findUnique({ where: { id: blockedId }, select: { id: true } })
  if (!target) return res.status(404).json({ error: 'MEMBER_NOT_FOUND' })
  await prisma.$transaction(async (tx) => {
    await lockCommunityUsers(tx, [blockerId, blockedId])
    await tx.communityBlock.upsert({ where: { blockerId_blockedId: { blockerId, blockedId } }, create: { blockerId, blockedId }, update: {} })
    await tx.communityMemberFollow.deleteMany({ where: { OR: [{ followerId: blockerId, followingId: blockedId }, { followerId: blockedId, followingId: blockerId }] } })
    await tx.communityConversation.updateMany({ where: { status: 'PENDING', OR: [{ memberAId: blockerId, memberBId: blockedId }, { memberAId: blockedId, memberBId: blockerId }] }, data: { status: 'CANCELLED' } })
  })
  return res.json({ blocked: true })
}))

communitySocialRouter.delete('/members/:id/block', asyncHandler(async (req, res) => {
  await prisma.$transaction(async (tx) => {
    await lockCommunityUsers(tx, [req.user!.id, req.params.id])
    await tx.communityBlock.deleteMany({ where: { blockerId: req.user!.id, blockedId: req.params.id } })
  })
  return res.json({ blocked: false })
}))

const reportSchema = z.object({ reason: z.enum(['HARASSMENT', 'PRIVACY', 'MISINFORMATION', 'SPAM', 'OTHER']), details: z.string().trim().max(500).default('') })

communitySocialRouter.post('/posts/:id/report', asyncHandler(async (req, res) => {
  const input = reportSchema.parse(req.body)
  const post = await prisma.communityPost.findUnique({ where: { id: req.params.id }, include: { user: { select: { id: true, communityProfile: { select: { displayName: true } } } } } })
  if (!post || post.userId === req.user!.id) return res.status(404).json({ error: 'POST_NOT_FOUND' })
  const existing = await prisma.communityReport.findFirst({ where: { reporterId: req.user!.id, postId: post.id, status: { in: ['OPEN', 'REVIEWING'] } } })
  if (existing) return res.status(409).json({ error: 'ALREADY_REPORTED' })
  const report = await prisma.communityReport.create({ data: { reporterId: req.user!.id, postId: post.id, ...input, contentSnapshot: `${post.title}\n\n${post.content}`, authorSnapshot: post.isAnonymous ? 'Phụ huynh giấu tên' : (post.user.communityProfile?.displayName ?? 'Thành viên') } })
  return res.status(201).json({ reportId: report.id })
}))

communitySocialRouter.post('/comments/:id/report', asyncHandler(async (req, res) => {
  const input = reportSchema.parse(req.body)
  const comment = await prisma.communityComment.findUnique({ where: { id: req.params.id }, include: { user: { select: { id: true, communityProfile: { select: { displayName: true } } } } } })
  if (!comment || comment.userId === req.user!.id) return res.status(404).json({ error: 'COMMENT_NOT_FOUND' })
  const existing = await prisma.communityReport.findFirst({ where: { reporterId: req.user!.id, commentId: comment.id, status: { in: ['OPEN', 'REVIEWING'] } } })
  if (existing) return res.status(409).json({ error: 'ALREADY_REPORTED' })
  const report = await prisma.communityReport.create({ data: { reporterId: req.user!.id, commentId: comment.id, ...input, contentSnapshot: comment.content, authorSnapshot: comment.isAnonymous ? 'Phụ huynh giấu tên' : (comment.user.communityProfile?.displayName ?? 'Thành viên') } })
  return res.status(201).json({ reportId: report.id })
}))
