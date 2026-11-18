import { Router } from 'express'
import { ExerciseStatus } from '@prisma/client'
import { childStatsFromProgress, summarizeExerciseProgress } from '../lib/exerciseData'
import { uuidSchema } from '../lib/exerciseInput'
import { serializeExercise } from '../lib/exerciseSerializers'
import {
  buildExercisePlan,
  isEmptyPersonalization,
  personalizationSchema,
  serializePersonalization,
  suggestExerciseSettings,
} from '../lib/personalization'
import { prisma } from '../lib/prisma'
import { isSchemaOutdatedError } from '../lib/prismaErrors'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../middleware/asyncHandler'
import { exerciseCardSelect, findOwnedChild, loadProgressRows, requireExercisesEnabled, templateSummarySelect } from './exercises'

/**
 * Mounted at /children/:childId — the child's personalisation (what the
 * parent told the app) and the practice plan derived from it.
 */
export const childPersonalizationRouter = Router({ mergeParams: true })

childPersonalizationRouter.use(requireAuth)

/** The stored preferences, or the defaults on a database that has no personalisation table yet. */
export async function loadPersonalization(childId: string) {
  try {
    return serializePersonalization(await prisma.childPersonalization.findUnique({ where: { childId } }))
  } catch (error) {
    if (isSchemaOutdatedError(error)) return serializePersonalization(null)
    throw error
  }
}

childPersonalizationRouter.get(
  '/personalization',
  asyncHandler(async (req, res) => {
    const child = await findOwnedChild(req.params.childId, req.user!.id)
    if (!child) return res.status(404).json({ error: 'CHILD_NOT_FOUND' })

    const personalization = serializePersonalization(
      await prisma.childPersonalization.findUnique({ where: { childId: child.id } }),
    )
    return res.json({ personalization, empty: isEmptyPersonalization(personalization) })
  }),
)

childPersonalizationRouter.put(
  '/personalization',
  asyncHandler(async (req, res) => {
    const input = personalizationSchema.parse(req.body)
    const child = await findOwnedChild(req.params.childId, req.user!.id)
    if (!child) return res.status(404).json({ error: 'CHILD_NOT_FOUND' })

    const row = await prisma.childPersonalization.upsert({
      where: { childId: child.id },
      create: { childId: child.id, ...input },
      update: input,
    })
    const personalization = serializePersonalization(row)
    return res.json({ personalization, empty: isEmptyPersonalization(personalization) })
  }),
)

/**
 * What to practise next and with which settings. `?exerciseId=` also returns
 * the suggested settings of that one exercise (for the practice page).
 */
childPersonalizationRouter.get(
  '/exercise-plan',
  requireExercisesEnabled,
  asyncHandler(async (req, res) => {
    const child = await findOwnedChild(req.params.childId, req.user!.id)
    if (!child) return res.status(404).json({ error: 'CHILD_NOT_FOUND' })

    const [prefs, exercises, rows] = await Promise.all([
      loadPersonalization(child.id),
      prisma.exercise.findMany({
        where: { status: ExerciseStatus.PUBLISHED, currentTemplateId: { not: null } },
        select: { ...exerciseCardSelect, currentTemplate: { select: templateSummarySelect } },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      }),
      loadProgressRows({ childId: child.id }),
    ])
    const published = exercises.filter((e) => e.currentTemplate)
    const progress = summarizeExerciseProgress(rows)
    const byExercise = new Map(progress.map((p) => [p.exercise.id, p]))

    const plan = buildExercisePlan({
      prefs,
      exercises: published,
      progress,
      sessionDates: rows.map((r) => r.createdAt),
      now: new Date(),
    })

    const empty = { attempts: 0, scoredAttempts: 0, bestStars: null, lastStars: null, lastAt: null }
    const card = (id: string) => {
      const exercise = published.find((e) => e.id === id)!
      const stats = byExercise.get(id)
      return serializeExercise(exercise, exercise.currentTemplate!, stats ? childStatsFromProgress(stats) : empty)
    }

    const rawExerciseId = req.query.exerciseId
    let settings: ReturnType<typeof suggestExerciseSettings> | undefined
    if (rawExerciseId !== undefined && rawExerciseId !== '') {
      const parsed = uuidSchema.safeParse(rawExerciseId)
      const exercise = parsed.success ? published.find((e) => e.id === parsed.data) : undefined
      if (!exercise) return res.status(404).json({ error: 'EXERCISE_NOT_FOUND' })
      settings = suggestExerciseSettings(prefs, exercise, byExercise.get(exercise.id))
    }

    return res.json({
      plan: {
        nickname: prefs.nickname,
        level: plan.level,
        weekly: plan.weekly,
        recommendations: plan.recommendations.map((r) => ({
          kind: r.kind,
          reason: r.reason,
          settings: r.settings,
          exercise: card(r.exerciseId),
        })),
      },
      ...(settings ? { settings } : {}),
    })
  }),
)
