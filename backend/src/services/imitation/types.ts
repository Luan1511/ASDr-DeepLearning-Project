/**
 * Contract of the imitation-scoring core (Giai đoạn 4, algorithm "imitation-v1").
 * Pure, deterministic, no I/O. See master_prompt.md §6.7.
 */
import type { OpenPoseKeypointFrame } from '../openposeService'

export type PartId = 'leftArm' | 'rightArm' | 'leftLeg' | 'rightLeg' | 'trunk'
export type FeatureId =
  | 'lUpper'
  | 'lFore'
  | 'rUpper'
  | 'rFore'
  | 'lThigh'
  | 'lShank'
  | 'lThighLen'
  | 'rThigh'
  | 'rShank'
  | 'rThighLen'
  | 'lean'
  | 'rootDy'
  | 'rootDx'
export type MirrorPolicyValue = 'EITHER' | 'ANATOMICAL_ONLY' | 'MIRROR_ONLY'
export type PracticeMode = 'FOLLOW_ALONG' | 'AFTER_DEMO'
export type RecordedVia = 'WEBCAM' | 'UPLOAD'
export type BodyFocus = 'ARMS' | 'LEGS' | 'TRUNK'
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
export type TemplateGateCode =
  | 'TEMPLATE_FPS_REQUIRED'
  | 'TEMPLATE_PERSON_COVERAGE'
  | 'TEMPLATE_NO_NEUTRAL_START'
  | 'TEMPLATE_ACTIVE_DURATION'
  | 'TEMPLATE_NO_ACTIVE_PART'
  | 'TEMPLATE_PART_NOT_VISIBLE'
  | 'TEMPLATE_NOT_FACING'

export const PART_IDS: PartId[] = ['leftArm', 'rightArm', 'leftLeg', 'rightLeg', 'trunk']

export const PARTS: Record<PartId, FeatureId[]> = {
  leftArm: ['lUpper', 'lFore'],
  rightArm: ['rUpper', 'rFore'],
  leftLeg: ['lThigh', 'lShank', 'lThighLen'],
  rightLeg: ['rThigh', 'rShank', 'rThighLen'],
  trunk: ['lean', 'rootDy', 'rootDx'],
}

/** One value per resampled 15 Hz sample; null = not measurable. */
export type Series = Array<number | null>
/** `avail` in 0..1 per sample (foreshortening / missing joints). */
export type FeatureSet = { values: Record<FeatureId, Series>; avail: Record<FeatureId, number[]> }

export interface TemplateFeatures {
  algorithmVersion: string
  hz: 15
  n: number
  durationSec: number
  activeStartSec: number
  activeEndSec: number
  neutral: Record<FeatureId, number | null>
  anatomical: FeatureSet
  mirrored: FeatureSet
  rom: Record<FeatureId, number>
  dominant: Record<PartId, FeatureId>
  active: Record<PartId, boolean>
  featureWeight: Record<FeatureId, number>
  partWeight: Record<PartId, number>
  /** Per part, length n. */
  phaseWeight: Record<PartId, number[]>
  lateralized: boolean
}

/**
 * Normalised demonstration for the guide character: joints 0..14 (BODY_25 order),
 * mid-hip root at (0,0), y up, unit = clip-median torso length, 3 decimals.
 * Each frame is 30 numbers [x0,y0,x1,y1,...] (null = joint missing) or null.
 */
export interface GuideTrack {
  hz: 15
  joints: number[]
  frames: Array<Array<number | null> | null>
  neutral: Array<number | null>
}

export interface TemplateGate {
  code: TemplateGateCode
  ok: boolean
  value: number | null
  threshold: string
}

export interface BuildTemplateInput {
  frames: OpenPoseKeypointFrame[]
  fps: number | null
  mirrorPolicy: MirrorPolicyValue
  trim?: { startSec: number; endSec: number }
  videoSize?: { width: number; height: number } | null
}

export interface CompiledTemplate {
  features: TemplateFeatures
  guideTrack: GuideTrack
  templateHash: string
  activeParts: PartId[]
  durationSec: number
  activeStartSec: number
  activeEndSec: number
  lateralized: boolean
}

export interface TemplateSelfTest {
  identical: number | null
  mirrored: number | null
  still: number | null
}

export interface BuildTemplateResult {
  /** Every gate passed: only then may the template be saved or published. */
  ok: boolean
  gates: TemplateGate[]
  /** Automatic trim [startSec, endSec) in seconds of the source clip (returned even when `trim` overrides it). */
  suggestedTrim: { startSec: number; endSec: number } | null
  /**
   * Present whenever the clip could be compiled, also when a gate failed (for
   * the admin preview and trim UI). Null when the frame rate is unknown, no
   * person was found, or the segment exceeds 459 samples.
   */
  template: CompiledTemplate | null
  /** Overall scores of the template's own clip: as-is, mirrored, and the neutral pose held still. */
  selfTest: TemplateSelfTest | null
}

export interface ScoreInput {
  template: TemplateFeatures
  templateHash: string
  templateId: string
  mirrorPolicy: MirrorPolicyValue
  frames: OpenPoseKeypointFrame[]
  fps: number
  fpsSource: 'duration' | 'ml'
  fpsWarning: boolean
  videoSize: { width: number; height: number } | null
  practiceMode: PracticeMode
  playbackRate: number
  guideOffsetMs: number | null
}

export interface PartResult {
  /** `not_visible` also for every part when the attempt was rejected before alignment. */
  status: 'ok' | 'not_visible'
  active: boolean
  score: number | null
  spatialErrorDeg: number | null
  amplitudeRatio: number | null
  visibility: number
  /** 1.5 s window with the largest weighted error, in seconds from the start of the guide (template segment). */
  worstWindowSec: [number, number] | null
}

export interface ImitationResult {
  algorithmVersion: string
  templateId: string
  templateHash: string
  status: 'SCORED' | 'INSUFFICIENT'
  reasonCodes: ImitationReasonCode[]
  overall: number | null
  stars: 1 | 2 | 3 | null
  band: ImitationBand | null
  mode: 'mirror' | 'anatomical' | null
  lowMotion: boolean
  tempo: {
    ratio: number | null
    lagSec: number | null
    score: number | null
    aheadShare: number | null
    behindShare: number | null
    inPhaseShare: number | null
  }
  parts: Record<PartId, PartResult>
  quality: {
    trackCoverage: number
    fpsEff: number
    fpsSource: 'duration' | 'ml'
    warnings: ImitationWarningCode[]
    scoringMs: number
  }
  feedback: { child: string[]; parent: string[] }
}

export interface ExerciseFps {
  fps: number
  source: 'duration' | 'ml'
  warning: boolean
}

/** Synthetic demonstration shipped with the code (works without any recording). */
export interface BuiltinExercise {
  slug: string
  title: string
  description: string
  childPrompt: string
  difficulty: 1 | 2 | 3
  bodyFocus: BodyFocus[]
  mirrorPolicy: MirrorPolicyValue
  /** Marked "thử nghiệm" in the admin UI (e.g. marching in place). */
  experimental: boolean
  sortOrder: number
  /** Frame rate of makeFrames(). */
  fps: number
  /** Deterministic adult demonstration in image coordinates (BODY_25), with >= 1 s neutral at start and end. */
  makeFrames(): OpenPoseKeypointFrame[]
}
