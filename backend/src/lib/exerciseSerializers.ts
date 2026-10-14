/**
 * Every exercise response goes through these whitelisting serializers. Never
 * output: filePath, storedFilename, mlSubjectId, lastError, lockedBy, userId
 * or template features (scoring internals). Admin DTOs additionally carry the
 * template's quality gates and adult source subject id.
 */
import type { Exercise, ExerciseSession, ExerciseTemplate, Prisma, SessionScore } from '@prisma/client'
import {
  PART_IDS,
  type BuildTemplateResult,
  type ImitationReasonCode,
  type ImitationWarningCode,
  type PartId,
} from '../services/imitation'
import { BUILTIN_TITLE_PREFIX } from './exerciseInput'
import { starsFor } from './exerciseData'

type MirrorPolicy = 'EITHER' | 'ANATOMICAL_ONLY' | 'MIRROR_ONLY'

export type ExerciseRow = Pick<
  Exercise,
  'id' | 'slug' | 'title' | 'description' | 'childPrompt' | 'difficulty' | 'bodyFocus' | 'source'
>
export type TemplateSummaryRow = Pick<
  ExerciseTemplate,
  'id' | 'version' | 'durationSec' | 'mirrorPolicy' | 'lateralized' | 'activeParts'
>
export type GuideTemplateRow = TemplateSummaryRow & { guideTrack: Prisma.JsonValue }
export type ScoreRow = Pick<
  SessionScore,
  'algorithmVersion' | 'status' | 'overall' | 'stars' | 'band' | 'mode' | 'reasonCodes' | 'detail' | 'createdAt'
>
export type SessionRow = Pick<
  ExerciseSession,
  | 'id'
  | 'childId'
  | 'templateId'
  | 'status'
  | 'recordedVia'
  | 'practiceMode'
  | 'playbackRate'
  | 'durationMs'
  | 'videoDeletedAt'
  | 'errorMessage'
  | 'createdAt'
  | 'completedAt'
> & {
  exercise: Pick<Exercise, 'id' | 'slug' | 'title'>
  template: Pick<ExerciseTemplate, 'version'>
  scores: ScoreRow[]
}
export type AdminTemplateRow = Pick<
  ExerciseTemplate,
  | 'id'
  | 'version'
  | 'source'
  | 'sourceSubjectId'
  | 'sourceFps'
  | 'fpsSource'
  | 'mirrorPolicy'
  | 'templateHash'
  | 'durationSec'
  | 'activeStartSec'
  | 'activeEndSec'
  | 'lateralized'
  | 'activeParts'
  | 'quality'
  | 'selfTest'
  | 'sourceMlSubjectDeletedAt'
  | 'createdAt'
>
export type AdminExerciseRow = ExerciseRow &
  Pick<Exercise, 'status' | 'sortOrder' | 'currentTemplateId'> & { templates: AdminTemplateRow[] }

// ---------------------------------------------------------------------------
// JSON helpers (stored JSON is trusted but may predate a field)
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

function numberOrNullArray(value: unknown): Array<number | null> {
  return Array.isArray(value) ? value.map((v) => num(v)) : []
}

function partIds(value: string[]): PartId[] {
  return value.filter((p): p is PartId => (PART_IDS as string[]).includes(p))
}

function difficulty(value: number): 1 | 2 | 3 {
  return value >= 3 ? 3 : value <= 1 ? 1 : 2
}

// ---------------------------------------------------------------------------
// Parent DTOs
// ---------------------------------------------------------------------------

export function serializeTemplateSummary(t: TemplateSummaryRow) {
  return {
    id: t.id,
    version: t.version,
    durationSec: t.durationSec,
    mirrorPolicy: t.mirrorPolicy as MirrorPolicy,
    lateralized: t.lateralized,
    activeParts: partIds(t.activeParts),
  }
}

export type ChildExerciseStats = {
  attempts: number
  scoredAttempts: number
  bestStars: number | null
  lastStars: number | null
  lastAt: Date | null
}

function serializeExerciseMetadata(exercise: ExerciseRow) {
  return {
    id: exercise.id,
    slug: exercise.slug,
    title: exercise.title,
    description: exercise.description,
    childPrompt: exercise.childPrompt,
    difficulty: difficulty(exercise.difficulty),
    bodyFocus: exercise.bodyFocus.filter((f): f is 'ARMS' | 'LEGS' | 'TRUNK' => ['ARMS', 'LEGS', 'TRUNK'].includes(f)),
    source: (exercise.source === 'BUILTIN_SYNTHETIC' ? 'BUILTIN_SYNTHETIC' : 'ADMIN') as 'ADMIN' | 'BUILTIN_SYNTHETIC',
  }
}

export function serializeExercise(exercise: ExerciseRow, template: TemplateSummaryRow, child?: ChildExerciseStats) {
  return {
    ...serializeExerciseMetadata(exercise),
    template: serializeTemplateSummary(template),
    ...(child ? { child } : {}),
  }
}

/** The demonstration skeleton for the guide character (normalised, adult or synthetic). */
export function serializeGuideTemplate(t: GuideTemplateRow) {
  const track = asRecord(t.guideTrack)
  const frames = Array.isArray(track.frames)
    ? track.frames.map((frame) => (Array.isArray(frame) ? numberOrNullArray(frame) : null))
    : []
  return {
    ...serializeTemplateSummary(t),
    hz: 15 as const,
    joints: numberOrNullArray(track.joints).filter((j): j is number => j !== null),
    frames,
    neutral: numberOrNullArray(track.neutral),
  }
}

const EMPTY_PART = {
  status: 'not_visible' as const,
  active: false,
  score: null,
  amplitudeRatio: null,
  worstWindowSec: null,
}

function serializePart(raw: unknown) {
  const part = asRecord(raw)
  if (!Object.keys(part).length) return { ...EMPTY_PART }
  const window = Array.isArray(part.worstWindowSec) ? part.worstWindowSec.map((v) => num(v)) : null
  return {
    status: part.status === 'ok' ? ('ok' as const) : ('not_visible' as const),
    active: part.active === true,
    score: num(part.score),
    amplitudeRatio: num(part.amplitudeRatio),
    worstWindowSec:
      window && window.length === 2 && window[0] !== null && window[1] !== null
        ? ([window[0], window[1]] as [number, number])
        : null,
  }
}

/** INSUFFICIENT never carries a number or stars (the child sees "Mầm chưa nhìn rõ"). */
export function serializeSessionScore(score: Omit<ScoreRow, 'createdAt'>) {
  const detail = asRecord(score.detail)
  const quality = asRecord(detail.quality)
  const tempo = asRecord(detail.tempo)
  const feedback = asRecord(detail.feedback)
  const parts = asRecord(detail.parts)
  const scored = score.status === 'SCORED'
  const overall = scored ? score.overall : null
  const stars = scored ? ((score.stars as 1 | 2 | 3 | null) ?? starsFor(overall)) : null
  return {
    algorithmVersion: score.algorithmVersion,
    status: (scored ? 'SCORED' : 'INSUFFICIENT') as 'SCORED' | 'INSUFFICIENT',
    overall,
    stars,
    band: (scored ? score.band : null) as 'VERY_CLOSE' | 'CLOSE' | 'PROGRESSING' | 'KEEP_PRACTISING' | null,
    mode: (score.mode === 'mirror' || score.mode === 'anatomical' ? score.mode : null) as 'mirror' | 'anatomical' | null,
    reasonCodes: score.reasonCodes as ImitationReasonCode[],
    warnings: strings(quality.warnings) as ImitationWarningCode[],
    tempo: { ratio: num(tempo.ratio), lagSec: num(tempo.lagSec) },
    parts: Object.fromEntries(PART_IDS.map((id) => [id, serializePart(parts[id])])) as Record<
      PartId,
      ReturnType<typeof serializePart>
    >,
    feedback: { child: strings(feedback.child).slice(0, 3), parent: strings(feedback.parent) },
  }
}

export function latestScore<T extends { createdAt: Date }>(scores: T[]): T | null {
  return scores.reduce<T | null>((acc, s) => (!acc || s.createdAt > acc.createdAt ? s : acc), null)
}

export function serializeExerciseSession(
  session: SessionRow,
  extra: { queuePosition?: number | null; mlBusy?: boolean } = {},
) {
  const score = latestScore(session.scores)
  return {
    id: session.id,
    childId: session.childId,
    exercise: { id: session.exercise.id, slug: session.exercise.slug, title: session.exercise.title },
    templateId: session.templateId,
    templateVersion: session.template.version,
    status: session.status,
    recordedVia: session.recordedVia as 'WEBCAM' | 'UPLOAD',
    practiceMode: session.practiceMode as 'FOLLOW_ALONG' | 'AFTER_DEMO',
    playbackRate: session.playbackRate,
    durationMs: session.durationMs,
    rawVideoDeleted: session.videoDeletedAt !== null,
    errorMessage: session.errorMessage,
    createdAt: session.createdAt,
    completedAt: session.completedAt,
    queuePosition: extra.queuePosition ?? null,
    mlBusy: extra.mlBusy ?? false,
    // The raw video is kept (at most 24 h) only for FAILED sessions.
    retryable: session.status === 'FAILED' && session.videoDeletedAt === null,
    score: score ? serializeSessionScore(score) : null,
  }
}

// ---------------------------------------------------------------------------
// Admin DTOs (no child names, no answers, no features)
// ---------------------------------------------------------------------------

function serializeGates(value: unknown) {
  return Array.isArray(value)
    ? value.map((raw) => {
        const gate = asRecord(raw)
        return {
          code: typeof gate.code === 'string' ? gate.code : 'UNKNOWN',
          ok: gate.ok === true,
          value: num(gate.value),
          threshold: typeof gate.threshold === 'string' ? gate.threshold : '',
        }
      })
    : []
}

function serializeSelfTest(value: unknown) {
  if (!value || typeof value !== 'object') return null
  const selfTest = asRecord(value)
  return { identical: num(selfTest.identical), mirrored: num(selfTest.mirrored), still: num(selfTest.still) }
}

export function serializeAdminTemplate(t: AdminTemplateRow, currentTemplateId: string | null) {
  return {
    id: t.id,
    version: t.version,
    source: t.source,
    sourceSubjectId: t.sourceSubjectId,
    sourceFps: t.sourceFps,
    fpsSource: t.fpsSource,
    mirrorPolicy: t.mirrorPolicy as MirrorPolicy,
    templateHash: t.templateHash,
    durationSec: t.durationSec,
    activeStartSec: t.activeStartSec,
    activeEndSec: t.activeEndSec,
    lateralized: t.lateralized,
    activeParts: partIds(t.activeParts),
    quality: serializeGates(t.quality),
    selfTest: serializeSelfTest(t.selfTest),
    sourceMlSubjectDeleted: t.sourceSubjectId === null || t.sourceMlSubjectDeletedAt !== null,
    createdAt: t.createdAt,
    isCurrent: t.id === currentTemplateId,
  }
}

export function serializeAdminExercise(
  exercise: AdminExerciseRow,
  stats: { attempts: number; insufficientRate: number } = { attempts: 0, insufficientRate: 0 },
) {
  const current = exercise.templates.find((t) => t.id === exercise.currentTemplateId) ?? null
  return {
    ...serializeExerciseMetadata(exercise),
    title: exercise.source === 'BUILTIN_SYNTHETIC' ? `${BUILTIN_TITLE_PREFIX}${exercise.title}` : exercise.title,
    status: exercise.status,
    sortOrder: exercise.sortOrder,
    template: current ? serializeTemplateSummary(current) : null,
    templates: [...exercise.templates]
      .sort((a, b) => b.version - a.version)
      .map((t) => serializeAdminTemplate(t, exercise.currentTemplateId)),
    stats,
  }
}

/** Build/compile result for the admin UI: gates, trim, guide preview; never the scoring features. */
export function serializeBuildTemplateResult(result: BuildTemplateResult) {
  const t = result.template
  return {
    ok: result.ok,
    gates: serializeGates(result.gates),
    suggestedTrim: result.suggestedTrim,
    template: t
      ? {
          guideTrack: t.guideTrack,
          templateHash: t.templateHash,
          activeParts: t.activeParts,
          durationSec: t.durationSec,
          activeStartSec: t.activeStartSec,
          activeEndSec: t.activeEndSec,
          lateralized: t.lateralized,
        }
      : null,
    selfTest: result.selfTest,
  }
}
