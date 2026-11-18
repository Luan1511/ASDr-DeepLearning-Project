import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  MOVEMENT_VERSION,
  movementReferenceState,
  readMovementReference,
  readMovementReport,
  summarizeMovementReport,
} from '../src/services/exerciseMovement/types'

const report = (version: string) => ({
  version,
  profile: 'jumping-jacks',
  checks: [
    { code: 'JACKS_ARM_FOOT_OUT_OF_PHASE', label: 'Nâng tay cùng lúc mở chân', status: 'evaluated' },
    { code: 'JACKS_MISSING_FOOT_OPEN', label: 'Pha mở chân', status: 'evaluated' },
    { code: 'JACKS_MISSING_FOOT_CLOSE', label: 'Pha khép chân', status: 'unmeasurable' },
    { code: 'JACKS_ONE_ARM_IDLE', label: 'Nâng và hạ cả hai tay', status: 'evaluated' },
  ],
  events: [
    { code: 'JACKS_MISSING_FOOT_OPEN', label: 'Thiếu pha mở chân', feedback: 'Con thử mở chân nhé.', startSec: 1, endSec: 3, repetitions: 2 },
    { code: 'JACKS_MISSING_FOOT_OPEN', label: 'Thiếu pha mở chân', feedback: 'Con thử mở chân nhé.', startSec: 6, endSec: 8, repetitions: 2 },
    { code: 'JACKS_ONE_ARM_IDLE', label: 'Một tay giữ nguyên', feedback: 'Con nâng cả hai tay nhé.', startSec: 1, endSec: 4, repetitions: 3 },
  ],
})

const jacksReference = (version: string) => ({
  version,
  profile: 'jumping-jacks',
  guideSourceFps: 30,
  reference: { guideLag: 0.02, guidePhaseRepetitions: 4 },
})

describe('movement report versions', () => {
  it('reads a report written by the current detector version', () => {
    assert.equal(readMovementReport(report(MOVEMENT_VERSION))?.events.length, 3)
  })

  it('keeps reports of earlier detector versions readable', () => {
    const old = readMovementReport(report('exercise-errors-v0.2'))
    assert.equal(old?.version, 'exercise-errors-v0.2')
    assert.equal(old?.checks.length, 4)
  })

  it('still rejects something that is not a movement report', () => {
    assert.equal(readMovementReport(report('imitation-v1')), null)
    assert.equal(readMovementReport({ ...report(MOVEMENT_VERSION), events: [{ code: 'NOT_A_CODE' }] }), null)
    assert.equal(readMovementReport(null), null)
  })
})

describe('movementReferenceState', () => {
  it('tells a missing profile from an outdated calibration', () => {
    assert.equal(movementReferenceState(undefined), 'none')
    assert.equal(movementReferenceState(null), 'none')
    assert.equal(movementReferenceState(jacksReference(MOVEMENT_VERSION)), 'current')
    assert.equal(movementReferenceState(jacksReference('exercise-errors-v0.1')), 'outdated')
    assert.equal(movementReferenceState({ garbage: true }), 'outdated')
  })

  it('never uses an outdated calibration for scoring', () => {
    assert.equal(readMovementReference(jacksReference('exercise-errors-v0.1')), null)
    assert.equal(readMovementReference(jacksReference(MOVEMENT_VERSION))?.profile, 'jumping-jacks')
  })
})

describe('summarizeMovementReport', () => {
  it('counts measurable criteria and distinct criteria with a repeated error', () => {
    const parsed = readMovementReport(report(MOVEMENT_VERSION))
    assert.ok(parsed)
    assert.deepEqual(summarizeMovementReport(parsed), { checks: 4, evaluated: 3, flagged: 2 })
  })

  it('is all zeros apart from the criteria count when nothing was measured', () => {
    const parsed = readMovementReport({
      ...report(MOVEMENT_VERSION),
      checks: report(MOVEMENT_VERSION).checks.map((check) => ({ ...check, status: 'unmeasurable' })),
      events: [],
    })
    assert.ok(parsed)
    assert.deepEqual(summarizeMovementReport(parsed), { checks: 4, evaluated: 0, flagged: 0 })
  })
})
