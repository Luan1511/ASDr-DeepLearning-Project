import path from 'path'
import { Router } from 'express'
import { prisma } from '../lib/prisma'
import { serializeScreening } from '../lib/serializers'
import { requireAuth } from '../middleware/auth'
import { requireRole } from '../middleware/requireRole'
import { asyncHandler } from '../middleware/asyncHandler'
import { JobStatus, UserRole } from '@prisma/client'
import { OpenPoseApiError, getOpenPoseBaseUrl, openposeService } from '../services/openposeService'
import { isSchemaOutdatedError } from '../lib/prismaErrors'
import { getExerciseQueueStats } from '../services/exerciseProcessor'
import { IN_APP_MODE } from '../lib/questionnaires/mchatRf'
import { questionnaireContentStatus } from './questionnaires'

export const adminRouter = Router()

adminRouter.use(requireAuth)
adminRouter.use(requireRole(UserRole.ADMIN))

/** Giai đoạn 4 counters are null while the database lacks the new tables. */
async function unlessSchemaOutdated<T>(load: () => Promise<T>): Promise<T | null> {
  try {
    return await load()
  } catch (error) {
    if (isSchemaOutdatedError(error)) return null
    throw error
  }
}

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
      exerciseQueue,
      questionnaires,
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
      unlessSchemaOutdated(getExerciseQueueStats),
      unlessSchemaOutdated(async () => ({ total: await prisma.questionnaireResponse.count() })),
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
      exerciseQueue,
      questionnaires,
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

/**
 * GET /api/admin/questionnaires/status — MCHAT_MODE, whether the licensed
 * content file is usable (key-path errors only, never text) and aggregate
 * counts (no answers, no children). counts is null while the database lacks
 * the questionnaire table.
 */
adminRouter.get(
  '/questionnaires/status',
  asyncHandler(async (_req, res) => {
    const { mode, content } = questionnaireContentStatus()
    const counts = await unlessSchemaOutdated(async () => {
      const [total, low, moderate, high, followUpPending, inApp] = await Promise.all([
        prisma.questionnaireResponse.count(),
        prisma.questionnaireResponse.count({ where: { band: 'LOW' } }),
        prisma.questionnaireResponse.count({ where: { band: 'MODERATE' } }),
        prisma.questionnaireResponse.count({ where: { band: 'HIGH' } }),
        prisma.questionnaireResponse.count({ where: { followUpStatus: 'PENDING' } }),
        prisma.questionnaireResponse.count({ where: { mode: IN_APP_MODE } }),
      ])
      return { total, byBand: { LOW: low, MODERATE: moderate, HIGH: high }, followUpPending, inApp }
    })
    return res.json({
      mode,
      content: {
        state: content.state,
        stage1Ready: content.stage1Ready,
        file: path.basename(content.path),
        errors: content.errors,
        contentVersion: content.contentVersion,
        licenseRef: content.licenseRef,
        translationSource: content.translationSource,
        structureVersion: content.structureVersion,
        structureHash: content.structureHash,
      },
      counts,
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
