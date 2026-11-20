import { describe, expect, it } from 'vitest'
import { ARRIVAL_GAP_MS, ARRIVAL_STABLE_MS, ArrivalWatcher } from './presence'
import type { FamilyRole } from './visionProfiles'

/** Feeds the same roles every 125 ms from `start` for `ms`; returns [time, role] of each arrival. */
function feed(watcher: ArrivalWatcher, roles: Array<FamilyRole | null>, start: number, ms: number) {
  const out: Array<[number, string]> = []
  for (let t = start; t < start + ms; t += 125) for (const role of watcher.update(roles, t)) out.push([t, role])
  return out
}

describe('ArrivalWatcher', () => {
  it('greets a parent seen with the child for three seconds, once', () => {
    const watcher = new ArrivalWatcher()
    const arrivals = feed(watcher, ['child', 'father'], 0, 10_000)
    expect(arrivals).toEqual([[ARRIVAL_STABLE_MS, 'father']])
  })

  it('needs the child too, and a recognised face (not an unknown one)', () => {
    expect(feed(new ArrivalWatcher(), ['father'], 0, 10_000)).toEqual([])
    expect(feed(new ArrivalWatcher(), ['child', null], 0, 10_000)).toEqual([])
  })

  it('tolerates a short loss of the face but restarts after a longer one', () => {
    const short = new ArrivalWatcher()
    // 0.5 s together, the mother's face lost for less than ARRIVAL_GAP_MS, then together again.
    const shortGap = [...feed(short, ['child', 'mother'], 0, 500), ...feed(short, ['child'], 500, 400), ...feed(short, ['child', 'mother'], 900, 500)]
    expect(shortGap.map(([, role]) => role)).toEqual(['mother'])
    expect(ARRIVAL_GAP_MS).toBeGreaterThan(400)
    const long = new ArrivalWatcher()
    // 0.3 s together, 1 s apart, then 0.6 s together again: never 1 s in a row (the gap counts as present only up to ARRIVAL_GAP_MS).
    const longGap = [...feed(long, ['child', 'mother'], 0, 300), ...feed(long, ['child'], 300, 1000), ...feed(long, ['child', 'mother'], 1300, 600)]
    expect(longGap).toEqual([])
  })

  it('greets each parent separately', () => {
    const watcher = new ArrivalWatcher()
    const arrivals = [...feed(watcher, ['child', 'mother'], 0, 4000), ...feed(watcher, ['child', 'mother', 'father'], 4000, 4000)]
    expect(arrivals.map(([, role]) => role)).toEqual(['mother', 'father'])
  })
})
