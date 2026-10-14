import { Router } from 'express'
import { z } from 'zod'
import { PostCategory, UserRole } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { requireAuth } from '../middleware/auth'
import { requireRole } from '../middleware/requireRole'
import { asyncHandler } from '../middleware/asyncHandler'

export const communityRouter = Router()

communityRouter.use(requireAuth)

const createPostSchema = z.object({
  title: z.string().trim().min(3, 'Tiêu đề cần tối thiểu 3 ký tự').max(200, 'Tiêu đề tối đa 200 ký tự'),
  content: z.string().trim().min(10, 'Nội dung chia sẻ cần tối thiểu 10 ký tự').max(10000, 'Nội dung tối đa 10.000 ký tự'),
  category: z.nativeEnum(PostCategory).default(PostCategory.STORY),
  isAnonymous: z.boolean().default(false),
})

const updatePostSchema = z.object({
  title: z.string().trim().min(3, 'Tiêu đề cần tối thiểu 3 ký tự').max(200, 'Tiêu đề tối đa 200 ký tự').optional(),
  content: z.string().trim().min(10, 'Nội dung chia sẻ cần tối thiểu 10 ký tự').max(10000, 'Nội dung tối đa 10.000 ký tự').optional(),
  category: z.nativeEnum(PostCategory).optional(),
})

const createCommentSchema = z.object({
  content: z.string().trim().min(1, 'Nội dung bình luận không được để trống').max(2000, 'Bình luận tối đa 2.000 ký tự'),
  isAnonymous: z.boolean().default(false),
  parentId: z.string().uuid().nullable().optional(),
})

function serializeAuthor(
  user: { id: string; name: string; role: string },
  isAnonymous: boolean,
  currentUserId: string,
) {
  if (isAnonymous) {
    const isSelf = user.id === currentUserId
    return {
      id: isSelf ? user.id : 'anonymous',
      name: isSelf ? `${user.name} (Ẩn danh)` : 'Phụ huynh giấu tên',
      role: 'USER',
      isAnonymous: true,
      isSelf,
    }
  }
  return {
    id: user.id,
    name: user.name,
    role: user.role,
    isAnonymous: false,
    isSelf: user.id === currentUserId,
  }
}

/**
 * GET /api/community/posts
 * Feed of community posts with filter, sort, search, and pagination.
 */
communityRouter.get(
  '/posts',
  asyncHandler(async (req, res) => {
    const currentUserId = req.user!.id
    const categoryQuery = req.query.category as string | undefined
    const sortQuery = (req.query.sort as string) || 'latest'
    const searchQuery = (req.query.search as string)?.trim()
    const page = Math.max(1, parseInt(req.query.page as string) || 1)
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20))
    const skip = (page - 1) * limit

    const where: any = {}

    if (categoryQuery && Object.values(PostCategory).includes(categoryQuery as PostCategory)) {
      where.category = categoryQuery as PostCategory
    }

    if (searchQuery) {
      where.OR = [
        { title: { contains: searchQuery, mode: 'insensitive' } },
        { content: { contains: searchQuery, mode: 'insensitive' } },
      ]
    }

    const orderBy: any = [{ isPinned: 'desc' }]
    if (sortQuery === 'popular') {
      orderBy.push({ likesCount: 'desc' }, { createdAt: 'desc' })
    } else {
      orderBy.push({ createdAt: 'desc' })
    }

    const [total, posts] = await Promise.all([
      prisma.communityPost.count({ where }),
      prisma.communityPost.findMany({
        where,
        orderBy,
        skip,
        take: limit,
        include: {
          user: { select: { id: true, name: true, role: true } },
        },
      }),
    ])

    const postIds = posts.map((p) => p.id)
    const [likes, bookmarks] = await Promise.all([
      prisma.communityLike.findMany({
        where: { userId: currentUserId, postId: { in: postIds } },
        select: { postId: true },
      }),
      prisma.communityBookmark.findMany({
        where: { userId: currentUserId, postId: { in: postIds } },
        select: { postId: true },
      }),
    ])

    const likedSet = new Set(likes.map((l) => l.postId))
    const bookmarkedSet = new Set(bookmarks.map((b) => b.postId))

    const serializedPosts = posts.map((post) => ({
      id: post.id,
      category: post.category,
      title: post.title,
      content: post.content,
      isPinned: post.isPinned,
      likesCount: post.likesCount,
      commentsCount: post.commentsCount,
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
      author: serializeAuthor(post.user, post.isAnonymous, currentUserId),
      isLiked: likedSet.has(post.id),
      isBookmarked: bookmarkedSet.has(post.id),
      canManage: post.userId === currentUserId || req.user!.role === UserRole.ADMIN,
    }))

    return res.json({
      posts: serializedPosts,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    })
  }),
)

/**
 * GET /api/community/posts/:id
 * Single post detail with nested comment replies.
 */
communityRouter.get(
  '/posts/:id',
  asyncHandler(async (req, res) => {
    const currentUserId = req.user!.id
    const { id } = req.params

    const post = await prisma.communityPost.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, name: true, role: true } },
        comments: {
          orderBy: { createdAt: 'asc' },
          include: {
            user: { select: { id: true, name: true, role: true } },
          },
        },
      },
    })

    if (!post) {
      return res.status(404).json({ error: 'POST_NOT_FOUND', detail: 'Không tìm thấy bài viết.' })
    }

    const [like, bookmark] = await Promise.all([
      prisma.communityLike.findUnique({
        where: { postId_userId: { postId: id, userId: currentUserId } },
      }),
      prisma.communityBookmark.findUnique({
        where: { postId_userId: { postId: id, userId: currentUserId } },
      }),
    ])

    // Build comment replies tree
    const rootComments: any[] = []
    const replyMap = new Map<string, any[]>()

    for (const c of post.comments) {
      const serializedComment = {
        id: c.id,
        postId: c.postId,
        parentId: c.parentId,
        content: c.content,
        createdAt: c.createdAt,
        author: serializeAuthor(c.user, c.isAnonymous, currentUserId),
        canManage: c.userId === currentUserId || req.user!.role === UserRole.ADMIN,
        replies: [] as any[],
      }

      if (!c.parentId) {
        rootComments.push(serializedComment)
      } else {
        const list = replyMap.get(c.parentId) ?? []
        list.push(serializedComment)
        replyMap.set(c.parentId, list)
      }
    }

    for (const root of rootComments) {
      root.replies = replyMap.get(root.id) ?? []
    }

    return res.json({
      post: {
        id: post.id,
        category: post.category,
        title: post.title,
        content: post.content,
        isPinned: post.isPinned,
        likesCount: post.likesCount,
        commentsCount: post.commentsCount,
        createdAt: post.createdAt,
        updatedAt: post.updatedAt,
        author: serializeAuthor(post.user, post.isAnonymous, currentUserId),
        isLiked: Boolean(like),
        isBookmarked: Boolean(bookmark),
        canManage: post.userId === currentUserId || req.user!.role === UserRole.ADMIN,
        comments: rootComments,
      },
    })
  }),
)

/**
 * POST /api/community/posts
 * Create new community post.
 */
communityRouter.post(
  '/posts',
  asyncHandler(async (req, res) => {
    const currentUserId = req.user!.id
    const input = createPostSchema.parse(req.body)

    const post = await prisma.communityPost.create({
      data: {
        userId: currentUserId,
        title: input.title,
        content: input.content,
        category: input.category,
        isAnonymous: input.isAnonymous,
      },
      include: {
        user: { select: { id: true, name: true, role: true } },
      },
    })

    return res.status(201).json({
      post: {
        id: post.id,
        category: post.category,
        title: post.title,
        content: post.content,
        isPinned: post.isPinned,
        likesCount: 0,
        commentsCount: 0,
        createdAt: post.createdAt,
        updatedAt: post.updatedAt,
        author: serializeAuthor(post.user, post.isAnonymous, currentUserId),
        isLiked: false,
        isBookmarked: false,
        canManage: true,
      },
    })
  }),
)

/**
 * PATCH /api/community/posts/:id
 * Update existing post (author or admin).
 */
communityRouter.patch(
  '/posts/:id',
  asyncHandler(async (req, res) => {
    const currentUserId = req.user!.id
    const { id } = req.params
    const input = updatePostSchema.parse(req.body)

    const existing = await prisma.communityPost.findUnique({
      where: { id },
      select: { userId: true },
    })

    if (!existing) {
      return res.status(404).json({ error: 'POST_NOT_FOUND', detail: 'Không tìm thấy bài viết.' })
    }

    if (existing.userId !== currentUserId && req.user!.role !== UserRole.ADMIN) {
      return res.status(403).json({ error: 'FORBIDDEN', detail: 'Bạn không có quyền sửa bài viết này.' })
    }

    const updated = await prisma.communityPost.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.content !== undefined ? { content: input.content } : {}),
        ...(input.category !== undefined ? { category: input.category } : {}),
      },
      include: {
        user: { select: { id: true, name: true, role: true } },
      },
    })

    return res.json({
      post: {
        id: updated.id,
        category: updated.category,
        title: updated.title,
        content: updated.content,
        isPinned: updated.isPinned,
        likesCount: updated.likesCount,
        commentsCount: updated.commentsCount,
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
        author: serializeAuthor(updated.user, updated.isAnonymous, currentUserId),
        canManage: true,
      },
    })
  }),
)

/**
 * DELETE /api/community/posts/:id
 * Delete post (author or admin).
 */
communityRouter.delete(
  '/posts/:id',
  asyncHandler(async (req, res) => {
    const currentUserId = req.user!.id
    const { id } = req.params

    const existing = await prisma.communityPost.findUnique({
      where: { id },
      select: { userId: true },
    })

    if (!existing) {
      return res.status(404).json({ error: 'POST_NOT_FOUND', detail: 'Không tìm thấy bài viết.' })
    }

    if (existing.userId !== currentUserId && req.user!.role !== UserRole.ADMIN) {
      return res.status(403).json({ error: 'FORBIDDEN', detail: 'Bạn không có quyền xoá bài viết này.' })
    }

    await prisma.communityPost.delete({ where: { id } })
    return res.json({ success: true, message: 'Đã xoá bài viết thành công.' })
  }),
)

/**
 * POST /api/community/posts/:id/like
 * Toggle like for a post.
 */
communityRouter.post(
  '/posts/:id/like',
  asyncHandler(async (req, res) => {
    const currentUserId = req.user!.id
    const { id: postId } = req.params

    const post = await prisma.communityPost.findUnique({
      where: { id: postId },
      select: { id: true, likesCount: true },
    })

    if (!post) {
      return res.status(404).json({ error: 'POST_NOT_FOUND', detail: 'Không tìm thấy bài viết.' })
    }

    const existingLike = await prisma.communityLike.findUnique({
      where: { postId_userId: { postId, userId: currentUserId } },
    })

    if (existingLike) {
      const [, updated] = await prisma.$transaction([
        prisma.communityLike.delete({ where: { id: existingLike.id } }),
        prisma.communityPost.update({
          where: { id: postId },
          data: { likesCount: { decrement: 1 } },
          select: { likesCount: true },
        }),
      ])
      return res.json({ liked: false, likesCount: Math.max(0, updated.likesCount) })
    } else {
      const [, updated] = await prisma.$transaction([
        prisma.communityLike.create({ data: { postId, userId: currentUserId } }),
        prisma.communityPost.update({
          where: { id: postId },
          data: { likesCount: { increment: 1 } },
          select: { likesCount: true },
        }),
      ])
      return res.json({ liked: true, likesCount: updated.likesCount })
    }
  }),
)

/**
 * POST /api/community/posts/:id/bookmark
 * Toggle bookmark for a post.
 */
communityRouter.post(
  '/posts/:id/bookmark',
  asyncHandler(async (req, res) => {
    const currentUserId = req.user!.id
    const { id: postId } = req.params

    const post = await prisma.communityPost.findUnique({
      where: { id: postId },
      select: { id: true },
    })

    if (!post) {
      return res.status(404).json({ error: 'POST_NOT_FOUND', detail: 'Không tìm thấy bài viết.' })
    }

    const existingBookmark = await prisma.communityBookmark.findUnique({
      where: { postId_userId: { postId, userId: currentUserId } },
    })

    if (existingBookmark) {
      await prisma.communityBookmark.delete({ where: { id: existingBookmark.id } })
      return res.json({ bookmarked: false })
    } else {
      await prisma.communityBookmark.create({ data: { postId, userId: currentUserId } })
      return res.json({ bookmarked: true })
    }
  }),
)

/**
 * GET /api/community/bookmarks
 * List all posts bookmarked by the user.
 */
communityRouter.get(
  '/bookmarks',
  asyncHandler(async (req, res) => {
    const currentUserId = req.user!.id

    const bookmarks = await prisma.communityBookmark.findMany({
      where: { userId: currentUserId },
      orderBy: { createdAt: 'desc' },
      include: {
        post: {
          include: {
            user: { select: { id: true, name: true, role: true } },
          },
        },
      },
    })

    const postIds = bookmarks.map((b) => b.post.id)
    const likes = await prisma.communityLike.findMany({
      where: { userId: currentUserId, postId: { in: postIds } },
      select: { postId: true },
    })
    const likedSet = new Set(likes.map((l) => l.postId))

    const posts = bookmarks.map((b) => ({
      id: b.post.id,
      category: b.post.category,
      title: b.post.title,
      content: b.post.content,
      isPinned: b.post.isPinned,
      likesCount: b.post.likesCount,
      commentsCount: b.post.commentsCount,
      createdAt: b.post.createdAt,
      updatedAt: b.post.updatedAt,
      author: serializeAuthor(b.post.user, b.post.isAnonymous, currentUserId),
      isLiked: likedSet.has(b.post.id),
      isBookmarked: true,
      canManage: b.post.userId === currentUserId || req.user!.role === UserRole.ADMIN,
    }))

    return res.json({ posts })
  }),
)

/**
 * POST /api/community/posts/:id/comments
 * Add a comment (or reply) to a post.
 */
communityRouter.post(
  '/posts/:id/comments',
  asyncHandler(async (req, res) => {
    const currentUserId = req.user!.id
    const { id: postId } = req.params
    const input = createCommentSchema.parse(req.body)

    const post = await prisma.communityPost.findUnique({
      where: { id: postId },
      select: { id: true },
    })

    if (!post) {
      return res.status(404).json({ error: 'POST_NOT_FOUND', detail: 'Không tìm thấy bài viết.' })
    }

    if (input.parentId) {
      const parentComment = await prisma.communityComment.findUnique({
        where: { id: input.parentId },
        select: { id: true, postId: true },
      })
      if (!parentComment || parentComment.postId !== postId) {
        return res.status(400).json({ error: 'INVALID_PARENT_COMMENT', detail: 'Bình luận phản hồi không hợp lệ.' })
      }
    }

    const [comment] = await prisma.$transaction([
      prisma.communityComment.create({
        data: {
          postId,
          userId: currentUserId,
          parentId: input.parentId ?? null,
          content: input.content,
          isAnonymous: input.isAnonymous,
        },
        include: {
          user: { select: { id: true, name: true, role: true } },
        },
      }),
      prisma.communityPost.update({
        where: { id: postId },
        data: { commentsCount: { increment: 1 } },
      }),
    ])

    return res.status(201).json({
      comment: {
        id: comment.id,
        postId: comment.postId,
        parentId: comment.parentId,
        content: comment.content,
        createdAt: comment.createdAt,
        author: serializeAuthor(comment.user, comment.isAnonymous, currentUserId),
        canManage: true,
        replies: [],
      },
    })
  }),
)

/**
 * DELETE /api/community/comments/:id
 * Delete a comment (author or admin).
 */
communityRouter.delete(
  '/comments/:id',
  asyncHandler(async (req, res) => {
    const currentUserId = req.user!.id
    const { id } = req.params

    const comment = await prisma.communityComment.findUnique({
      where: { id },
      select: { id: true, userId: true, postId: true },
    })

    if (!comment) {
      return res.status(404).json({ error: 'COMMENT_NOT_FOUND', detail: 'Không tìm thấy bình luận.' })
    }

    if (comment.userId !== currentUserId && req.user!.role !== UserRole.ADMIN) {
      return res.status(403).json({ error: 'FORBIDDEN', detail: 'Bạn không có quyền xoá bình luận này.' })
    }

    await prisma.$transaction([
      prisma.communityComment.delete({ where: { id } }),
      prisma.communityPost.update({
        where: { id: comment.postId },
        data: { commentsCount: { decrement: 1 } },
      }),
    ])

    return res.json({ success: true, message: 'Đã xoá bình luận thành công.' })
  }),
)

/**
 * PATCH /api/community/posts/:id/pin
 * Toggle pin post (ADMIN only).
 */
communityRouter.patch(
  '/posts/:id/pin',
  requireRole(UserRole.ADMIN),
  asyncHandler(async (req, res) => {
    const { id } = req.params

    const post = await prisma.communityPost.findUnique({
      where: { id },
      select: { id: true, isPinned: true },
    })

    if (!post) {
      return res.status(404).json({ error: 'POST_NOT_FOUND', detail: 'Không tìm thấy bài viết.' })
    }

    const updated = await prisma.communityPost.update({
      where: { id },
      data: { isPinned: !post.isPinned },
      select: { id: true, isPinned: true },
    })

    return res.json({ success: true, isPinned: updated.isPinned })
  }),
)
