export type UserRole = 'USER' | 'ADMIN'

export type User = {
  id: string
  name: string
  email: string
  role: UserRole
}

export type Gender = 'MALE' | 'FEMALE' | 'OTHER' | 'UNSPECIFIED'

export type ChildProfile = {
  id: string
  fullName: string
  dateOfBirth: string
  gender: Gender
  note?: string | null
}

export type ScreeningStatus = 'UPLOADED' | 'PROCESSING' | 'COMPLETED' | 'FAILED'
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH'
export type JobStatus = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED'

export type QualityLevel = 'good' | 'fair' | 'poor'
export type GaitView = 'side' | 'frontal' | 'oblique' | 'unknown'

/** Descriptive gait metrics computed by the backend (backend/src/services/gaitFeatures.ts). */
export type GaitFeatures = {
  version: number
  view: GaitView
  quality: {
    level: QualityLevel
    framesTotal: number
    framesWithPerson: number
    personCoverage: number
    lowerBodyCoverage: number
    multiPersonRatio: number
    meanKeypointConfidence: number | null
    fps: number | null
    fpsSource: 'ml' | 'upload' | null
    durationSec: number | null
    warnings: string[]
  }
  metrics: {
    stepCount: number
    cadenceStepsPerMin: number | null
    stepTimeMeanSec: number | null
    stepTimeCv: number | null
    stepTimeAsymmetry: number | null
    stepLengthLegRatio: number | null
    walkingSpeedLegPerSec: number | null
    trunkLeanDeg: number | null
    trunkSwayDeg: number | null
    armSwingLeft: number | null
    armSwingRight: number | null
    armSwingAsymmetry: number | null
    heelRaiseRatio: number | null
  }
}

export type ScreeningResult = {
  id: string
  riskLevel: RiskLevel
  /** max(p_asd, p_typical) — kept for old clients; do not display as "khả năng ASD". */
  confidenceScore: number
  /** Model score for the ASD class (0–1); null for mock results. */
  asdProbability: number | null
  decisionThreshold: number | null
  highRiskThreshold: number | null
  calibrated: boolean | null
  modelVersion: string | null
  gaitFeatures: GaitFeatures | null
  recommendation: string
  provider: string | null
  createdAt: string
}

export type ScreeningJob = {
  status: JobStatus
  attempts: number
  maxAttempts: number
  runAfter: string
  queuePosition: number | null
}

export type VideoScreening = {
  id: string
  childId: string
  originalFilename: string
  mimeType: string
  fileSize: number
  durationSeconds?: number | null
  durationMs?: number | null
  videoWidth?: number | null
  videoHeight?: number | null
  rawVideoDeleted: boolean
  status: ScreeningStatus
  errorMessage?: string | null
  createdAt: string
  child: ChildProfile
  job?: ScreeningJob | null
  result?: ScreeningResult | null
}

export type ConsentScope = 'VIDEO_PROCESSING' | 'RESEARCH_USE'

export type ConsentStatement = {
  version: string
  title: string
  items: string[]
  optionalScopes: Array<{ scope: ConsentScope; label: string }>
  retention: {
    backendKeepsVideo: boolean
    mlVideoRetention: 'blurred' | 'none' | 'raw' | 'unknown'
  }
}

export type ConsentStatus = {
  currentVersion: string
  consent: { id: string; version: string; scopes: ConsentScope[]; grantedAt: string } | null
}

export type Article = {
  id: string
  title: string
  slug: string
  category: string
  content?: string
  createdAt: string
}
