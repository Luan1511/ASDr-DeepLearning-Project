import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { IMITATION_V1 } from '../src/services/imitation'
import { CONSTANTS_SHA } from '../src/services/imitation/template'

/**
 * Snapshot of sha256(JSON.stringify(IMITATION_V1)) for version "imitation-v1".
 * Changing any constant changes the meaning of stored scores: bump `version`
 * (new algorithm id, new progress series) instead of editing this snapshot.
 */
const IMITATION_V1_SHA256 = '0aca4d5db55adbe9ea7f2e1b150ba88ada242f659d6f85a43e3be2bddde7c831'

function allFrozen(value: unknown): boolean {
  if (!value || typeof value !== 'object') return true
  return Object.isFrozen(value) && Object.values(value as Record<string, unknown>).every(allFrozen)
}

describe('IMITATION_V1 constants', () => {
  it('are frozen, including nested objects', () => {
    assert.ok(Object.isFrozen(IMITATION_V1))
    assert.ok(allFrozen(IMITATION_V1))
    try {
      ;(IMITATION_V1.amplitude as unknown as { okLo: number }).okLo = 0
    } catch {
      // strict mode throws; sloppy mode ignores the write
    }
    assert.equal(IMITATION_V1.amplitude.okLo, 0.8)
  })

  it('match the frozen snapshot while the version is imitation-v1', () => {
    const sha = createHash('sha256').update(JSON.stringify(IMITATION_V1)).digest('hex')
    if (IMITATION_V1.version === 'imitation-v1') {
      assert.equal(sha, IMITATION_V1_SHA256, 'constants changed without a version bump')
    } else {
      assert.notEqual(sha, IMITATION_V1_SHA256, 'a new version must come with new constants')
    }
    // The template hash commits to the same constants.
    assert.equal(CONSTANTS_SHA, sha)
  })

  it('keep the documented caps consistent with the 15 Hz sampling', () => {
    assert.equal(IMITATION_V1.hz, 15)
    assert.ok(IMITATION_V1.caps.maxTemplateSamples >= IMITATION_V1.templateGates.maxActiveSec * IMITATION_V1.hz)
    assert.equal(IMITATION_V1.caps.maxChildSamples, 60 * IMITATION_V1.hz)
  })
})
