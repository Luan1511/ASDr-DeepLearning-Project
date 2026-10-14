import { Router, type NextFunction, type Request, type Response } from 'express'
import { ExerciseStatus } from '@prisma/client'
import { env } from '../lib/env'
import { prisma } from '../lib/prisma'
import { acceptedExtensions, exerciseAccess, uuidSchema } from '../lib/exerciseInput'
import { childStatsFromProgress, summarizeExerciseProgress } from '../lib/exerciseData'
import { serializeExercise, serializeGuideTemplate } from '../lib/exerciseSerializers'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../middleware/asyncHandler'
import { getCurrentExerciseConsentStatement } from '../services/consentService'
import { getMlCapabilities } from '../services/mlCapabilities'

/** Parent exercise library + exercise consent statement. */
export const exercisesRouter = Router()

exercisesRouter.use(requireAuth)

// ---------------------------------------------------------------------------
// Shared by the parent exercise routers
// ---------------------------------------------------------------------------

/** EXERCISE_MODE gate: off → nobody, admin_only → admins, on → every parent. */
export function requireExercisesEnabled(req: Request, res: Response, next: NextFunction) {
  if (!exerciseAccess(env.EXERCISE_MODE, req.user?.role)) return res.status(403).json({ error: 'EXERCISES_DISABLED' })
  return next()
}

export async function findOwnedChild(childId: unknown, userId: string) {
  const parsed = uuidSchema.safeParse(childId)
  if (!parsed.success) return null
  return prisma.childProfile.findFirst({ where: { id: parsed.data, userId }, select: { id: true } })
}

/** Template columns parents may see (never the scoring features). */
export const templateSummarySelect = {
  id: true,
  version: true,
  durationSec: true,
  mirrorPolicy: true,
  lateralized: true,
  activeParts: true,
} as const

export const exerciseCardSelect = {
  id: true,
  slug: true,
  title: true,
  description: true,
  childPrompt: true,
  difficulty: true,
  bodyFocus: true,
  source: true,
} as const

/** Rows for summarizeExerciseProgress (latest score of each session). */
export async function loadProgressRows(where: { childId: string; exerciseId?: { in: string[] } }) {
  const sessions = await prisma.exerciseSession.findMany({
    where,
    select: {
      id: true,
      status: true,
      createdAt: true,
      exercise: { select: { id: true, slug: true, title: true, difficulty: true } },
      template: { select: { id: true, version: true } },
      scores: {
        select: { algorithmVersion: true, status: true, overall: true, stars: true, detail: true },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
    orderBy: { createdAt: 'asc' },
  })
  return sessions.map((s) => {
    const score = s.scores[0]
    const warnings = (score?.detail as { quality?: { warnings?: unknown } } | null)?.quality?.warnings
    return {
      id: s.id,
      status: s.status,
      createdAt: s.createdAt,
      exercise: s.exercise,
      template: s.template,
      score: score
        ? {
            algorithmVersion: score.algorithmVersion,
            status: score.status,
            overall: score.overall,
            stars: score.stars,
            warnings: Array.isArray(warnings) ? warnings.filter((w): w is string => typeof w === 'string') : [],
          }
        : null,
    }
  })
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/** Works in every mode so the UI can decide what to show. */
exercisesRouter.get(
  '/capabilities',
  asyncHandler(async (req, res) => {
    const available = exerciseAccess(env.EXERCISE_MODE, req.user?.role)
    // Do not probe the ML server for users who cannot use exercises anyway.
    const caps = available ? await getMlCapabilities() : { reachable: false, legacy: true, acceptsWebm: false }
    const acceptsWebm = caps.acceptsWebm || (caps.reachable && caps.legacy && env.EXERCISE_WEBM_AS_MKV)
    return res.json({
      mode: env.EXERCISE_MODE,
      available,
      mlReachable: caps.reachable,
      mlLegacy: caps.legacy,
      acceptsWebm,
      acceptedExtensions: acceptedExtensions(acceptsWebm),
      maxDurationSec: env.EXERCISE_MAX_DURATION_SEC,
      maxUploadMb: env.EXERCISE_MAX_UPLOAD_MB,
      recordFps: 15,
    })
  }),
)

exercisesRouter.get(
  '/consent-statement',
  requireExercisesEnabled,
  asyncHandler(async (_req, res) => {
    return res.json({ statement: await getCurrentExerciseConsentStatement() })
  }),
)

/** Published exercises; with ?childId= each card also carries that child's attempts and stars. */
exercisesRouter.get(
  '/',
  requireExercisesEnabled,
  asyncHandler(async (req, res) => {
    const rawChildId = req.query.childId
    let childId: string | null = null
    if (rawChildId !== undefined && rawChildId !== '') {
      if (!uuidSchema.safeParse(rawChildId).success) return res.status(400).json({ error: 'INVALID_CHILD_ID' })
      const child = await findOwnedChild(rawChildId, req.user!.id)
      if (!child) return res.status(404).json({ error: 'CHILD_NOT_FOUND' })
      childId = child.id
    }

    const exercises = await prisma.exercise.findMany({
      where: { status: ExerciseStatus.PUBLISHED, currentTemplateId: { not: null } },
      select: { ...exerciseCardSelect, currentTemplate: { select: templateSummarySelect } },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    })

    const stats = new Map<string, ReturnType<typeof childStatsFromProgress>>()
    if (childId && exercises.length) {
      const rows = await loadProgressRows({ childId, exerciseId: { in: exercises.map((e) => e.id) } })
      for (const p of summarizeExerciseProgress(rows)) stats.set(p.exercise.id, childStatsFromProgress(p))
    }
    const empty = { attempts: 0, scoredAttempts: 0, bestStars: null, lastStars: null, lastAt: null }

    return res.json({
      exercises: exercises
        .filter((e) => e.currentTemplate)
        .map((e) => serializeExercise(e, e.currentTemplate!, childId ? (stats.get(e.id) ?? empty) : undefined)),
    })
  }),
)

/** One published exercise with the guide skeleton of its current template. */
exercisesRouter.get(
  '/:id',
  requireExercisesEnabled,
  asyncHandler(async (req, res) => {
    const id = uuidSchema.safeParse(req.params.id)
    if (!id.success) return res.status(404).json({ error: 'EXERCISE_NOT_FOUND' })
    const exercise = await prisma.exercise.findFirst({
      where: { id: id.data, status: ExerciseStatus.PUBLISHED },
      select: {
        ...exerciseCardSelect,
        currentTemplate: { select: { ...templateSummarySelect, templateHash: true, guideTrack: true } },
      },
    })
    if (!exercise?.currentTemplate) return res.status(404).json({ error: 'EXERCISE_NOT_FOUND' })

    // Informational only (identifies the template version). Express would
    // answer 304 to a matching If-None-Match, which Axios treats as an error.
    delete req.headers['if-none-match']
    res.setHeader('ETag', `"${exercise.currentTemplate.templateHash}"`)
    return res.json({
      exercise: serializeExercise(exercise, exercise.currentTemplate),
      guide: serializeGuideTemplate(exercise.currentTemplate),
    })
  }),
)
