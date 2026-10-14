/**
 * imitation-v1 step D: compile an adult demonstration into a template
 * (trim, ranges of motion, weights, quality gates, guide track, hash).
 */
import { createHash } from 'node:crypto'
import type { OpenPoseKeypointFrame } from '../openposeService'
import { sanitizeFps } from '../gaitFeatures'
import { JOINT_COUNT, cleanAndResample, selectExerciseTrack, type Joints } from './cleaning'
import { IMITATION_V1 as C } from './constants'
import {
  FEATURE_IDS,
  FEATURE_KIND,
  FEATURE_PART,
  PART_IDS,
  baseWeight,
  cappedDiff,
  clamp01,
  extractFeatures,
  finiteValues,
  meanSpeed,
  median,
  mirrorFeatureSet,
  partVisibleAt,
  rangeOfMotion,
  windowSamples,
} from './features'
import { scoreImitation } from './scoring'
import { reflectFrames } from './syntheticPose'
import {
  PARTS,
  type BuildTemplateInput,
  type BuildTemplateResult,
  type FeatureId,
  type FeatureSet,
  type GuideTrack,
  type MirrorPolicyValue,
  type PartId,
  type TemplateFeatures,
  type TemplateGate,
  type TemplateSelfTest,
} from './types'

// ---------------------------------------------------------------------------
// Hash
// ---------------------------------------------------------------------------

function canonical(value: unknown): unknown {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null
    const r = Math.round(value * 1e4) / 1e4
    return r === 0 ? 0 : r
  }
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key]
      if (v !== undefined) out[key] = canonical(v)
    }
    return out
  }
  return value
}

/** JSON with sorted keys and numbers rounded to 4 decimals. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonical(value))
}

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')

export const CONSTANTS_SHA = sha256(JSON.stringify(C))

export function templateHash(features: TemplateFeatures, mirrorPolicy: MirrorPolicyValue): string {
  return sha256(canonicalJson({ algorithmVersion: C.version, constantsSha: CONSTANTS_SHA, mirrorPolicy, features }))
}

// ---------------------------------------------------------------------------
// Weights
// ---------------------------------------------------------------------------

interface Weights {
  dominant: Record<PartId, FeatureId>
  active: Record<PartId, boolean>
  featureWeight: Record<FeatureId, number>
  partWeight: Record<PartId, number>
}

export function computeWeights(rom: Record<FeatureId, number>): Weights {
  const dominant = {} as Record<PartId, FeatureId>
  const active = {} as Record<PartId, boolean>
  const featureWeight = {} as Record<FeatureId, number>
  const partWeight = {} as Record<PartId, number>
  for (const p of PART_IDS) {
    const feats = PARTS[p]
    let dom = feats[0]
    for (const f of feats) if (rom[f] > rom[dom]) dom = f
    dominant[p] = dom
    active[p] = rom[dom] >= C.activeRom
    for (const f of feats) {
      const rel = rom[dom] > 0 ? rom[f] / rom[dom] : 1
      // Sideways drift or bobbing is not an imitation error unless the demonstration does it.
      const used = FEATURE_KIND[f] !== 'translation' || rom[f] >= C.activeRom
      featureWeight[f] = used ? baseWeight(f) * Math.max(C.minFeatureRel, rel) : 0
    }
  }
  const maxActive = Math.max(0, ...PART_IDS.filter((p) => active[p]).map((p) => rom[dominant[p]]))
  for (const p of PART_IDS) {
    partWeight[p] = active[p] && maxActive > 0 ? Math.max(C.minActivePartWeight, rom[dominant[p]] / maxActive) : C.staticPartWeight
  }
  return { dominant, active, featureWeight, partWeight }
}

function romOf(set: FeatureSet, start: number, end: number): Record<FeatureId, number> {
  const rom = {} as Record<FeatureId, number>
  for (const f of FEATURE_IDS) rom[f] = rangeOfMotion(set.values[f].slice(start, end))
  return rom
}

/** Weighted mean of min(|wrap(f − f_neutral)|, 90) over the given features at sample i. */
function deviation(
  set: FeatureSet,
  neutral: Record<FeatureId, number | null>,
  feats: FeatureId[],
  weight: (f: FeatureId) => number,
  i: number,
): number | null {
  let num = 0
  let den = 0
  for (const f of feats) {
    const w = weight(f)
    const v = set.values[f][i]
    const n0 = neutral[f]
    if (!(w > 0) || v === null || n0 === null) continue
    num += w * cappedDiff(v, n0)
    den += w
  }
  return den > 0 ? num / den : null
}

const round = (v: number, digits: number) => {
  const f = 10 ** digits
  const r = Math.round(v * f) / f
  return r === 0 ? 0 : r
}
const roundSeries = (s: Array<number | null>, digits: number) => s.map((v) => (v === null ? null : round(v, digits)))

function sliceSet(set: FeatureSet, start: number, end: number): FeatureSet {
  const values = {} as Record<FeatureId, Array<number | null>>
  const avail = {} as Record<FeatureId, number[]>
  for (const f of FEATURE_IDS) {
    values[f] = roundSeries(set.values[f].slice(start, end), 3)
    avail[f] = set.avail[f].slice(start, end).map((a) => round(a, 3))
  }
  return { values, avail }
}

// ---------------------------------------------------------------------------
// Guide track
// ---------------------------------------------------------------------------

function guideFrame(joints: Joints | null, root: { x: number; y: number }, unit: number): Array<number | null> | null {
  if (!joints) return null
  const out: Array<number | null> = []
  let any = false
  for (let j = 0; j < JOINT_COUNT; j += 1) {
    const p = joints[j]
    if (p) {
      out.push(round((p.x - root.x) / unit, 3), round(-(p.y - root.y) / unit, 3))
      any = true
    } else out.push(null, null)
  }
  return any ? out : null
}

function buildGuideTrack(
  poses: Array<Joints | null>,
  segment: [number, number],
  refWindow: [number, number],
  root: { x: number; y: number },
  unit: number,
): GuideTrack {
  const frames = poses.slice(segment[0], segment[1] + 1).map((p) => guideFrame(p, root, unit))
  const neutral: Array<number | null> = []
  for (let j = 0; j < JOINT_COUNT; j += 1) {
    const xs: number[] = []
    const ys: number[] = []
    for (let i = refWindow[0]; i < refWindow[1]; i += 1) {
      const p = poses[i]?.[j]
      if (!p) continue
      xs.push((p.x - root.x) / unit)
      ys.push(-(p.y - root.y) / unit)
    }
    const mx = median(xs)
    const my = median(ys)
    neutral.push(mx === null ? null : round(mx, 3), my === null ? null : round(my, 3))
  }
  return { hz: C.hz as 15, joints: Array.from({ length: JOINT_COUNT }, (_, j) => j), frames, neutral }
}

// ---------------------------------------------------------------------------
// Self-test
// ---------------------------------------------------------------------------

function selfTest(
  frames: OpenPoseKeypointFrame[],
  fps: number,
  features: TemplateFeatures,
  hash: string,
  mirrorPolicy: MirrorPolicyValue,
  videoSize: { width: number; height: number } | null,
  stillFrame: OpenPoseKeypointFrame['people'][number] | null,
): TemplateSelfTest {
  const score = (input: OpenPoseKeypointFrame[]) => {
    const result = scoreImitation({
      template: features,
      templateHash: hash,
      templateId: 'self-test',
      mirrorPolicy,
      frames: input,
      fps,
      fpsSource: 'ml',
      fpsWarning: false,
      videoSize,
      practiceMode: 'AFTER_DEMO',
      playbackRate: 1,
      guideOffsetMs: null,
    })
    return result.overall
  }
  const xs = frames.flatMap((f) => f.people.flatMap((p) => p.body25.filter((j) => j.x !== 0 || j.y !== 0).map((j) => j.x)))
  const axis = videoSize?.width ?? 2 * (median(xs) ?? 0)
  return {
    identical: score(frames),
    mirrored: score(reflectFrames(frames, axis, true)),
    still: stillFrame
      ? score(frames.map((_, i) => ({ frame_index: i, people: [{ ...stillFrame, person_id: 0 }] })))
      : null,
  }
}

// ---------------------------------------------------------------------------
// buildTemplate
// ---------------------------------------------------------------------------

export function buildTemplate(input: BuildTemplateInput): BuildTemplateResult {
  const gates: TemplateGate[] = []
  const gate = (code: TemplateGate['code'], ok: boolean, value: number | null, threshold: string) =>
    gates.push({ code, ok, value: value === null || !Number.isFinite(value) ? null : round(value, 3), threshold })
  const fail = (): BuildTemplateResult => ({ ok: false, gates, suggestedTrim: null, template: null, selfTest: null })

  // 1. Frame rate
  const fps = sanitizeFps(input.fps)
  gate('TEMPLATE_FPS_REQUIRED', fps !== null, input.fps ?? null, '5–120 fps')
  if (fps === null) return fail()

  // 2. Person
  const frames = [...(input.frames ?? [])].sort((a, b) => a.frame_index - b.frame_index)
  const videoSize = input.videoSize ?? null
  const selection = selectExerciseTrack(frames, videoSize)
  gate('TEMPLATE_PERSON_COVERAGE', selection.coverage >= C.templateGates.coverage, selection.coverage, `≥ ${C.templateGates.coverage}`)
  if (!selection.track) return fail()

  // 3. Clean and resample
  const poses = cleanAndResample(selection.track, frames.length, fps)
  const ext = extractFeatures(poses, 'template')
  const n = poses.length
  if (n < 2 || ext.torsoMedian === null || !ext.rootRef) {
    // Neck and mid-hip never seen together: nothing can be measured.
    gate('TEMPLATE_PART_NOT_VISIBLE', false, null, `≥ ${C.templateGates.visibility}`)
    return fail()
  }
  const set = ext.set

  // 4. Neutral start
  const [refStart, refEnd] = ext.refWindow
  const neutralSpeed = meanSpeed(ext.limbSpeed, refStart, refEnd)
  gate(
    'TEMPLATE_NO_NEUTRAL_START',
    neutralSpeed !== null && neutralSpeed < C.trim.neutralMaxSpeed,
    neutralSpeed,
    `< ${C.trim.neutralMaxSpeed} L/s`,
  )
  const neutral = {} as Record<FeatureId, number | null>
  for (const f of FEATURE_IDS) {
    const m = median(finiteValues(set.values[f].slice(refStart, refEnd)))
    neutral[f] = m === null ? null : round(m, 3)
  }

  // 5. Trim: deviation from neutral, weighted with whole-clip weights
  const clipWeights = computeWeights(romOf(set, 0, n))
  const dev = Array.from({ length: n }, (_, i) =>
    deviation(set, neutral, FEATURE_IDS, (f) => clipWeights.featureWeight[f] * clipWeights.partWeight[FEATURE_PART[f]], i),
  )
  const maxDev = Math.max(0, ...dev.map((d) => d ?? 0))
  let first = -1
  let last = -1
  dev.forEach((d, i) => {
    if (d !== null && maxDev > 0 && d > C.trim.threshold * maxDev) {
      if (first < 0) first = i
      last = i
    }
  })
  const pad = windowSamples(C.trim.padSec)
  const suggested: [number, number] = first < 0 ? [0, n - 1] : [Math.max(0, first - pad), Math.min(n - 1, last + pad)]
  const suggestedTrim = { startSec: round(suggested[0] / C.hz, 3), endSec: round((suggested[1] + 1) / C.hz, 3) }
  let segment = suggested
  if (input.trim && Number.isFinite(input.trim.startSec) && Number.isFinite(input.trim.endSec)) {
    const s = Math.min(n - 1, Math.max(0, Math.round(input.trim.startSec * C.hz)))
    const e = Math.min(n - 1, Math.max(s, Math.round(input.trim.endSec * C.hz) - 1))
    segment = [s, e]
  }
  const [segStart, segEnd] = segment
  const segLen = segEnd - segStart + 1

  // 6. Ranges of motion and weights on the segment
  const rom = romOf(set, segStart, segEnd + 1)
  const weights = computeWeights(rom)
  const activeParts = PART_IDS.filter((p) => weights.active[p])

  // 7. Phase weights: emphasise the moments the demonstration is away from neutral
  const phaseWeight = {} as Record<PartId, number[]>
  for (const p of PART_IDS) {
    if (!weights.active[p]) {
      phaseWeight[p] = new Array(segLen).fill(1)
      continue
    }
    const devP = Array.from({ length: segLen }, (_, k) =>
      deviation(set, neutral, PARTS[p], (f) => weights.featureWeight[f], segStart + k),
    )
    const maxP = Math.max(0, ...devP.map((d) => d ?? 0))
    phaseWeight[p] = devP.map((d) =>
      round(maxP > 0 ? C.phaseFloor + (1 - C.phaseFloor) * clamp01((d ?? 0) / (0.5 * maxP)) : 1, 4),
    )
  }

  // 8. Lateralized: one side clearly moves more than the other
  const lateral = (left: PartId, right: PartId) => {
    const l = rom[weights.dominant[left]]
    const r = rom[weights.dominant[right]]
    const mx = Math.max(l, r)
    return mx >= C.activeRom && Math.abs(l - r) / mx > 0.5
  }
  const lateralized = lateral('leftArm', 'rightArm') || lateral('leftLeg', 'rightLeg')

  // 9. Gates
  const durationSec = segLen / C.hz
  const g = C.templateGates
  gate(
    'TEMPLATE_ACTIVE_DURATION',
    durationSec >= g.minActiveSec && durationSec <= g.maxActiveSec && segLen <= C.caps.maxTemplateSamples,
    durationSec,
    `${g.minActiveSec}–${g.maxActiveSec} s`,
  )
  gate('TEMPLATE_NO_ACTIVE_PART', activeParts.length > 0, activeParts.length, '≥ 1')
  let minVisible: number | null = null
  for (const p of activeParts) {
    let visible = 0
    for (let i = segStart; i <= segEnd; i += 1) if (partVisibleAt(set, p, weights.featureWeight, i)) visible += 1
    const share = visible / segLen
    minVisible = minVisible === null ? share : Math.min(minVisible, share)
  }
  gate('TEMPLATE_PART_NOT_VISIBLE', minVisible === null || minVisible >= g.visibility, minVisible, `≥ ${g.visibility}`)
  let facing = 0
  for (let i = segStart; i <= segEnd; i += 1) {
    const r = ext.shoulderRatio[i]
    if (r !== null && r >= C.notFacing.shoulderTorso) facing += 1
  }
  gate('TEMPLATE_NOT_FACING', facing / segLen >= g.facingShare, facing / segLen, `≥ ${g.facingShare} (vai/thân ≥ ${C.notFacing.shoulderTorso})`)

  const ok = gates.every((x) => x.ok)
  if (segLen > C.caps.maxTemplateSamples) return { ok: false, gates, suggestedTrim, template: null, selfTest: null }

  // 10. Outputs
  const anatomical = sliceSet(set, segStart, segEnd + 1)
  const features: TemplateFeatures = {
    algorithmVersion: C.version,
    hz: C.hz as 15,
    n: segLen,
    durationSec: round(durationSec, 3),
    activeStartSec: round(segStart / C.hz, 3),
    activeEndSec: round((segEnd + 1) / C.hz, 3),
    neutral,
    anatomical,
    mirrored: mirrorFeatureSet(anatomical),
    rom: Object.fromEntries(FEATURE_IDS.map((f) => [f, round(rom[f], 3)])) as Record<FeatureId, number>,
    dominant: weights.dominant,
    active: weights.active,
    featureWeight: Object.fromEntries(FEATURE_IDS.map((f) => [f, round(weights.featureWeight[f], 4)])) as Record<FeatureId, number>,
    partWeight: Object.fromEntries(PART_IDS.map((p) => [p, round(weights.partWeight[p], 4)])) as Record<PartId, number>,
    phaseWeight,
    lateralized,
  }
  const hash = templateHash(features, input.mirrorPolicy)
  const guideTrack = buildGuideTrack(poses, segment, ext.refWindow, ext.rootRef, ext.torsoMedian)

  // The neutral frame repeated (still self-test): first track member inside the reference window.
  const sourceRefEnd = Math.ceil((refEnd / C.hz) * fps)
  let stillFrame: OpenPoseKeypointFrame['people'][number] | null = null
  for (let t = 0; t <= Math.min(frames.length - 1, sourceRefEnd) && !stillFrame; t += 1) {
    stillFrame = selection.track.members.get(t)?.person ?? null
  }

  return {
    ok,
    gates,
    suggestedTrim,
    template: {
      features,
      guideTrack,
      templateHash: hash,
      activeParts,
      durationSec: features.durationSec,
      activeStartSec: features.activeStartSec,
      activeEndSec: features.activeEndSec,
      lateralized,
    },
    selfTest: selfTest(frames, fps, features, hash, input.mirrorPolicy, videoSize, stillFrame),
  }
}
