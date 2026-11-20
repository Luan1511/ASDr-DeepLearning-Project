import type { NextFunction, Request, Response } from 'express'
import { prisma } from '../lib/prisma'
import { asyncHandler } from './asyncHandler'

export const requireCommunityActive = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { communitySuspendedAt: true } })
  if (!user) return res.status(401).json({ error: 'UNAUTHORIZED' })
  if (user.communitySuspendedAt) return res.status(403).json({ error: 'COMMUNITY_SUSPENDED' })
  return next()
})
