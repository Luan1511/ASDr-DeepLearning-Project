import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { asyncHandler } from '../middleware/asyncHandler'

export const articlesRouter = Router()

articlesRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const articles = await prisma.article.findMany({
      select: { id: true, title: true, slug: true, category: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    })
    return res.json({ articles })
  }),
)

articlesRouter.get(
  '/:slug',
  asyncHandler(async (req, res) => {
    const slug = z.string().min(1).parse(req.params.slug)
    const article = await prisma.article.findUnique({ where: { slug } })
    if (!article) return res.status(404).json({ error: 'NOT_FOUND' })
    return res.json({ article })
  }),
)
