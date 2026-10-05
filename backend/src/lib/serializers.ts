import type { ChildProfile, ScreeningJob, ScreeningResult, VideoUpload } from '@prisma/client'
import { asdProbabilityFromRaw } from '../services/screeningResult'

/**
 * Parent-facing shape of a screening result. Leaves out rawAiResponse (ML
 * internals, upstream URLs) and the legacy derived "behaviour scores".
 */
export function serializeResult(result: ScreeningResult) {
  const raw = result.rawAiResponse as Record<string, unknown> | null
  return {
    id: result.id,
    riskLevel: result.riskLevel,
    confidenceScore: result.confidenceScore,
    asdProbability: result.asdProbability ?? asdProbabilityFromRaw(raw),
    decisionThreshold: result.decisionThreshold,
    highRiskThreshold: result.highRiskThreshold,
    calibrated: result.calibrated,
    modelVersion: result.modelVersion,
    gaitFeatures: result.gaitFeatures,
    recommendation: result.recommendation,
    provider: typeof raw?.provider === 'string' ? raw.provider : null,
    createdAt: result.createdAt,
  }
}

type ScreeningWithRelations = VideoUpload & {
  child?: ChildProfile | null
  result?: ScreeningResult | null
  job?: ScreeningJob | null
}

export function serializeScreening(video: ScreeningWithRelations, extra: { queuePosition?: number | null } = {}) {
  return {
    id: video.id,
    childId: video.childId,
    originalFilename: video.originalFilename,
    mimeType: video.mimeType,
    fileSize: video.fileSize,
    durationSeconds: video.durationSeconds,
    durationMs: video.durationMs,
    videoWidth: video.videoWidth,
    videoHeight: video.videoHeight,
    rawVideoDeleted: video.videoDeletedAt !== null,
    status: video.status,
    errorMessage: video.errorMessage,
    createdAt: video.createdAt,
    child: video.child ?? undefined,
    job: video.job
      ? {
          status: video.job.status,
          attempts: video.job.attempts,
          maxAttempts: video.job.maxAttempts,
          runAfter: video.job.runAfter,
          queuePosition: extra.queuePosition ?? null,
        }
      : null,
    result: video.result ? serializeResult(video.result) : null,
  }
}
