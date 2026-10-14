/** DTOs of the Giai đoạn 4 exercise API (backend lib/exerciseSerializers.ts). */

export type PartId = 'leftArm' | 'rightArm' | 'leftLeg' | 'rightLeg' | 'trunk'
export type BodyFocus = 'ARMS' | 'LEGS' | 'TRUNK'
export type MirrorPolicy = 'EITHER' | 'ANATOMICAL_ONLY' | 'MIRROR_ONLY'
export type PracticeMode = 'FOLLOW_ALONG' | 'AFTER_DEMO'
export type RecordedVia = 'WEBCAM' | 'UPLOAD'
export type ExerciseSessionStatus = 'QUEUED' | 'PROCESSING' | 'SCORED' | 'INSUFFICIENT' | 'FAILED'
export type ExerciseStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'
export type ImitationBand = 'VERY_CLOSE' | 'CLOSE' | 'PROGRESSING' | 'KEEP_PRACTISING'
export type ImitationReasonCode = 'TOO_FEW_FRAMES' | 'VIDEO_TOO_SHORT' | 'ACTIVE_PART_NOT_VISIBLE'
export type ImitationWarningCode =
  | 'NOT_FACING'
  | 'MULTI_PERSON'
  | 'FPS_UNCERTAIN'
  | 'TEMPO_LIMIT'
  | 'LOW_MOTION'
  | 'ROLL_UNCERTAIN'
  | 'MIRRORED_VIDEO'

export type ExerciseMode = 'off' | 'admin_only' | 'on'

export type ExerciseCapabilitiesDto = {
  mode: ExerciseMode
  /** True when the current user may use exercises (mode on, or admin_only + admin). */
  available: boolean
  mlReachable: boolean
  /** ML server without /health (1.0): no .webm, no fps. */
  mlLegacy: boolean
  acceptsWebm: boolean
  acceptedExtensions: string[]
  maxDurationSec: number
  maxUploadMb: number
  recordFps: 15
}

export type ExerciseTemplateSummary = {
  id: string
  version: number
  durationSec: number
  mirrorPolicy: MirrorPolicy
  lateralized: boolean
  activeParts: PartId[]
}

export type ExerciseChildStats = {
  attempts: number
  scoredAttempts: number
  bestStars: number | null
  lastStars: number | null
  lastAt: string | null
}

export type ExerciseSummaryDto = {
  id: string
  slug: string
  title: string
  description: string
  childPrompt: string
  difficulty: 1 | 2 | 3
  bodyFocus: BodyFocus[]
  source: 'ADMIN' | 'BUILTIN_SYNTHETIC'
  template: ExerciseTemplateSummary
  /** Present when the list was requested with ?childId=. */
  child?: ExerciseChildStats
}

/**
 * Normalised demonstration for the guide character: joints 0..14 (BODY_25 order),
 * mid-hip root at (0,0), y UP, unit = torso length; each frame = 30 numbers
 * [x0,y0,...,x14,y14] (null = joint missing) or null; sampled at `hz`.
 */
export type GuideTemplateDto = {
  id: string
  version: number
  hz: 15
  durationSec: number
  joints: number[]
  frames: Array<Array<number | null> | null>
  neutral: Array<number | null>
  mirrorPolicy: MirrorPolicy
  lateralized: boolean
  activeParts: PartId[]
}

export type PartResultDto = {
  status: 'ok' | 'not_visible'
  active: boolean
  score: number | null
  amplitudeRatio: number | null
  worstWindowSec: [number, number] | null
}

export type SessionScoreDto = {
  algorithmVersion: string
  status: 'SCORED' | 'INSUFFICIENT'
  overall: number | null
  stars: 1 | 2 | 3 | null
  band: ImitationBand | null
  mode: 'mirror' | 'anatomical' | null
  reasonCodes: ImitationReasonCode[]
  warnings: ImitationWarningCode[]
  tempo: { ratio: number | null; lagSec: number | null }
  parts: Record<PartId, PartResultDto>
  feedback: { child: string[]; parent: string[] }
}

export type ExerciseSessionDto = {
  id: string
  childId: string
  exercise: { id: string; slug: string; title: string }
  templateId: string
  templateVersion: number
  status: ExerciseSessionStatus
  recordedVia: RecordedVia
  practiceMode: PracticeMode
  playbackRate: number
  durationMs: number | null
  rawVideoDeleted: boolean
  errorMessage: string | null
  createdAt: string
  completedAt: string | null
  queuePosition: number | null
  mlBusy: boolean
  retryable: boolean
  score: SessionScoreDto | null
}

export type ExerciseProgressPoint = {
  sessionId: string
  at: string
  overall: number | null
  stars: number | null
  status: 'SCORED' | 'INSUFFICIENT'
  hasWarnings: boolean
}

export type ExerciseProgressSeries = {
  /** `${algorithmVersion}|${templateId}`: scores of different series are not comparable. */
  key: string
  templateVersion: number
  algorithmVersion: string
  points: ExerciseProgressPoint[]
}

export type ExerciseProgressDto = {
  exercise: { id: string; slug: string; title: string; difficulty: number }
  attempts: number
  scoredAttempts: number
  lastAt: string | null
  best: { overall: number; stars: number; at: string } | null
  last: { overall: number | null; stars: number | null; status: ExerciseSessionStatus; at: string } | null
  series: ExerciseProgressSeries[]
}

export type TemplateGateDto = { code: string; ok: boolean; value: number | null; threshold: string }

export type TemplateSelfTestDto = { identical: number | null; mirrored: number | null; still: number | null }

export type AdminTemplateDto = {
  id: string
  version: number
  source: string
  sourceSubjectId: string | null
  sourceFps: number
  fpsSource: string
  mirrorPolicy: MirrorPolicy
  templateHash: string
  durationSec: number
  activeStartSec: number
  activeEndSec: number
  lateralized: boolean
  activeParts: PartId[]
  quality: TemplateGateDto[]
  selfTest: TemplateSelfTestDto | null
  sourceMlSubjectDeleted: boolean
  createdAt: string
  isCurrent: boolean
}

export type AdminExerciseDto = Omit<ExerciseSummaryDto, 'template'> & {
  status: ExerciseStatus
  sortOrder: number
  /** Null for a draft that has no published template yet. */
  template: ExerciseTemplateSummary | null
  templates: AdminTemplateDto[]
  stats: { attempts: number; insufficientRate: number }
}

/** POST /admin/exercises/:id/templates result (template features omitted). */
export type BuildTemplateResultDto = {
  ok: boolean
  gates: TemplateGateDto[]
  suggestedTrim: { startSec: number; endSec: number } | null
  template: {
    guideTrack: { hz: 15; joints: number[]; frames: Array<Array<number | null> | null>; neutral: Array<number | null> }
    templateHash: string
    activeParts: PartId[]
    durationSec: number
    activeStartSec: number
    activeEndSec: number
    lateralized: boolean
  } | null
  selfTest: TemplateSelfTestDto | null
}

export type ExerciseConsentStatus = {
  currentVersion: string
  consent: { id: string; version: string; scopes: string[]; grantedAt: string } | null
  /** Set when the last exercise consent was revoked (by the parent or by an older system version). */
  lastRevokedAt: string | null
}

export type AdminExerciseQueueDto = {
  queued: number
  processing: number
  failed24h: number
  mlCleanupPending: number
  recentFailures: Array<{ id: string; createdAt: string; lastError: string | null }>
}

export type AdminExerciseStatsDto = {
  attempts: number
  scored: number
  insufficient: number
  insufficientRate: number
  histogram10: number[]
  reasonCounts: Record<string, number>
  modeSplit: { mirror: number; anatomical: number; none: number }
}
