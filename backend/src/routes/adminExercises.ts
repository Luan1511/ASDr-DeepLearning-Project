import { Router, type NextFunction, type Request, type Response } from 'express'
import fs from 'fs'
import multer from 'multer'
import path from 'path'
import { randomUUID } from 'crypto'
import { ExerciseSessionStatus, ExerciseStatus, Prisma, UserRole } from '@prisma/client'
import { env } from '../lib/env'
import { prisma } from '../lib/prisma'
import {
  ADMIN_ATTESTATION_TEXT,
  TEMPLATE_SOURCE_PATTERN,
  chooseMlUpload,
  compileTemplateSchema,
  createExerciseSchema,
  isAttested,
  isExerciseExtension,
  publishSchema,
  templateSourceBodySchema,
  updateExerciseSchema,
  uuidSchema,
} from '../lib/exerciseInput'
import { summarizeExerciseStats } from '../lib/exerciseData'
import {
  serializeAdminExercise,
  serializeAdminTemplate,
  serializeBuildTemplateResult,
  serializeGuideTemplate,
} from '../lib/exerciseSerializers'
import { requireAuth } from '../middleware/auth'
import { requireRole } from '../middleware/requireRole'
import { asyncHandler } from '../middleware/asyncHandler'
import { sanitizeFps } from '../services/gaitFeatures'
import { getExerciseQueueStats, EXERCISE_UPLOAD_DIR } from '../services/exerciseProcessor'
import { getMlCapabilities } from '../services/mlCapabilities'
import { OpenPoseApiError, openposeService } from '../services/openposeService'
import {
  BUILTIN_EXERCISES,
  buildTemplate,
  type BuildTemplateResult,
  type CompiledTemplate,
  type MirrorPolicyValue,
} from '../services/imitation'

/**
 * Admin exercise authoring: metadata, adult template sources, template
 * versions, publishing, built-ins, queue and per-exercise statistics.
 * Works in every EXERCISE_MODE (off only stops the worker). Admins never see
 * child names here.
 */
export const adminExercisesRouter = Router()

adminExercisesRouter.use(requireAuth)
adminExercisesRouter.use(requireRole(UserRole.ADMIN))

/** Everything an admin DTO needs except the scoring features and guide skeleton. */
const adminTemplateSelect = {
  id: true,
  version: true,
  source: true,
  sourceSubjectId: true,
  sourceFps: true,
  fpsSource: true,
  mirrorPolicy: true,
  templateHash: true,
  durationSec: true,
  activeStartSec: true,
  activeEndSec: true,
  lateralized: true,
  activeParts: true,
  quality: true,
  selfTest: true,
  sourceMlSubjectDeletedAt: true,
  createdAt: true,
} satisfies Prisma.ExerciseTemplateSelect

const adminExerciseInclude = {
  templates: { select: adminTemplateSelect, orderBy: { version: 'desc' } },
} satisfies Prisma.ExerciseInclude

async function exerciseAttemptStats(exerciseIds: string[]) {
  const stats = new Map<string, { attempts: number; insufficientRate: number }>()
  if (!exerciseIds.length) return stats
  const groups = await prisma.exerciseSession.groupBy({
    by: ['exerciseId', 'status'],
    where: { exerciseId: { in: exerciseIds } },
    _count: { _all: true },
  })
  const acc = new Map<string, { attempts: number; scored: number; insufficient: number }>()
  for (const g of groups) {
    const entry = acc.get(g.exerciseId) ?? { attempts: 0, scored: 0, insufficient: 0 }
    entry.attempts += g._count._all
    if (g.status === ExerciseSessionStatus.SCORED) entry.scored += g._count._all
    if (g.status === ExerciseSessionStatus.INSUFFICIENT) entry.insufficient += g._count._all
    acc.set(g.exerciseId, entry)
  }
  for (const [id, e] of acc) {
    const judged = e.scored + e.insufficient
    stats.set(id, {
      attempts: e.attempts,
      insufficientRate: judged ? Math.round((e.insufficient / judged) * 1000) / 1000 : 0,
    })
  }
  return stats
}

async function loadAdminExercise(id: string) {
  const exercise = await prisma.exercise.findUnique({ where: { id }, include: adminExerciseInclude })
  if (!exercise) return null
  const stats = await exerciseAttemptStats([id])
  return serializeAdminExercise(exercise, stats.get(id))
}

function parseId(value: unknown): string | null {
  const parsed = uuidSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

function isUniqueViolation(error: unknown, field?: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') return false
  if (!field) return true
  const target = (error.meta as { target?: unknown } | undefined)?.target
  return Array.isArray(target) ? target.includes(field) : String(target ?? '').includes(field)
}

/** A JSON 404/422 from the ML server means the subject is gone (or was never stored). */
function isGoneOnMl(error: unknown): boolean {
  return error instanceof OpenPoseApiError && error.kind === 'http' && (error.status === 404 || error.status === 422)
}

async function deleteTemplateSourceOnMl(subjectId: string): Promise<void> {
  try {
    await openposeService.deleteSubject(subjectId)
  } catch (error) {
    if (!isGoneOnMl(error)) throw error
  }
}

function fpsFromDuration(numFrames: number, durationMs: number | undefined): number | null {
  if (!durationMs || numFrames < 2) return null
  return sanitizeFps(numFrames / (durationMs / 1000))
}

/** Next version number of an exercise's templates (versions are immutable). */
async function nextTemplateVersion(tx: Prisma.TransactionClient, exerciseId: string): Promise<number> {
  const latest = await tx.exerciseTemplate.findFirst({
    where: { exerciseId },
    orderBy: { version: 'desc' },
    select: { version: true },
  })
  return (latest?.version ?? 0) + 1
}

function templateData(
  compiled: CompiledTemplate,
  result: BuildTemplateResult,
  extra: {
    source: 'ML_SUBJECT' | 'BUILTIN_SYNTHETIC'
    sourceSubjectId: string | null
    sourceAttestation: Prisma.InputJsonValue | null
    sourceFps: number
    fpsSource: string
    mirrorPolicy: MirrorPolicyValue
    createdById: string | null
  },
) {
  return {
    source: extra.source,
    sourceSubjectId: extra.sourceSubjectId,
    sourceAttestation: extra.sourceAttestation ?? Prisma.JsonNull,
    sourceFps: extra.sourceFps,
    fpsSource: extra.fpsSource,
    mirrorPolicy: extra.mirrorPolicy,
    algorithmVersion: compiled.features.algorithmVersion,
    templateHash: compiled.templateHash,
    activeStartSec: compiled.activeStartSec,
    activeEndSec: compiled.activeEndSec,
    durationSec: compiled.durationSec,
    lateralized: compiled.lateralized,
    activeParts: compiled.activeParts,
    guideTrack: compiled.guideTrack as unknown as Prisma.InputJsonValue,
    features: compiled.features as unknown as Prisma.InputJsonValue,
    quality: result.gates as unknown as Prisma.InputJsonValue,
    selfTest: result.selfTest ? (result.selfTest as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
    createdById: extra.createdById,
  }
}

/** Insert a new template version; retries once if another request took the same version. */
async function createTemplateVersion(exerciseId: string, data: ReturnType<typeof templateData>) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        const version = await nextTemplateVersion(tx, exerciseId)
        return tx.exerciseTemplate.create({ data: { ...data, exerciseId, version }, select: adminTemplateSelect })
      })
    } catch (error) {
      if (attempt === 0 && isUniqueViolation(error)) continue
      throw error
    }
  }
}

// ---------------------------------------------------------------------------
// Exercises
// ---------------------------------------------------------------------------

adminExercisesRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const exercises = await prisma.exercise.findMany({
      include: adminExerciseInclude,
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    })
    const stats = await exerciseAttemptStats(exercises.map((e) => e.id))
    return res.json({ exercises: exercises.map((e) => serializeAdminExercise(e, stats.get(e.id))) })
  }),
)

adminExercisesRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = createExerciseSchema.parse(req.body)
    try {
      const exercise = await prisma.exercise.create({
        data: { ...input, sortOrder: input.sortOrder ?? 0, source: 'ADMIN', createdById: req.user!.id },
        include: adminExerciseInclude,
      })
      return res.status(201).json({ exercise: serializeAdminExercise(exercise) })
    } catch (error) {
      if (isUniqueViolation(error, 'slug')) return res.status(409).json({ error: 'SLUG_TAKEN' })
      throw error
    }
  }),
)

adminExercisesRouter.get(
  '/queue',
  asyncHandler(async (_req, res) => {
    const [counts, recentFailures] = await Promise.all([
      getExerciseQueueStats(),
      prisma.exerciseSession.findMany({
        where: { status: ExerciseSessionStatus.FAILED },
        select: { id: true, createdAt: true, lastError: true },
        orderBy: { updatedAt: 'desc' },
        take: 10,
      }),
    ])
    return res.json({ ...counts, recentFailures })
  }),
)

/**
 * Create or update the synthetic built-in exercises as DRAFTs. Never
 * publishes and never overwrites admin edits to their metadata; a changed
 * demonstration becomes a new (unpublished) template version.
 */
adminExercisesRouter.post(
  '/builtins/sync',
  asyncHandler(async (req, res) => {
    let created = 0
    let newVersions = 0
    let unchanged = 0
    const failed: Array<{ slug: string; reason: string }> = []

    for (const builtin of BUILTIN_EXERCISES) {
      const result = buildTemplate({ frames: builtin.makeFrames(), fps: builtin.fps, mirrorPolicy: builtin.mirrorPolicy })
      if (!result.ok || !result.template) {
        failed.push({ slug: builtin.slug, reason: 'TEMPLATE_QUALITY_FAILED' })
        continue
      }
      const data = templateData(result.template, result, {
        source: 'BUILTIN_SYNTHETIC',
        sourceSubjectId: null,
        sourceAttestation: null,
        sourceFps: builtin.fps,
        fpsSource: 'synthetic',
        mirrorPolicy: builtin.mirrorPolicy,
        createdById: req.user!.id,
      })

      const existing = await prisma.exercise.findUnique({ where: { slug: builtin.slug }, select: { id: true, source: true } })
      if (!existing) {
        try {
          await prisma.exercise.create({
            data: {
              slug: builtin.slug,
              title: builtin.title,
              description: builtin.description,
              childPrompt: builtin.childPrompt,
              difficulty: builtin.difficulty,
              bodyFocus: builtin.bodyFocus,
              source: 'BUILTIN_SYNTHETIC',
              status: ExerciseStatus.DRAFT,
              sortOrder: builtin.sortOrder,
              createdById: req.user!.id,
              templates: { create: { ...data, version: 1 } },
            },
          })
          created += 1
        } catch (error) {
          if (!isUniqueViolation(error)) throw error
          failed.push({ slug: builtin.slug, reason: 'CONCURRENT_SYNC' })
        }
        continue
      }
      if (existing.source !== 'BUILTIN_SYNTHETIC') {
        // An admin exercise already uses this slug; leave it alone.
        failed.push({ slug: builtin.slug, reason: 'SLUG_TAKEN' })
        continue
      }
      const same = await prisma.exerciseTemplate.count({
        where: { exerciseId: existing.id, templateHash: result.template.templateHash },
      })
      if (same) {
        unchanged += 1
        continue
      }
      await createTemplateVersion(existing.id, data)
      newVersions += 1
    }

    return res.json({ created, newVersions, unchanged, failed })
  }),
)

// Precheck for the multipart route below (before the video is streamed to disk).
const requireExerciseExists = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const id = parseId(req.params.id)
  const exercise = id ? await prisma.exercise.findUnique({ where: { id }, select: { id: true } }) : null
  if (!exercise) return res.status(404).json({ error: 'EXERCISE_NOT_FOUND' })
  return next()
})

adminExercisesRouter.get(
  '/:id/stats',
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id)
    if (!id || !(await prisma.exercise.count({ where: { id } }))) {
      return res.status(404).json({ error: 'EXERCISE_NOT_FOUND' })
    }
    const [attempts, sessions] = await Promise.all([
      prisma.exerciseSession.count({ where: { exerciseId: id } }),
      prisma.exerciseSession.findMany({
        where: { exerciseId: id, status: { in: [ExerciseSessionStatus.SCORED, ExerciseSessionStatus.INSUFFICIENT] } },
        select: {
          scores: {
            select: { status: true, overall: true, mode: true, reasonCodes: true },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      }),
    ])
    const scores = sessions.flatMap((s) => s.scores)
    return res.json(summarizeExerciseStats(attempts, scores))
  }),
)

adminExercisesRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id)
    const input = updateExerciseSchema.parse(req.body)
    const exercise = id ? await prisma.exercise.findUnique({ where: { id }, select: { id: true } }) : null
    if (!exercise) return res.status(404).json({ error: 'EXERCISE_NOT_FOUND' })
    try {
      await prisma.exercise.update({ where: { id: exercise.id }, data: input })
    } catch (error) {
      if (isUniqueViolation(error, 'slug')) return res.status(409).json({ error: 'SLUG_TAKEN' })
      throw error
    }
    return res.json({ exercise: await loadAdminExercise(exercise.id) })
  }),
)

adminExercisesRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id)
    const exercise = id
      ? await prisma.exercise.findUnique({
          where: { id },
          select: { id: true, templates: { select: { sourceSubjectId: true, sourceMlSubjectDeletedAt: true } } },
        })
      : null
    if (!exercise) return res.status(404).json({ error: 'EXERCISE_NOT_FOUND' })
    if (await prisma.exerciseSession.count({ where: { exerciseId: exercise.id } })) {
      return res.status(409).json({ error: 'EXERCISE_HAS_SESSIONS' })
    }

    // Remove the adult source recordings first so no ML data is left without a row.
    for (const t of exercise.templates) {
      if (!t.sourceSubjectId || t.sourceMlSubjectDeletedAt || !TEMPLATE_SOURCE_PATTERN.test(t.sourceSubjectId)) continue
      try {
        await deleteTemplateSourceOnMl(t.sourceSubjectId)
      } catch {
        return res.status(503).json({ error: 'ML_UNAVAILABLE' })
      }
    }
    try {
      await prisma.exercise.delete({ where: { id: exercise.id } })
    } catch (error) {
      // A session created meanwhile (FK RESTRICT).
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
        return res.status(409).json({ error: 'EXERCISE_HAS_SESSIONS' })
      }
      throw error
    }
    return res.json({ deleted: true })
  }),
)

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

const templateUploadDir = path.join(process.cwd(), EXERCISE_UPLOAD_DIR, 'templates')

const templateUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      fs.mkdirSync(templateUploadDir, { recursive: true })
      cb(null, templateUploadDir)
    },
    filename: (_req, file, cb) => {
      cb(null, `tpl-${randomUUID()}${path.extname(file.originalname || '').toLowerCase()}`)
    },
  }),
  limits: { fileSize: env.SKELETON_MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase()
    if (isExerciseExtension(ext) && file.mimetype.startsWith('video/')) return cb(null, true)
    return cb(new Error('UNSUPPORTED_FILE_TYPE'))
  },
})

/**
 * Extract an ADULT demonstration into a new "tpl_<uuid>" ML subject. Only
 * such subjects can become template sources: a shared ML server may hold
 * other databases' child subjects that this database cannot recognise.
 */
adminExercisesRouter.post(
  '/:id/template-sources',
  requireExerciseExists,
  templateUpload.single('video'),
  asyncHandler(async (req, res) => {
    const file = req.file
    try {
      if (!isAttested(req.body?.attestation)) return res.status(422).json({ error: 'ATTESTATION_REQUIRED' })
      if (!file) return res.status(400).json({ error: 'MISSING_FILE' })
      const body = templateSourceBodySchema.parse(req.body)

      const caps = await getMlCapabilities()
      const mlUpload = chooseMlUpload({
        ext: path.extname(file.filename),
        legacy: caps.legacy,
        webmAsMkv: env.EXERCISE_WEBM_AS_MKV,
      })
      if (mlUpload === 'UNSUPPORTED') return res.status(415).json({ error: 'RECORDING_FORMAT_UNSUPPORTED' })

      const subjectId = `tpl_${randomUUID()}`
      const extract = await openposeService.extractSubject({
        filePath: file.path,
        originalFilename: mlUpload.filename,
        mimeType: mlUpload.mimeType,
        subjectId,
        timeoutMs: env.EXERCISE_EXTRACT_TIMEOUT_MS,
      })
      if (extract.subject_id && extract.subject_id !== subjectId) {
        // ML 1.0 ignored subject_id: the result cannot be recognised as a
        // template source later, so do not leave it on the ML server.
        await deleteTemplateSourceOnMl(extract.subject_id).catch(() => {})
        return res.status(502).json({
          error: 'ML_SERVER_ERROR',
          message: 'The ML server ignored subject_id; template sources need an ML server that honours it (gate G0).',
        })
      }

      let keypoints
      try {
        keypoints = await openposeService.getSubjectKeypoints(subjectId)
      } catch (error) {
        await deleteTemplateSourceOnMl(subjectId).catch(() => {})
        throw error
      }
      const numFrames = keypoints.frames?.length ?? keypoints.num_frames ?? 0
      const mlFps = sanitizeFps(keypoints.video?.fps ?? extract.video?.fps ?? null)
      const durationFps = mlFps === null ? fpsFromDuration(numFrames, body.durationMs) : null
      return res.status(201).json({
        sourceSubjectId: subjectId,
        numFrames,
        fps: mlFps ?? durationFps,
        fpsSource: mlFps !== null ? 'ml' : durationFps !== null ? 'duration' : null,
      })
    } finally {
      if (file?.path) fs.promises.unlink(file.path).catch(() => {})
    }
  }),
)

adminExercisesRouter.post(
  '/:id/templates',
  asyncHandler(async (req, res) => {
    if (!isAttested(req.body?.attestation)) return res.status(422).json({ error: 'ATTESTATION_REQUIRED' })
    const input = compileTemplateSchema.parse(req.body)
    if (!TEMPLATE_SOURCE_PATTERN.test(input.sourceSubjectId)) {
      return res.status(422).json({ error: 'SOURCE_SUBJECT_NOT_ALLOWED' })
    }
    const id = parseId(req.params.id)
    const exercise = id ? await prisma.exercise.findUnique({ where: { id }, select: { id: true } }) : null
    if (!exercise) return res.status(404).json({ error: 'EXERCISE_NOT_FOUND' })

    const keypoints = await openposeService.getSubjectKeypoints(input.sourceSubjectId)
    const mlFps = sanitizeFps(keypoints.video?.fps ?? null)
    const adminFps = input.fps !== undefined ? sanitizeFps(input.fps) : null
    const fps = adminFps ?? mlFps
    if (fps === null) return res.status(422).json({ error: 'TEMPLATE_FPS_REQUIRED' })
    const fpsSource = adminFps === null ? 'ml' : mlFps !== null && Math.abs(mlFps - adminFps) < 1e-6 ? 'ml' : 'admin'

    const width = keypoints.video?.width ?? null
    const height = keypoints.video?.height ?? null
    const result = buildTemplate({
      frames: keypoints.frames ?? [],
      fps,
      mirrorPolicy: input.mirrorPolicy,
      trim: input.trim,
      videoSize: width && height ? { width, height } : null,
    })
    if (result.gates.some((g) => g.code === 'TEMPLATE_FPS_REQUIRED' && !g.ok)) {
      return res.status(422).json({ error: 'TEMPLATE_FPS_REQUIRED' })
    }

    const dto = serializeBuildTemplateResult(result)
    if (input.dryRun) return res.json({ result: dto })
    if (!result.ok || !result.template) {
      return res.status(422).json({ error: 'TEMPLATE_QUALITY_FAILED', gates: dto.gates, result: dto })
    }

    const template = await createTemplateVersion(
      exercise.id,
      templateData(result.template, result, {
        source: 'ML_SUBJECT',
        sourceSubjectId: input.sourceSubjectId,
        sourceAttestation: { text: ADMIN_ATTESTATION_TEXT, adminId: req.user!.id, at: new Date().toISOString() },
        sourceFps: fps,
        fpsSource,
        mirrorPolicy: input.mirrorPolicy,
        createdById: req.user!.id,
      }),
    )
    const current = await prisma.exercise.findUnique({ where: { id: exercise.id }, select: { currentTemplateId: true } })
    return res.status(201).json({
      template: serializeAdminTemplate(template, current?.currentTemplateId ?? null),
      result: dto,
    })
  }),
)

adminExercisesRouter.post(
  '/:id/publish',
  asyncHandler(async (req, res) => {
    const { templateId } = publishSchema.parse(req.body)
    const id = parseId(req.params.id)
    const exercise = id ? await prisma.exercise.findUnique({ where: { id }, select: { id: true } }) : null
    if (!exercise) return res.status(404).json({ error: 'EXERCISE_NOT_FOUND' })

    const template = await prisma.exerciseTemplate.findUnique({
      where: { id: templateId },
      select: { id: true, exerciseId: true, quality: true },
    })
    if (!template || template.exerciseId !== exercise.id) {
      return res.status(409).json({ error: 'TEMPLATE_NOT_FOR_EXERCISE' })
    }
    const gates = Array.isArray(template.quality) ? (template.quality as Array<{ ok?: unknown }>) : []
    if (!gates.length || gates.some((g) => g?.ok !== true)) {
      return res.status(422).json({ error: 'TEMPLATE_QUALITY_FAILED', gates: template.quality })
    }

    await prisma.exercise.update({
      where: { id: exercise.id },
      data: { currentTemplateId: template.id, status: ExerciseStatus.PUBLISHED },
    })
    return res.json({ exercise: await loadAdminExercise(exercise.id) })
  }),
)

/** Preview of any template version (drafts included) for the admin editor. */
adminExercisesRouter.get(
  '/:id/templates/:templateId/guide',
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id)
    const templateId = parseId(req.params.templateId)
    const template =
      id && templateId
        ? await prisma.exerciseTemplate.findFirst({
            where: { id: templateId, exerciseId: id },
            select: {
              id: true,
              version: true,
              durationSec: true,
              mirrorPolicy: true,
              lateralized: true,
              activeParts: true,
              guideTrack: true,
            },
          })
        : null
    if (!template) return res.status(404).json({ error: 'TEMPLATE_NOT_FOUND' })
    return res.json({ guide: serializeGuideTemplate(template) })
  }),
)

/** Delete the adult source recording on the ML server (the compiled template stays usable). */
adminExercisesRouter.delete(
  '/:id/templates/:templateId/source-subject',
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id)
    const templateId = parseId(req.params.templateId)
    const template =
      id && templateId
        ? await prisma.exerciseTemplate.findFirst({
            where: { id: templateId, exerciseId: id },
            select: { id: true, sourceSubjectId: true, sourceMlSubjectDeletedAt: true },
          })
        : null
    if (!template) return res.status(404).json({ error: 'TEMPLATE_NOT_FOUND' })
    if (!template.sourceSubjectId || !TEMPLATE_SOURCE_PATTERN.test(template.sourceSubjectId)) {
      return res.status(404).json({ error: 'SOURCE_SUBJECT_NOT_FOUND' })
    }
    if (!template.sourceMlSubjectDeletedAt) {
      await deleteTemplateSourceOnMl(template.sourceSubjectId)
      await prisma.exerciseTemplate.update({
        where: { id: template.id },
        data: { sourceMlSubjectDeletedAt: new Date() },
      })
    }
    return res.json({ deleted: true })
  }),
)
