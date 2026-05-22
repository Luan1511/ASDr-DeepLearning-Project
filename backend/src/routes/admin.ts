import { Router } from 'express'
import { prisma } from '../lib/prisma'
import { requireAuth } from '../middleware/auth'
import { requireRole } from '../middleware/requireRole'
import { asyncHandler } from '../middleware/asyncHandler'
import { UserRole } from '@prisma/client'

export const adminRouter = Router()

adminRouter.use(requireAuth)
adminRouter.use(requireRole(UserRole.ADMIN))

adminRouter.get(
  '/stats',
  asyncHandler(async (_req, res) => {
    const [
      totalUsers,
      totalUploads,
      completedUploads,
      processingUploads,
      failedUploads,
      riskLow,
      riskMedium,
      riskHigh,
      recentUsers,
      recentScreenings,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.videoUpload.count(),
      prisma.videoUpload.count({ where: { status: 'COMPLETED' } }),
      prisma.videoUpload.count({ where: { status: 'PROCESSING' } }),
      prisma.videoUpload.count({ where: { status: 'FAILED' } }),
      prisma.screeningResult.count({ where: { riskLevel: 'LOW' } }),
      prisma.screeningResult.count({ where: { riskLevel: 'MEDIUM' } }),
      prisma.screeningResult.count({ where: { riskLevel: 'HIGH' } }),
      prisma.user.findMany({
        select: { id: true, name: true, email: true, role: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      prisma.videoUpload.findMany({
        include: { child: true, result: true, user: { select: { id: true, email: true, name: true } } },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
    ])

    return res.json({
      totals: {
        users: totalUsers,
        uploads: totalUploads,
      },
      uploadsByStatus: {
        completed: completedUploads,
        processing: processingUploads,
        failed: failedUploads,
      },
      riskCounts: {
        low: riskLow,
        medium: riskMedium,
        high: riskHigh,
      },
      recentUsers,
      recentScreenings,
    })
  }),
)
