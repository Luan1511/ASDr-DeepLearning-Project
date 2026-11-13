export const FAMILY_ROLES = ['child', 'mother', 'father'] as const
export type FamilyRole = (typeof FAMILY_ROLES)[number]
export type FamilyFaceSamples = Partial<Record<FamilyRole, number[]>>
export type FamilyFaceUpdates = Partial<Record<FamilyRole, number[] | null>>

export const FAMILY_ROLE_LABELS: Record<FamilyRole, string> = { child: 'Bé', mother: 'Mẹ', father: 'Bố' }

function sampleKey(userId: string, childId: string) {
  return `aimbrace:buddy-face:sface-v1:${encodeURIComponent(userId)}:${encodeURIComponent(childId)}`
}

function validSample(value: unknown): value is number[] {
  return Array.isArray(value) && value.length === 128 && value.every(Number.isFinite)
}

export function loadFamilyFaceSamples(userId: string, childId: string): FamilyFaceSamples {
  try {
    const raw = localStorage.getItem(sampleKey(userId, childId))
    if (!raw) return {}
    const stored: unknown = JSON.parse(raw)
    if (!stored || typeof stored !== 'object') return {}
    const result: FamilyFaceSamples = {}
    for (const role of FAMILY_ROLES) {
      const sample = (stored as Record<string, unknown>)[role]
      if (validSample(sample)) result[role] = sample
    }
    return result
  } catch {
    return {}
  }
}

export function updateFamilyFaceSamples(userId: string, childId: string, updates: FamilyFaceUpdates): boolean {
  const samples = loadFamilyFaceSamples(userId, childId)
  for (const role of FAMILY_ROLES) {
    const update = updates[role]
    if (update === null) delete samples[role]
    else if (update !== undefined) {
      if (!validSample(update)) return false
      samples[role] = update
    }
  }
  if (Object.keys(samples).length === 0) return clearFamilyFaceSamples(userId, childId)
  try {
    localStorage.setItem(sampleKey(userId, childId), JSON.stringify(samples))
    return true
  } catch {
    return false
  }
}

export function clearFamilyFaceSamples(userId: string, childId: string): boolean {
  try {
    localStorage.removeItem(sampleKey(userId, childId))
    return true
  } catch {
    return false
  }
}
