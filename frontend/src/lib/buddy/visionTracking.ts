import { FAMILY_ROLES, type FamilyFaceSamples, type FamilyRole } from './visionProfiles'

export type FaceBox = { x: number; y: number; width: number; height: number }
export type FaceCue = 'smile' | 'brow_lowered'
export type BuddyFace = {
  id: number
  box: FaceBox
  role: FamilyRole | null
  cue: FaceCue | null
  mouthActivity: number
}
export type FaceObservation = {
  box: FaceBox
  smile: number
  browLowered: number
  jawOpen: number
  matchable: boolean
}
type Track = BuddyFace & {
  lastSeen: number
  smile: number
  browLowered: number
  lastCheck: number
  candidate: FamilyRole | null
  confirmedFrames: number
  matchable: boolean
}

const SIMILARITY_THRESHOLD = 0.58
const SIMILARITY_MARGIN = 0.12
const MAX_TRACK_GAP_MS = 500
const RECHECK_MS = 550

export function findFamilyRole(embedding: number[], samples: FamilyFaceSamples): FamilyRole | null {
  const scores = FAMILY_ROLES.flatMap((role) => {
    const sample = samples[role]
    if (!sample || sample.length !== embedding.length) return []
    let dot = 0
    let norm = 0
    for (let i = 0; i < sample.length; i++) {
      dot += embedding[i] * sample[i]
      norm += sample[i] ** 2
    }
    const score = dot / Math.sqrt(norm)
    return Number.isFinite(score) ? [{ role, score }] : []
  }).sort((a, b) => b.score - a.score)
  const [best, other] = scores
  return best?.score >= SIMILARITY_THRESHOLD && (!other || best.score - other.score >= SIMILARITY_MARGIN)
    ? best.role
    : null
}

function overlap(a: FaceBox, b: FaceBox) {
  const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
  const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
  return width * height
}

function centerDistance(a: FaceBox, b: FaceBox) {
  const dx = a.x + a.width / 2 - b.x - b.width / 2
  const dy = a.y + a.height / 2 - b.y - b.height / 2
  return Math.hypot(dx, dy) / Math.max(a.width, a.height, b.width, b.height)
}

function resetRole(track: Track) {
  track.role = null
  track.candidate = null
  track.confirmedFrames = 0
  track.lastCheck = -Infinity
}

function smoothScore(previous: number, current: number) {
  return previous * 0.55 + current * 0.45
}

export class BuddyFaceTracker {
  private tracks: Track[] = []
  private nextId = 1

  update(
    faces: FaceObservation[],
    timestamp: number,
  ): BuddyFace[] {
    const recent = this.tracks.filter((track) => timestamp - track.lastSeen <= MAX_TRACK_GAP_MS)
    const nearest = faces.map(({ box }) => recent
      .map((track) => ({ track, distance: centerDistance(track.box, box) }))
      .filter(({ distance }) => distance < 0.5)
      .sort((a, b) => a.distance - b.distance))
    const current: Track[] = []
    for (const [index, face] of faces.entries()) {
      const [best, other] = nearest[index]
      const ambiguous = faces.some(({ box }, otherIndex) =>
        index !== otherIndex && overlap(face.box, box) > 0.2 * Math.min(face.box.width * face.box.height, box.width * box.height))
      const unambiguous = best && !ambiguous && (!other || other.distance - best.distance > 0.16)
        && nearest.filter(([candidate]) => candidate?.track === best.track).length === 1
      const track: Track = unambiguous ? best.track : {
        id: this.nextId++,
        box: face.box,
        role: null,
        cue: null,
        mouthActivity: 0,
        lastSeen: timestamp,
        smile: face.smile,
        browLowered: face.browLowered,
        lastCheck: -Infinity,
        candidate: null,
        confirmedFrames: 0,
        matchable: false,
      }
      track.box = face.box
      track.lastSeen = timestamp
      track.smile = smoothScore(track.smile, face.smile)
      track.browLowered = smoothScore(track.browLowered, face.browLowered)
      track.mouthActivity = face.jawOpen
      track.cue = track.smile >= 0.5 ? 'smile' : track.browLowered >= 0.55 ? 'brow_lowered' : null

      track.matchable = face.matchable && !ambiguous
      if (!track.matchable) resetRole(track)
      current.push(track)
    }
    this.tracks = current
    return current.map(({ id, box, role, cue, mouthActivity }) => ({
      id, box, cue, mouthActivity,
      role: role && current.filter(({ candidate }) => candidate === role).length === 1 ? role : null,
    }))
  }

  identifyNext(timestamp: number) {
    let index = -1
    for (const [i, track] of this.tracks.entries()) {
      if (!track.matchable || timestamp - track.lastCheck < RECHECK_MS) continue
      if (index === -1 || track.lastCheck < this.tracks[index].lastCheck) index = i
    }
    if (index === -1) return undefined
    const track = this.tracks[index]
    track.lastCheck = timestamp
    return { id: track.id, index, timestamp }
  }

  confirm(match: { id: number; timestamp: number }, role: FamilyRole | null) {
    const track = this.tracks.find(({ id }) => id === match.id)
    if (!track || !track.matchable || track.lastCheck !== match.timestamp) return
    track.confirmedFrames = role && role === track.candidate ? track.confirmedFrames + 1 : 1
    track.candidate = role
    track.role = track.confirmedFrames >= 2 ? role : null
  }
}
