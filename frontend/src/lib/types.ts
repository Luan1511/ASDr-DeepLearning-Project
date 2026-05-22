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

export type ScreeningResult = {
  id: string
  riskLevel: RiskLevel
  confidenceScore: number
  eyeContactScore: number
  motorPatternScore: number
  responseBehaviorScore: number
  repetitiveBehaviorScore: number
  recommendation: string
  createdAt: string
}

export type VideoScreening = {
  id: string
  childId: string
  originalFilename: string
  storedFilename: string
  filePath: string
  mimeType: string
  fileSize: number
  durationSeconds?: number | null
  status: ScreeningStatus
  createdAt: string
  child: ChildProfile
  result?: ScreeningResult | null
}

export type Article = {
  id: string
  title: string
  slug: string
  category: string
  content?: string
  createdAt: string
}
