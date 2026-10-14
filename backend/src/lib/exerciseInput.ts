/**
 * Request validation and upload rules for the exercise API. Pure (no env, no
 * database) so the bounds can be unit-tested; routes pass the configured limits.
 */
import { z } from 'zod'

export type ExerciseMode = 'off' | 'admin_only' | 'on'

/** off: nobody; admin_only: admins (until calibration gate C1); on: every signed-in user. */
export function exerciseAccess(mode: ExerciseMode, role: string | undefined): boolean {
  if (mode === 'on') return true
  if (mode === 'admin_only') return role === 'ADMIN'
  return false
}

// ---------------------------------------------------------------------------
// Video files
// ---------------------------------------------------------------------------

export const EXERCISE_EXTENSIONS = ['.mp4', '.mov', '.mkv', '.webm'] as const
export type ExerciseExtension = (typeof EXERCISE_EXTENSIONS)[number]

const ML_MIME: Record<ExerciseExtension, string> = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',
}

export function isExerciseExtension(ext: string): ext is ExerciseExtension {
  return (EXERCISE_EXTENSIONS as readonly string[]).includes(ext)
}

/**
 * File name and type sent to the ML server. Never derived from user input
 * (the original file name is neither stored nor forwarded). ML 1.0 rejects
 * .webm; Matroska is a superset of WebM, so once the owner's probe showed the
 * old server decodes it, EXERCISE_WEBM_AS_MKV sends WebM recordings as .mkv.
 */
export function chooseMlUpload(params: {
  ext: string
  legacy: boolean
  webmAsMkv: boolean
}): { filename: string; mimeType: string } | 'UNSUPPORTED' {
  const ext = params.ext.toLowerCase()
  if (!isExerciseExtension(ext)) return 'UNSUPPORTED'
  if (ext === '.webm' && params.legacy) {
    return params.webmAsMkv ? { filename: 'session.mkv', mimeType: ML_MIME['.mkv'] } : 'UNSUPPORTED'
  }
  return { filename: `session${ext}`, mimeType: ML_MIME[ext] }
}

/** Extensions a browser may upload given the ML server's capabilities. */
export function acceptedExtensions(acceptsWebm: boolean): string[] {
  return EXERCISE_EXTENSIONS.filter((ext) => ext !== '.webm' || acceptsWebm)
}

// ---------------------------------------------------------------------------
// Recording length
// ---------------------------------------------------------------------------

export const EXERCISE_MIN_DURATION_MS = 1000
const SLOWEST_PLAYBACK_RATE = 0.75

/**
 * Longest accepted recording for a template. The practice page stops on its
 * own after lead + demonstration + tail (FOLLOW_ALONG) or 1.5 x the template
 * plus 2 s (AFTER_DEMO); twice that, and at least 10 s more, leaves room for
 * late starts and phone uploads while bounding GPU work. Never above `capMs`.
 */
export function maxRecordingMs(templateDurationSec: number, mode: 'FOLLOW_ALONG' | 'AFTER_DEMO', capMs: number): number {
  const templateMs = Math.max(0, templateDurationSec) * 1000
  const expected = mode === 'FOLLOW_ALONG' ? 1500 + templateMs / SLOWEST_PLAYBACK_RATE + 1500 : 1.5 * templateMs + 2000
  return Math.min(capMs, Math.ceil(Math.max(expected * 2, expected + 10_000)))
}

/** Shorter clips cannot cover the demonstration (scoring would say VIDEO_TOO_SHORT). */
export function minRecordingMs(templateDurationSec: number): number {
  return Math.max(EXERCISE_MIN_DURATION_MS, Math.ceil(0.6 * Math.max(0, templateDurationSec) * 1000))
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

/** Multipart fields arrive as strings; empty strings mean "not sent". */
const blankToUndefined = (val: unknown) => (val === '' || val === null ? undefined : val)

const optionalInt = (schema: z.ZodNumber) => z.preprocess(blankToUndefined, z.coerce.number().pipe(schema).optional())

export const uuidSchema = z.string().uuid()

/** Body of POST /exercise-sessions/upload; `maxDurationMs` = EXERCISE_MAX_DURATION_SEC x 1000. */
export function makeExerciseUploadBodySchema(maxDurationMs: number) {
  return z.object({
    durationMs: z.preprocess(
      blankToUndefined,
      z.coerce.number().int().min(EXERCISE_MIN_DURATION_MS).max(maxDurationMs),
    ),
    videoWidth: optionalInt(z.number().int().positive().max(16384)),
    videoHeight: optionalInt(z.number().int().positive().max(16384)),
    recordedVia: z.enum(['WEBCAM', 'UPLOAD']),
    practiceMode: z.enum(['FOLLOW_ALONG', 'AFTER_DEMO']),
    playbackRate: z.preprocess(
      (val) => blankToUndefined(val) ?? 1,
      z.coerce.number().refine((v) => v === 0.75 || v === 1, { message: 'playbackRate must be 0.75 or 1' }),
    ),
    guideOffsetMs: optionalInt(z.number().int().min(0).max(maxDurationMs)),
  })
}

export type ExerciseUploadBody = z.infer<ReturnType<typeof makeExerciseUploadBodySchema>>

export const sessionListQuerySchema = z.object({
  childId: uuidSchema,
  exerciseId: uuidSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

export const exerciseConsentBodySchema = z.object({
  accepted: z.literal(true),
  version: z.string().min(1).max(100),
  scopes: z.array(z.string().min(1).max(50)).max(10),
})

export const SLUG_PATTERN = /^[a-z0-9-]{3,60}$/
export const BODY_FOCUS = ['ARMS', 'LEGS', 'TRUNK'] as const

/** Shown in the admin list only; stripped from admin input so parents never see it. */
export const BUILTIN_TITLE_PREFIX = '[Mẫu tổng hợp] '

export function stripBuiltinTitlePrefix(title: string): string {
  const trimmed = title.trim()
  return trimmed.startsWith(BUILTIN_TITLE_PREFIX.trim()) ? trimmed.slice(BUILTIN_TITLE_PREFIX.trim().length).trim() : trimmed
}

const exerciseMetadataShape = {
  slug: z.string().trim().regex(SLUG_PATTERN),
  title: z.string().trim().transform(stripBuiltinTitlePrefix).pipe(z.string().min(1).max(80)),
  description: z.string().trim().max(500),
  childPrompt: z.string().trim().max(120),
  difficulty: z.coerce.number().int().min(1).max(3),
  bodyFocus: z
    .array(z.enum(BODY_FOCUS))
    .min(1)
    .transform((list) => Array.from(new Set(list))),
  sortOrder: z.coerce.number().int().min(-100000).max(100000),
}

export const createExerciseSchema = z.object({
  ...exerciseMetadataShape,
  sortOrder: exerciseMetadataShape.sortOrder.optional(),
})

export const updateExerciseSchema = z
  .object({
    ...exerciseMetadataShape,
    // PUBLISHED only through POST /:id/publish (it needs a checked template).
    status: z.enum(['DRAFT', 'ARCHIVED']),
  })
  .partial()

/** Template sources are created only by POST /admin/exercises/:id/template-sources. */
export const TEMPLATE_SOURCE_PATTERN = /^tpl_[0-9a-f-]{36}$/

export const MIRROR_POLICIES = ['EITHER', 'ANATOMICAL_ONLY', 'MIRROR_ONLY'] as const

export const compileTemplateSchema = z.object({
  sourceSubjectId: z.string().min(1).max(64),
  fps: z.preprocess(blankToUndefined, z.coerce.number().positive().max(240).optional()),
  mirrorPolicy: z.enum(MIRROR_POLICIES),
  trim: z
    .object({ startSec: z.number().min(0), endSec: z.number().positive() })
    .refine((t) => t.endSec > t.startSec, { message: 'endSec must be after startSec' })
    .optional(),
  attestation: z.literal(true),
  dryRun: z.boolean().optional(),
})

export const templateSourceBodySchema = z.object({
  durationMs: optionalInt(z.number().int().positive().max(10 * 60 * 1000)),
})

export const publishSchema = z.object({ templateId: uuidSchema })

/** Multipart or JSON attestation flag. */
export function isAttested(value: unknown): boolean {
  return value === true || value === 'true'
}

export const ADMIN_ATTESTATION_TEXT =
  'Người trong video mẫu là thành viên nhóm (người lớn) đã đồng ý cho dùng khung xương làm động tác mẫu; không phải trẻ em.'
