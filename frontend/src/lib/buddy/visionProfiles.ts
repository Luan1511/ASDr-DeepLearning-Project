export const FAMILY_ROLES = ['child', 'mother', 'father'] as const
export type FamilyRole = (typeof FAMILY_ROLES)[number]

/**
 * Head poses kept for one person, so Bin still recognises them when the head
 * is turned a little. "left"/"right" are as seen in the camera image (the side
 * of the picture the nose points to); "up"/"down" are relative to the frontal
 * sample of the same session.
 */
export const FACE_VIEWS = ['front', 'left', 'right', 'up', 'down'] as const
export type FaceView = (typeof FACE_VIEWS)[number]

/** One SFace embedding per captured head pose. The frontal one is always present. */
export type FaceTemplate = { front: number[] } & Partial<Record<Exclude<FaceView, 'front'>, number[]>>
export type FamilyFaceSamples = Partial<Record<FamilyRole, FaceTemplate>>
export type FamilyFaceUpdates = Partial<Record<FamilyRole, FaceTemplate | null>>

export const FAMILY_ROLE_LABELS: Record<FamilyRole, string> = { child: 'Bé', mother: 'Mẹ', father: 'Bố' }

const EMBEDDING_SIZE = 128

/** v1 stored one frontal embedding per person; v2 stores a FaceTemplate. */
function sampleKey(version: 'v1' | 'v2', userId: string, childId: string) {
  return `aimbrace:buddy-face:sface-${version}:${encodeURIComponent(userId)}:${encodeURIComponent(childId)}`
}

function validEmbedding(value: unknown): value is number[] {
  return Array.isArray(value) && value.length === EMBEDDING_SIZE && value.every(Number.isFinite)
}

/** Accepts a v2 template or a bare v1 embedding; drops anything malformed. */
function parseTemplate(value: unknown): FaceTemplate | null {
  if (validEmbedding(value)) return { front: value }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (!validEmbedding(record.front)) return null
  const template: FaceTemplate = { front: record.front }
  for (const view of FACE_VIEWS) {
    const sample = record[view]
    if (view !== 'front' && validEmbedding(sample)) template[view] = sample
  }
  return template
}

function readStored(key: string): FamilyFaceSamples | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const stored: unknown = JSON.parse(raw)
    if (!stored || typeof stored !== 'object') return null
    const result: FamilyFaceSamples = {}
    for (const role of FAMILY_ROLES) {
      const template = parseTemplate((stored as Record<string, unknown>)[role])
      if (template) result[role] = template
    }
    return result
  } catch {
    return null
  }
}

export function faceTemplateViews(template: FaceTemplate): FaceView[] {
  return FACE_VIEWS.filter((view) => template[view])
}

export function loadFamilyFaceSamples(userId: string, childId: string): FamilyFaceSamples {
  return readStored(sampleKey('v2', userId, childId)) ?? readStored(sampleKey('v1', userId, childId)) ?? {}
}

export function updateFamilyFaceSamples(userId: string, childId: string, updates: FamilyFaceUpdates): boolean {
  const samples = loadFamilyFaceSamples(userId, childId)
  for (const role of FAMILY_ROLES) {
    const update = updates[role]
    if (update === null) delete samples[role]
    else if (update !== undefined) {
      const template = parseTemplate(update)
      if (!template) return false
      samples[role] = template
    }
  }
  if (Object.keys(samples).length === 0) return clearFamilyFaceSamples(userId, childId)
  try {
    localStorage.setItem(sampleKey('v2', userId, childId), JSON.stringify(samples))
    localStorage.removeItem(sampleKey('v1', userId, childId))
    return true
  } catch {
    return false
  }
}

export function clearFamilyFaceSamples(userId: string, childId: string): boolean {
  try {
    localStorage.removeItem(sampleKey('v2', userId, childId))
    localStorage.removeItem(sampleKey('v1', userId, childId))
    return true
  } catch {
    return false
  }
}
