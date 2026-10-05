import { Router } from 'express'
import { prisma } from '../lib/prisma'
import { serializeScreening } from '../lib/serializers'
import { requireAuth } from '../middleware/auth'
import { requireRole } from '../middleware/requireRole'
import { asyncHandler } from '../middleware/asyncHandler'
import { JobStatus, UserRole } from '@prisma/client'
import { OpenPoseApiError, getOpenPoseBaseUrl, openposeService } from '../services/openposeService'

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
      jobsQueued,
      jobsRunning,
      jobsFailed,
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
      prisma.screeningJob.count({ where: { status: JobStatus.QUEUED } }),
      prisma.screeningJob.count({ where: { status: JobStatus.RUNNING } }),
      prisma.screeningJob.count({ where: { status: JobStatus.FAILED } }),
      prisma.user.findMany({
        select: { id: true, name: true, email: true, role: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      prisma.videoUpload.findMany({
        include: {
          child: true,
          result: true,
          job: true,
          user: { select: { id: true, email: true, name: true } },
        },
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
      queue: {
        queued: jobsQueued,
        running: jobsRunning,
        failed: jobsFailed,
      },
      recentUsers,
      // Admins also see the technical error of the last attempt.
      recentScreenings: recentScreenings.map((s) => ({
        ...serializeScreening(s),
        user: s.user,
        jobLastError: s.job?.lastError ?? null,
      })),
    })
  }),
)

/** GET /api/admin/ml-health — reachability and privacy/calibration status of the ML server. */
adminRouter.get(
  '/ml-health',
  asyncHandler(async (_req, res) => {
    const startedAt = Date.now()
    try {
      const health = await openposeService.getHealth()
      if (health) {
        return res.json({ reachable: true, latencyMs: Date.now() - startedAt, legacy: false, health })
      }
      // Older servers have no /health; fall back to the root route.
      await openposeService.checkHealth()
      return res.json({ reachable: true, latencyMs: Date.now() - startedAt, legacy: true, health: null })
    } catch (error) {
      return res.json({
        reachable: false,
        latencyMs: Date.now() - startedAt,
        baseUrl: getOpenPoseBaseUrl(),
        error: error instanceof OpenPoseApiError ? error.message : String(error),
      })
    }
  }),
)
