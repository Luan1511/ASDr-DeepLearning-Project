/**
 * Frozen parameters of algorithm "imitation-v1". Changing ANY value changes
 * the meaning of stored scores, so it requires a new `version` (enforced by
 * test/imitationConstants.test.ts through a sha256 snapshot).
 */

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === 'object') {
    for (const inner of Object.values(value as Record<string, unknown>)) deepFreeze(inner)
    Object.freeze(value)
  }
  return value
}

export const IMITATION_V1 = deepFreeze({
  version: 'imitation-v1',
  hz: 15,
  minConf: 0.3,
  maxGapSec: 0.4,
  featureCap: 90,
  eOk: 12,
  eBad: 60,
  activeRom: 20,
  baseWeight: { angle: 1, translation: 1, length: 0.5 },
  minFeatureRel: 0.2,
  staticPartWeight: 0.15,
  minActivePartWeight: 0.25,
  phaseFloor: 0.25,
  amplitude: { okLo: 0.8, okHi: 1.25, zeroLo: 0.3, spanLo: 0.5, spanHi: 1.25 },
  tempo: { okLo: 0.67, okHi: 1.5, zeroLo: 0.33, zeroHi: 3, limitLo: 0.55, limitHi: 2.8 },
  overall: { staticFloor: 0.85, tempoFloor: 0.9 },
  lowMotion: { r: 0.3, cap: 20 },
  notFacing: { shoulderTorso: 0.35, share: 0.5, cap: 60 },
  mirroredShare: 0.7,
  visibilityMin: 0.6,
  partVisibleWeightShare: 0.5,
  coverageMin: 0.6,
  minResampledFrames: 20,
  minMatchedSec: 1.5,
  minMatchedRel: 0.5,
  minRecordingRel: 0.6,
  multiPerson: { coverage: 0.5, motionRel: 0.5 },
  tieBreakRel: 0.05,
  fpsTolerance: 0.2,
  foreshorten: { lo: 0.25, span: 0.25 },
  rollMaxDeg: 15,
  quietWindowSec: 1,
  torsoMedianWindowSec: 2,
  trim: { neutralSec: 0.5, threshold: 0.15, padSec: 0.3, neutralMaxSpeed: 0.5 },
  templateGates: { coverage: 0.9, visibility: 0.95, minActiveSec: 2, maxActiveSec: 30, facingShare: 0.8 },
  caps: { maxTemplateSamples: 459, maxChildSamples: 900 },
  bands: [80, 60, 40],
  stars: [80, 60],
  worstWindowSec: 1.5,
})

export type ImitationConstants = typeof IMITATION_V1
