/**
 * imitation-v1 step E: slope-limited subsequence DTW. The template (n) must be
 * matched completely; the child clip (m) may start and end anywhere. Every
 * template sample is paid exactly once, so total / n is the mean cost along
 * the demonstration. The child may be up to 3× slower or 2× faster.
 */
import { IMITATION_V1 as C } from './constants'

/** Step that reached a cell: how the child moved relative to the template. */
export const STEP_IN_PHASE = 0 // template +1, child +1
export const STEP_SLOWER_2 = 1 // template +1, child +2
export const STEP_SLOWER_3 = 2 // template +1, child +3
export const STEP_FASTER_2 = 3 // template +2, child +1

export interface DtwResult {
  jStart: number
  jEnd: number
  total: number
  /** Matched (template, child) pairs in increasing order. */
  path: Array<[number, number]>
  /** Steps along the path, in increasing order (one per template advance). */
  steps: number[]
}

export function subsequenceDtw(n: number, m: number, cost: (i: number, j: number) => number): DtwResult {
  if (n > C.caps.maxTemplateSamples) throw new RangeError(`template too long for DTW (${n} > ${C.caps.maxTemplateSamples})`)
  if (m > C.caps.maxChildSamples) throw new RangeError(`child clip too long for DTW (${m} > ${C.caps.maxChildSamples})`)
  if (n <= 0 || m <= 0) return { jStart: 0, jEnd: -1, total: Number.POSITIVE_INFINITY, path: [], steps: [] }

  const Cm = new Float64Array(n * m)
  for (let i = 0; i < n; i += 1) {
    const row = i * m
    for (let j = 0; j < m; j += 1) Cm[row + j] = cost(i, j)
  }
  const D = new Float64Array(n * m).fill(Number.POSITIVE_INFINITY)
  const step = new Uint8Array(n * m)
  for (let j = 0; j < m; j += 1) D[j] = Cm[j] // free start

  for (let i = 1; i < n; i += 1) {
    const row = i * m
    const prev = row - m
    const prev2 = row - 2 * m
    for (let j = 1; j < m; j += 1) {
      const c = Cm[row + j]
      let best = D[prev + j - 1] + c
      let choice = STEP_IN_PHASE
      if (j >= 2) {
        const v = D[prev + j - 2] + (Cm[row + j - 1] + c) / 2
        if (v < best) {
          best = v
          choice = STEP_SLOWER_2
        }
      }
      if (j >= 3) {
        const v = D[prev + j - 3] + (Cm[row + j - 2] + Cm[row + j - 1] + c) / 3
        if (v < best) {
          best = v
          choice = STEP_SLOWER_3
        }
      }
      if (i >= 2) {
        const v = D[prev2 + j - 1] + Cm[prev + j] + c
        if (v < best) {
          best = v
          choice = STEP_FASTER_2
        }
      }
      D[row + j] = best
      step[row + j] = choice
    }
  }

  const last = (n - 1) * m
  let jEnd = -1
  let total = Number.POSITIVE_INFINITY
  for (let j = 0; j < m; j += 1) {
    if (D[last + j] < total) {
      total = D[last + j]
      jEnd = j
    }
  }
  if (jEnd < 0) return { jStart: 0, jEnd: -1, total, path: [], steps: [] }

  const path: Array<[number, number]> = []
  const steps: number[] = []
  let i = n - 1
  let j = jEnd
  while (i > 0) {
    const s = step[i * m + j]
    steps.push(s)
    if (s === STEP_IN_PHASE) {
      path.push([i, j])
      i -= 1
      j -= 1
    } else if (s === STEP_SLOWER_2) {
      path.push([i, j], [i, j - 1])
      i -= 1
      j -= 2
    } else if (s === STEP_SLOWER_3) {
      path.push([i, j], [i, j - 1], [i, j - 2])
      i -= 1
      j -= 3
    } else {
      path.push([i, j], [i - 1, j])
      i -= 2
      j -= 1
    }
  }
  if (i === 0) path.push([0, j])
  path.reverse()
  steps.reverse()
  return { jStart: path[0][1], jEnd, total, path, steps }
}
