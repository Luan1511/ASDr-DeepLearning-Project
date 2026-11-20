import type { FamilyRole } from './visionProfiles'

/**
 * Notices when a parent sits down next to the child in front of the camera,
 * so Bin can greet them ("Bé đang ngồi cùng bố đấy à…"). Only registered
 * faces count (the role comes from the family face samples). This watcher
 * reports each parent once per camera session; BuddyPage also skips parents
 * already greeted in the saved conversation (lib/buddy/history.ts).
 */
export type ArrivalRole = 'mother' | 'father'

/** The child and the parent seen together this long. */
export const ARRIVAL_STABLE_MS = 1000
/** A face lost for less than this (turned head, a blink of the tracker) does not restart the count. */
export const ARRIVAL_GAP_MS = 600

const PARENTS: ArrivalRole[] = ['mother', 'father']

export class ArrivalWatcher {
  private readonly since = new Map<ArrivalRole, number>()
  private readonly lastSeen = new Map<FamilyRole, number>()
  private readonly greeted = new Set<ArrivalRole>()

  /** Roles recognised in one camera frame; answers the parents who just arrived. */
  update(roles: Array<FamilyRole | null>, time: number): ArrivalRole[] {
    for (const role of roles) if (role) this.lastSeen.set(role, time)
    const here = (role: FamilyRole) => time - (this.lastSeen.get(role) ?? -Infinity) <= ARRIVAL_GAP_MS
    const arrived: ArrivalRole[] = []
    for (const parent of PARENTS) {
      if (!here('child') || !here(parent)) {
        this.since.delete(parent)
        continue
      }
      const since = this.since.get(parent) ?? time
      this.since.set(parent, since)
      if (!this.greeted.has(parent) && time - since >= ARRIVAL_STABLE_MS) {
        this.greeted.add(parent)
        arrived.push(parent)
      }
    }
    return arrived
  }
}
