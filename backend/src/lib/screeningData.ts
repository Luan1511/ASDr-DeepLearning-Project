import type { RiskLevel, ScreeningStatus } from '@prisma/client'

/** `provider` recorded in ScreeningResult.rawAiResponse ('openpose-stgcn', 'mock', …). */
export function resultProvider(rawAiResponse: unknown): string | null {
  const provider = (rawAiResponse as { provider?: unknown } | null)?.provider
  return typeof provider === 'string' ? provider : null
}

/** Subject id of a screening on the ML server (the upload id unless the ML server reported another). */
export function mlSubjectIdFor(video: { id: string; result?: { rawAiResponse: unknown } | null }): string {
  const subjectId = (video.result?.rawAiResponse as { subjectId?: unknown } | null)?.subjectId
  return typeof subjectId === 'string' && subjectId ? subjectId : video.id
}

/**
 * Whether the ML server may hold keypoints or a video copy for this upload,
 * i.e. it must be asked to delete them when the parent deletes the data.
 */
export function mayHaveMlData(video: {
  status: ScreeningStatus
  job?: { attempts: number } | null
  result?: { rawAiResponse: unknown } | null
}): boolean {
  if (video.result) return resultProvider(video.result.rawAiResponse) !== 'mock'
  if (video.job) return video.job.attempts > 0
  // Uploads processed before the job queue existed have no job row.
  return video.status !== 'UPLOADED'
}

export type ChildScreeningSummary = {
  screeningCount: number
  completedCount: number
  lastScreeningAt: Date | null
  /** Most recent screening that has a result. */
  lastResult: { riskLevel: RiskLevel; screenedAt: Date } | null
}

export const EMPTY_CHILD_SUMMARY: ChildScreeningSummary = {
  screeningCount: 0,
  completedCount: 0,
  lastScreeningAt: null,
  lastResult: null,
}

export function summarizeScreenings(
  rows: Array<{ childId: string; createdAt: Date; result: { riskLevel: RiskLevel } | null }>,
): Map<string, ChildScreeningSummary> {
  const byChild = new Map<string, ChildScreeningSummary>()
  for (const row of rows) {
    const summary = byChild.get(row.childId) ?? { ...EMPTY_CHILD_SUMMARY }
    summary.screeningCount += 1
    if (!summary.lastScreeningAt || row.createdAt > summary.lastScreeningAt) summary.lastScreeningAt = row.createdAt
    if (row.result) {
      summary.completedCount += 1
      if (!summary.lastResult || row.createdAt > summary.lastResult.screenedAt) {
        summary.lastResult = { riskLevel: row.result.riskLevel, screenedAt: row.createdAt }
      }
    }
    byChild.set(row.childId, summary)
  }
  return byChild
}
