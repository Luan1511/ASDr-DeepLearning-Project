/**
 * Pure helpers over exercise sessions and scores: ML-cleanup bookkeeping,
 * consent checks, progress summaries and admin statistics.
 */
import { EXERCISE_CONSENT_SCOPES, EXERCISE_CONSENT_VERSION } from './consent'

type SessionStatus = 'QUEUED' | 'PROCESSING' | 'SCORED' | 'INSUFFICIENT' | 'FAILED'

export const FINAL_SESSION_STATUSES = ['SCORED', 'INSUFFICIENT', 'FAILED'] as const
export const PENDING_SESSION_STATUSES = ['QUEUED', 'PROCESSING'] as const

/** Whether the ML server may still hold keypoints / a video copy for this session. */
export function sessionMayHaveMlData(s: { mlSubjectId: string | null; mlSubjectDeletedAt: Date | null }): boolean {
  return s.mlSubjectId !== null && s.mlSubjectDeletedAt === null
}

/** Changes whenever the worker may have sent the video to the ML server again. */
export function sessionFingerprint(s: {
  status: string
  attempts: number
  mlSubjectId: string | null
  mlSubjectDeletedAt: Date | null
}): string {
  return `${s.status}:${s.attempts}:${s.mlSubjectId ?? '-'}:${s.mlSubjectDeletedAt ? s.mlSubjectDeletedAt.toISOString() : '-'}`
}

/** Current exercise consent: this version, not revoked, covering EXERCISE_VIDEO. */
export function isActiveExerciseConsent(c: { version: string; revokedAt: Date | null; scopes: string[] }): boolean {
  return (
    c.version === EXERCISE_CONSENT_VERSION &&
    c.revokedAt === null &&
    EXERCISE_CONSENT_SCOPES.every((scope) => c.scopes.includes(scope))
  )
}

/** Stars shown to the child: every scored attempt gets at least one. */
export function starsFor(overall: number | null | undefined): 1 | 2 | 3 | null {
  if (typeof overall !== 'number' || !Number.isFinite(overall)) return null
  if (overall >= 80) return 3
  if (overall >= 60) return 2
  return 1
}

/** Worker retry delay: 15 s, 30 s, 60 s, ... */
export function exerciseRetryDelayMs(attempts: number): number {
  return 15_000 * 2 ** Math.max(0, attempts - 1)
}

// ---------------------------------------------------------------------------
// Progress (parent dashboard)
// ---------------------------------------------------------------------------

export type ProgressSessionRow = {
  id: string
  status: SessionStatus
  createdAt: Date
  exercise: { id: string; slug: string; title: string; difficulty: number }
  template: { id: string; version: number }
  /** Latest score of the session (null while pending or after a technical failure). */
  score: {
    algorithmVersion: string
    status: string
    overall: number | null
    stars: number | null
    warnings?: string[]
  } | null
}

export type ProgressPoint = {
  sessionId: string
  at: Date
  overall: number | null
  stars: number | null
  status: 'SCORED' | 'INSUFFICIENT'
  hasWarnings: boolean
}

export type ExerciseProgress = {
  exercise: { id: string; slug: string; title: string; difficulty: number }
  attempts: number
  scoredAttempts: number
  lastAt: Date | null
  best: { overall: number; stars: number; at: Date } | null
  last: { overall: number | null; stars: number | null; status: SessionStatus; at: Date } | null
  /** One series per `${algorithmVersion}|${templateId}`: scores of different series are not comparable. */
  series: Array<{ key: string; templateVersion: number; algorithmVersion: string; points: ProgressPoint[] }>
}

export function progressSeriesKey(algorithmVersion: string, templateId: string): string {
  return `${algorithmVersion}|${templateId}`
}

/** Per exercise, most recently practised first. */
export function summarizeExerciseProgress(rows: ProgressSessionRow[]): ExerciseProgress[] {
  const byExercise = new Map<string, ProgressSessionRow[]>()
  for (const row of rows) {
    const list = byExercise.get(row.exercise.id) ?? []
    list.push(row)
    byExercise.set(row.exercise.id, list)
  }

  const out: ExerciseProgress[] = []
  for (const list of byExercise.values()) {
    const sorted = [...list].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    const latest = sorted[sorted.length - 1]

    let best: ExerciseProgress['best'] = null
    let scoredAttempts = 0
    const series = new Map<string, ExerciseProgress['series'][number]>()
    for (const row of sorted) {
      const score = row.score
      if (!score || (score.status !== 'SCORED' && score.status !== 'INSUFFICIENT')) continue
      const scored = score.status === 'SCORED' && typeof score.overall === 'number'
      if (scored) {
        scoredAttempts += 1
        // Later attempts win ties so "best" shows the most recent top score.
        if (!best || score.overall! >= best.overall) {
          best = { overall: score.overall!, stars: score.stars ?? starsFor(score.overall)!, at: row.createdAt }
        }
      }
      const key = progressSeriesKey(score.algorithmVersion, row.template.id)
      const entry = series.get(key) ?? {
        key,
        templateVersion: row.template.version,
        algorithmVersion: score.algorithmVersion,
        points: [],
      }
      entry.points.push({
        sessionId: row.id,
        at: row.createdAt,
        overall: scored ? score.overall : null,
        stars: scored ? (score.stars ?? starsFor(score.overall)) : null,
        status: scored ? 'SCORED' : 'INSUFFICIENT',
        hasWarnings: (score.warnings ?? []).length > 0,
      })
      series.set(key, entry)
    }

    const latestScored = latest.score?.status === 'SCORED' && typeof latest.score.overall === 'number'
    out.push({
      exercise: latest.exercise,
      attempts: sorted.length,
      scoredAttempts,
      lastAt: latest.createdAt,
      best,
      last: {
        overall: latestScored ? latest.score!.overall : null,
        stars: latestScored ? (latest.score!.stars ?? starsFor(latest.score!.overall)) : null,
        status: latest.status,
        at: latest.createdAt,
      },
      // Map preserves insertion order = order of each series' first attempt.
      series: Array.from(series.values()),
    })
  }
  return out.sort((a, b) => (b.lastAt?.getTime() ?? 0) - (a.lastAt?.getTime() ?? 0))
}

/** Compact per-exercise numbers for the library cards. */
export function childStatsFromProgress(p: ExerciseProgress) {
  return {
    attempts: p.attempts,
    scoredAttempts: p.scoredAttempts,
    bestStars: p.best?.stars ?? null,
    lastStars: p.last?.stars ?? null,
    lastAt: p.lastAt,
  }
}

// ---------------------------------------------------------------------------
// Admin statistics (no child identifiers)
// ---------------------------------------------------------------------------

export type ScoreStatRow = { status: string; overall: number | null; mode: string | null; reasonCodes: string[] }

export function summarizeExerciseStats(attempts: number, scores: ScoreStatRow[]) {
  const histogram10 = new Array<number>(10).fill(0)
  const reasonCounts: Record<string, number> = {}
  const modeSplit = { mirror: 0, anatomical: 0, none: 0 }
  let scored = 0
  let insufficient = 0
  for (const s of scores) {
    for (const code of s.reasonCodes) reasonCounts[code] = (reasonCounts[code] ?? 0) + 1
    if (s.status === 'INSUFFICIENT') {
      insufficient += 1
      continue
    }
    if (s.status !== 'SCORED' || typeof s.overall !== 'number') continue
    scored += 1
    histogram10[Math.min(9, Math.max(0, Math.floor(s.overall / 10)))] += 1
    if (s.mode === 'mirror') modeSplit.mirror += 1
    else if (s.mode === 'anatomical') modeSplit.anatomical += 1
    else modeSplit.none += 1
  }
  const judged = scored + insufficient
  return {
    attempts,
    scored,
    insufficient,
    insufficientRate: judged ? Math.round((insufficient / judged) * 1000) / 1000 : 0,
    histogram10,
    reasonCounts,
    modeSplit,
  }
}
