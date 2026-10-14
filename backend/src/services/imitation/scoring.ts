/**
 * imitation-v1 step F: score a child's attempt against a compiled template.
 * Deterministic and synchronous; sizes are capped (template ≤ 459 samples,
 * child ≤ 900) so the DTW stays within a few hundred milliseconds.
 */
import { performance } from 'node:perf_hooks'
import {
  ARM_PAIRS,
  L_SHOULDER,
  LEG_PAIRS,
  R_SHOULDER,
  cleanAndResample,
  selectExerciseTrack,
  swapPairs,
  type Joints,
} from './cleaning'
import { IMITATION_V1 as C } from './constants'
import { STEP_FASTER_2, STEP_IN_PHASE, subsequenceDtw } from './dtw'
import {
  FEATURE_IDS,
  PART_IDS,
  cappedDiff,
  clamp01,
  extractFeatures,
  mirrorFeatureId,
  mirrorPartId,
  rangeOfMotion,
  windowSamples,
} from './features'
import { buildFeedback, type FeedbackPart } from './feedback'
import {
  PARTS,
  type FeatureId,
  type FeatureSet,
  type ImitationBand,
  type ImitationReasonCode,
  type ImitationResult,
  type ImitationWarningCode,
  type PartId,
  type PartResult,
  type ScoreInput,
  type TemplateFeatures,
} from './types'

type Mode = 'anatomical' | 'mirror'

/** The template seen in one mode, named from the child's side. */
export interface TemplateView {
  n: number
  set: FeatureSet
  rom: Record<FeatureId, number>
  dominant: Record<PartId, FeatureId>
  active: Record<PartId, boolean>
  featureWeight: Record<FeatureId, number>
  partWeight: Record<PartId, number>
  phaseWeight: Record<PartId, number[]>
}

export function templateView(t: TemplateFeatures, mode: Mode): TemplateView {
  if (mode === 'anatomical') {
    return {
      n: t.n,
      set: t.anatomical,
      rom: t.rom,
      dominant: t.dominant,
      active: t.active,
      featureWeight: t.featureWeight,
      partWeight: t.partWeight,
      phaseWeight: t.phaseWeight,
    }
  }
  const rom = {} as Record<FeatureId, number>
  const featureWeight = {} as Record<FeatureId, number>
  for (const f of FEATURE_IDS) {
    rom[f] = t.rom[mirrorFeatureId(f)]
    featureWeight[f] = t.featureWeight[mirrorFeatureId(f)]
  }
  const dominant = {} as Record<PartId, FeatureId>
  const active = {} as Record<PartId, boolean>
  const partWeight = {} as Record<PartId, number>
  const phaseWeight = {} as Record<PartId, number[]>
  for (const p of PART_IDS) {
    const src = mirrorPartId(p)
    dominant[p] = mirrorFeatureId(t.dominant[src])
    active[p] = t.active[src]
    partWeight[p] = t.partWeight[src]
    phaseWeight[p] = t.phaseWeight[src]
  }
  return { n: t.n, set: t.mirrored, rom, dominant, active, featureWeight, partWeight, phaseWeight }
}

// ---------------------------------------------------------------------------
// Local cost
// ---------------------------------------------------------------------------

interface PartArrays {
  part: PartId
  W: number
  sumW: number
  feats: Array<{ w: number; tv: Float64Array; ta: Float64Array; xv: Float64Array; xa: Float64Array }>
}

function toArrays(values: Array<number | null>, avail: number[], length: number): [Float64Array, Float64Array] {
  const v = new Float64Array(length)
  const a = new Float64Array(length)
  for (let i = 0; i < length; i += 1) {
    const x = values[i]
    const av = avail[i] ?? 0
    if (x === null || x === undefined || !Number.isFinite(x) || !(av > 0)) continue
    v[i] = x
    a[i] = av
  }
  return [v, a]
}

function buildPartArrays(view: TemplateView, child: FeatureSet, m: number): PartArrays[] {
  return PART_IDS.map((part) => {
    const feats = PARTS[part]
      .filter((f) => view.featureWeight[f] > 0)
      .map((f) => {
        const [tv, ta] = toArrays(view.set.values[f], view.set.avail[f], view.n)
        const [xv, xa] = toArrays(child.values[f], child.avail[f], m)
        return { w: view.featureWeight[f], tv, ta, xv, xa }
      })
    return { part, W: view.partWeight[part], sumW: feats.reduce((acc, f) => acc + f.w, 0), feats }
  })
}

/** Whether one side alone shows enough of the part (Σ a·w ≥ 0.5 Σ w). */
function sideVisible(p: PartArrays, side: 't' | 'x', k: number): boolean {
  let present = 0
  for (const f of p.feats) present += (side === 't' ? f.ta[k] : f.xa[k]) * f.w
  return p.sumW > 0 && present >= C.partVisibleWeightShare * p.sumW
}

/** c_p(i, j), or −1 when the part is not visible enough in this pair. */
function partCost(p: PartArrays, i: number, j: number): number {
  let sw = 0
  let swc = 0
  for (const f of p.feats) {
    const a = f.ta[i] * f.xa[j]
    if (a === 0) continue
    const aw = a * f.w
    sw += aw
    swc += aw * cappedDiff(f.tv[i], f.xv[j])
  }
  if (sw <= 0 || sw < C.partVisibleWeightShare * p.sumW) return -1
  return swc / sw
}

/**
 * C(i, j) for every cell, computed row by row over typed arrays (same result
 * as combining partCost per cell, several times faster for 459 × 900).
 */
function costMatrix(parts: PartArrays[], n: number, m: number): Float64Array {
  const out = new Float64Array(n * m)
  const sw = new Float64Array(m)
  const swc = new Float64Array(m)
  const num = new Float64Array(m)
  const den = new Float64Array(m)
  for (let i = 0; i < n; i += 1) {
    num.fill(0)
    den.fill(0)
    for (const p of parts) {
      if (p.W <= 0) continue
      sw.fill(0)
      swc.fill(0)
      for (const f of p.feats) {
        const ta = f.ta[i]
        if (ta === 0) continue
        const tv = f.tv[i]
        const w = f.w * ta
        const { xa, xv } = f
        for (let j = 0; j < m; j += 1) {
          const a = xa[j]
          if (a === 0) continue
          const aw = a * w
          sw[j] += aw
          swc[j] += aw * cappedDiff(tv, xv[j])
        }
      }
      const minW = C.partVisibleWeightShare * p.sumW
      for (let j = 0; j < m; j += 1) {
        if (sw[j] <= 0 || sw[j] < minW) continue
        num[j] += (p.W * swc[j]) / sw[j]
        den[j] += p.W
      }
    }
    const row = i * m
    for (let j = 0; j < m; j += 1) out[row + j] = den[j] > 0 ? num[j] / den[j] : C.featureCap
  }
  return out
}

// ---------------------------------------------------------------------------
// One mode
// ---------------------------------------------------------------------------

interface PartEvaluation {
  part: PartId
  active: boolean
  /**
   * The child's side hid the part where the demonstration showed it (feedback
   * only: a part the demonstrator also turned away is not the child's doing).
   */
  hiddenByChild: boolean
  visible: boolean
  visibility: number
  spatialError: number | null
  spatial: number | null
  ratio: number | null
  score: number | null
  dominant: FeatureId
  worstWindowSec: [number, number] | null
}

interface ModeEvaluation {
  mode: Mode
  reasons: ImitationReasonCode[]
  overall: number | null
  lowMotion: boolean
  parts: PartEvaluation[]
  tempo: ImitationResult['tempo']
  tempoLimit: boolean
}

function amplitudeScore(r: number): number {
  const a = C.amplitude
  if (r >= a.okLo && r <= a.okHi) return 1
  if (r < a.okLo) return clamp01((r - a.zeroLo) / a.spanLo)
  return clamp01(1 - (r - a.okHi) / a.spanHi)
}

function tempoScore(rho: number): number {
  const t = C.tempo
  if (rho >= t.okLo && rho <= t.okHi) return 1
  if (rho < t.okLo) return clamp01((rho - t.zeroLo) / (t.okLo - t.zeroLo))
  return clamp01((t.zeroHi - rho) / (t.zeroHi - t.okHi))
}

const round = (v: number, digits: number) => {
  const f = 10 ** digits
  const r = Math.round(v * f) / f
  return r === 0 ? 0 : r
}

function evaluateMode(
  mode: Mode,
  view: TemplateView,
  child: FeatureSet,
  m: number,
  input: ScoreInput,
  notFacing: boolean,
): ModeEvaluation {
  const n = view.n
  const parts = buildPartArrays(view, child, m)
  const cost = costMatrix(parts, n, m)
  const dtw = subsequenceDtw(n, m, (i, j) => cost[i * m + j])

  const emptyTempo: ImitationResult['tempo'] = {
    ratio: null,
    lagSec: null,
    score: null,
    aheadShare: null,
    behindShare: null,
    inPhaseShare: null,
  }
  if (!dtw.path.length) {
    return {
      mode,
      reasons: ['TOO_FEW_FRAMES'],
      overall: null,
      lowMotion: false,
      parts: PART_IDS.map((part) => ({
        part,
        active: view.active[part],
        hiddenByChild: false,
        visible: false,
        visibility: 0,
        spatialError: null,
        spatial: null,
        ratio: null,
        score: null,
        dominant: view.dominant[part],
        worstWindowSec: null,
      })),
      tempo: emptyTempo,
      tempoLimit: false,
    }
  }

  const { jStart, jEnd, path, steps } = dtw
  const windowLen = windowSamples(C.worstWindowSec)

  const evaluations: PartEvaluation[] = parts.map((p) => {
    const sum = new Float64Array(n)
    const count = new Float64Array(n)
    let visiblePairs = 0
    let templateShown = 0
    let childShown = 0
    for (const [i, j] of path) {
      if (sideVisible(p, 't', i)) {
        templateShown += 1
        if (sideVisible(p, 'x', j)) childShown += 1
      }
      const c = partCost(p, i, j)
      if (c < 0) continue
      sum[i] += c
      count[i] += 1
      visiblePairs += 1
    }
    const omega = view.phaseWeight[p.part]
    let num = 0
    let den = 0
    const error = new Float64Array(n) // ω · mean c_p per template sample, for the worst window
    for (let i = 0; i < n; i += 1) {
      if (!count[i]) continue
      const w = omega[i] ?? 1
      const meanCost = sum[i] / count[i]
      num += w * meanCost
      den += w
      error[i] = w * meanCost
    }
    const visibility = visiblePairs / path.length
    const spatialError = den > 0 ? num / den : null
    const spatial = spatialError === null ? null : 100 * clamp01((C.eBad - spatialError) / (C.eBad - C.eOk))
    const visible = spatial !== null && p.feats.length > 0 && visibility >= C.visibilityMin
    const active = view.active[p.part]
    const dominant = view.dominant[p.part]

    let ratio: number | null = null
    let score: number | null = spatial
    if (active) {
      const romTemplate = view.rom[dominant]
      ratio = romTemplate > 0 ? rangeOfMotion(child.values[dominant].slice(jStart, jEnd + 1)) / romTemplate : 0
      if (spatial !== null) score = spatial * (0.4 + 0.6 * amplitudeScore(ratio))
    }

    let worstWindowSec: [number, number] | null = null
    if (visible) {
      const len = Math.min(windowLen, n)
      let acc = 0
      for (let i = 0; i < len; i += 1) acc += error[i]
      let best = acc
      let bestStart = 0
      for (let s = 1; s + len <= n; s += 1) {
        acc += error[s + len - 1] - error[s - 1]
        if (acc > best + 1e-9) {
          best = acc
          bestStart = s
        }
      }
      worstWindowSec = [round(bestStart / C.hz, 1), round((bestStart + len) / C.hz, 1)]
    }

    return {
      part: p.part,
      active,
      hiddenByChild: templateShown > 0 && childShown / templateShown < C.visibilityMin,
      visible,
      visibility,
      spatialError,
      spatial: visible ? spatial : null,
      ratio,
      score: visible ? score : null,
      dominant,
      worstWindowSec,
    }
  })

  // Tempo and timing
  const matched = jEnd - jStart + 1
  const rho = (matched / n) * (input.practiceMode === 'FOLLOW_ALONG' ? input.playbackRate : 1)
  const tempo = tempoScore(rho)
  const lagSec =
    input.practiceMode === 'FOLLOW_ALONG' && input.guideOffsetMs !== null && Number.isFinite(input.guideOffsetMs)
      ? jStart / C.hz - input.guideOffsetMs / 1000
      : null
  const stepCount = steps.length || 1
  const inPhase = steps.filter((s) => s === STEP_IN_PHASE).length / stepCount
  const ahead = steps.filter((s) => s === STEP_FASTER_2).length / stepCount
  const behind = steps.length ? 1 - inPhase - ahead : 0

  const reasons: ImitationReasonCode[] = []
  if (matched / C.hz < Math.max(C.minMatchedSec, (C.minMatchedRel * n) / C.hz)) reasons.push('TOO_FEW_FRAMES')
  if (evaluations.some((e) => e.active && !e.visible)) reasons.push('ACTIVE_PART_NOT_VISIBLE')

  const activeParts = evaluations.filter((e) => e.active)
  const lowMotion = activeParts.length > 0 && activeParts.every((e) => (e.ratio ?? 0) < C.lowMotion.r)

  let overall: number | null = null
  if (!reasons.length) {
    const scoredActive = activeParts.filter((e) => e.score !== null)
    let base = 0
    if (scoredActive.length) {
      let wSum = 0
      for (const e of scoredActive) {
        base += view.partWeight[e.part] * (e.score as number)
        wSum += view.partWeight[e.part]
      }
      base = wSum > 0 ? base / wSum : 0
    }
    const visibleStatic = evaluations.filter((e) => !e.active && e.visible && e.spatial !== null)
    const staticMean = visibleStatic.length
      ? visibleStatic.reduce((acc, e) => acc + (e.spatial as number), 0) / visibleStatic.length
      : 100
    const staticFactor = C.overall.staticFloor + (1 - C.overall.staticFloor) * (staticMean / 100)
    const tempoFactor = C.overall.tempoFloor + (1 - C.overall.tempoFloor) * tempo
    overall = Math.round(base * staticFactor * tempoFactor)
    if (lowMotion) overall = Math.min(overall, C.lowMotion.cap)
    if (notFacing) overall = Math.min(overall, C.notFacing.cap)
  }

  return {
    mode,
    reasons,
    overall,
    lowMotion,
    parts: evaluations,
    tempo: {
      ratio: round(rho, 3),
      lagSec: lagSec === null ? null : round(lagSec, 2),
      score: round(tempo, 3),
      aheadShare: round(ahead, 3),
      behindShare: round(behind, 3),
      inPhaseShare: round(inPhase, 3),
    },
    tempoLimit: rho > C.tempo.limitHi || rho < C.tempo.limitLo,
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const WARNING_ORDER: ImitationWarningCode[] = [
  'NOT_FACING',
  'MULTI_PERSON',
  'FPS_UNCERTAIN',
  'TEMPO_LIMIT',
  'LOW_MOTION',
  'ROLL_UNCERTAIN',
  'MIRRORED_VIDEO',
]

export function starsFor(overall: number): 1 | 2 | 3 {
  const [three, two] = C.stars
  return overall >= three ? 3 : overall >= two ? 2 : 1
}

export function bandFor(overall: number): ImitationBand {
  const [veryClose, close, progressing] = C.bands
  if (overall >= veryClose) return 'VERY_CLOSE'
  if (overall >= close) return 'CLOSE'
  if (overall >= progressing) return 'PROGRESSING'
  return 'KEEP_PRACTISING'
}

function partResult(e: PartEvaluation): PartResult {
  return {
    status: e.visible ? 'ok' : 'not_visible',
    active: e.active,
    score: e.visible && e.score !== null ? Math.round(e.score) : null,
    spatialErrorDeg: e.visible && e.spatialError !== null ? round(e.spatialError, 1) : null,
    amplitudeRatio: e.visible && e.ratio !== null ? round(e.ratio, 2) : null,
    visibility: round(e.visibility, 3),
    worstWindowSec: e.worstWindowSec,
  }
}

function feedbackParts(parts: PartEvaluation[]): FeedbackPart[] {
  return parts.map((e) => ({
    part: e.part,
    active: e.active,
    visible: e.visible,
    hiddenByChild: e.hiddenByChild,
    score: e.score,
    ratio: e.ratio,
    dominant: e.dominant,
    worstWindowSec: e.worstWindowSec,
  }))
}

/** x of the person's left shoulder is left of the right one in most samples: the picture looks flipped. */
function looksMirrored(poses: Array<Joints | null>): boolean {
  let measured = 0
  let flipped = 0
  for (const joints of poses) {
    const l = joints?.[L_SHOULDER]
    const r = joints?.[R_SHOULDER]
    if (!l || !r) continue
    measured += 1
    if (l.x < r.x) flipped += 1
  }
  return measured > 0 && flipped / measured > C.mirroredShare
}

export function scoreImitation(input: ScoreInput): ImitationResult {
  const started = performance.now()
  const template = input.template
  const warnings = new Set<ImitationWarningCode>()
  if (input.fpsWarning) warnings.add('FPS_UNCERTAIN')
  const fps = Number.isFinite(input.fps) && input.fps > 0 ? input.fps : 0

  const finish = (
    status: ImitationResult['status'],
    reasons: ImitationReasonCode[],
    coverage: number,
    evaluation: ModeEvaluation | null,
    lateralized: boolean,
  ): ImitationResult => {
    const scored = status === 'SCORED' && evaluation !== null && evaluation.overall !== null
    const overall = scored ? (evaluation.overall as number) : null
    if (scored && evaluation.lowMotion) warnings.add('LOW_MOTION')
    if (evaluation?.tempoLimit) warnings.add('TEMPO_LIMIT')
    const band = overall === null ? null : bandFor(overall)
    const mode = scored && lateralized ? evaluation.mode : null
    const parts = {} as Record<PartId, PartResult>
    for (const p of PART_IDS) {
      const e = evaluation?.parts.find((x) => x.part === p)
      parts[p] = e
        ? partResult(e)
        : {
            status: 'not_visible',
            active: template.active?.[p] ?? false,
            score: null,
            spatialErrorDeg: null,
            amplitudeRatio: null,
            visibility: 0,
            worstWindowSec: null,
          }
    }
    const feedback = buildFeedback({
      status,
      reasons,
      band,
      parts: evaluation
        ? feedbackParts(evaluation.parts)
        : PART_IDS.map((p) => ({
            part: p,
            active: template.active?.[p] ?? false,
            visible: false,
            hiddenByChild: false,
            score: null,
            ratio: null,
            dominant: template.dominant?.[p] ?? PARTS[p][0],
            worstWindowSec: null,
          })),
      tempoRatio: scored ? evaluation.tempo.ratio : null,
      lagSec: scored ? evaluation.tempo.lagSec : null,
      practiceMode: input.practiceMode,
      mirrorMode: mode === 'mirror',
    })
    return {
      algorithmVersion: C.version,
      templateId: input.templateId,
      templateHash: input.templateHash,
      status,
      reasonCodes: reasons,
      overall,
      stars: overall === null ? null : starsFor(overall),
      band,
      mode,
      lowMotion: scored ? evaluation.lowMotion : false,
      tempo: evaluation
        ? evaluation.tempo
        : { ratio: null, lagSec: null, score: null, aheadShare: null, behindShare: null, inPhaseShare: null },
      parts,
      quality: {
        trackCoverage: round(coverage, 3),
        fpsEff: round(fps, 2),
        fpsSource: input.fpsSource,
        warnings: WARNING_ORDER.filter((w) => warnings.has(w)),
        scoringMs: round(performance.now() - started, 1),
      },
      feedback,
    }
  }

  // 1. Person
  const frames = [...(input.frames ?? [])].sort((a, b) => a.frame_index - b.frame_index)
  if (!frames.length || !fps) return finish('INSUFFICIENT', ['TOO_FEW_FRAMES'], 0, null, template.lateralized)
  const selection = selectExerciseTrack(frames, input.videoSize)
  if (!selection.track) return finish('INSUFFICIENT', ['TOO_FEW_FRAMES'], 0, null, template.lateralized)
  if (selection.multiPerson) warnings.add('MULTI_PERSON')
  if (selection.coverage < C.coverageMin) {
    return finish('INSUFFICIENT', ['TOO_FEW_FRAMES'], selection.coverage, null, template.lateralized)
  }

  // 2. Resample and length checks
  let poses = cleanAndResample(selection.track, frames.length, fps)
  const early: ImitationReasonCode[] = []
  if (poses.length < C.minResampledFrames) early.push('TOO_FEW_FRAMES')
  if (poses.length < C.minRecordingRel * template.n) early.push('VIDEO_TOO_SHORT')
  if (early.length) return finish('INSUFFICIENT', early, selection.coverage, null, template.lateralized)
  if (poses.length > C.caps.maxChildSamples) poses = poses.slice(0, C.caps.maxChildSamples)

  // 3. Child features (a flipped picture is relabelled so it reads like a mirrored video)
  if (looksMirrored(poses)) {
    warnings.add('MIRRORED_VIDEO')
    poses = poses.map((joints) => {
      if (!joints) return null
      const copy = joints.slice()
      swapPairs(copy, ARM_PAIRS)
      swapPairs(copy, LEG_PAIRS)
      return copy
    })
  }
  const child = extractFeatures(poses, 'child')
  if (child.rollUncertain) warnings.add('ROLL_UNCERTAIN')
  const measured = child.shoulderRatio.filter((r): r is number => r !== null)
  const narrow = measured.filter((r) => r < C.notFacing.shoulderTorso).length
  const notFacing = measured.length === 0 || narrow / measured.length > C.notFacing.share
  if (notFacing) warnings.add('NOT_FACING')

  // 4–6. Modes allowed by the policy; keep the better one (anatomical within 1 point)
  const modes: Mode[] =
    input.mirrorPolicy === 'ANATOMICAL_ONLY' ? ['anatomical'] : input.mirrorPolicy === 'MIRROR_ONLY' ? ['mirror'] : ['anatomical', 'mirror']
  const evaluations = modes.map((mode) => evaluateMode(mode, templateView(template, mode), child.set, poses.length, input, notFacing))
  const scored = evaluations.filter((e) => !e.reasons.length && e.overall !== null)
  let chosen: ModeEvaluation
  if (scored.length) {
    chosen = scored.reduce((best, e) => ((e.overall as number) > (best.overall as number) + 1 ? e : best))
  } else {
    chosen = [...evaluations].sort((a, b) => a.reasons.length - b.reasons.length)[0]
  }

  // 7–8. Gates after alignment
  if (chosen.reasons.length) return finish('INSUFFICIENT', chosen.reasons, selection.coverage, chosen, template.lateralized)
  return finish('SCORED', [], selection.coverage, chosen, template.lateralized)
}
