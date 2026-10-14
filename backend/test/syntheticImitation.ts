/**
 * Synthetic child attempts for the imitation scoring tests and the e2e fake ML
 * server. Built on src/services/imitation/syntheticPose.ts: child proportions,
 * 30 fps, 0.67× the template's pixel scale, offset, 4° camera roll, 2 px noise,
 * 3 % dropped joints, 1.5 s lead-in and 1 s tail by default. No real data.
 */
import type { OpenPoseKeypointFrame } from '../src/services/openposeService'
import {
  BUILTIN_EXERCISES,
  BUILTIN_SPECS,
  BUILTIN_VIDEO_SIZE,
  CHILD_BODY,
  ADULT_BODY,
  NEUTRAL_POSE,
  buildTemplate,
  makeSyntheticFrames,
  reflectFrames,
  scoreImitation,
  type BodyProportions,
  type CompiledTemplate,
  type ImitationResult,
  type MirrorPolicyValue,
  type ScoreInput,
  type SyntheticExerciseSpec,
  type SyntheticPoseAngles,
} from '../src/services/imitation'
import { gaussian, mulberry32, ramp } from '../src/services/imitation/syntheticPose'

export const CHILD_VIDEO = Object.freeze({ width: 960, height: 540, fps: 30 })
/** 0.67 × the built-in demonstrator's 200 px per torso length. */
export const CHILD_PX_PER_TORSO = 134

export type ScenarioName =
  | 'identical'
  | 'mirrored'
  | 'half_amplitude'
  | 'still'
  | 'different'
  | 'legs_hidden'
  | 'slow_1_5x'
  | 'too_short'

export const SCENARIO_NAMES: ScenarioName[] = [
  'identical',
  'mirrored',
  'half_amplitude',
  'still',
  'different',
  'legs_hidden',
  'slow_1_5x',
  'too_short',
]

/** Movement used for the "different" scenario of each built-in. */
export const DIFFERENT_MOVEMENT: Record<string, string> = {
  'dang-tay': 'buoc-deu',
  'gio-tay-chao': 'nghieng-nguoi',
  'vuon-cao': 'nghieng-nguoi',
  'nghieng-nguoi': 'dang-tay',
  'ngoi-xuong': 'dang-tay',
  'buoc-deu': 'dang-tay',
}

const ANGLE_KEYS = ['lUpper', 'lFore', 'rUpper', 'rFore', 'lThigh', 'lShank', 'rThigh', 'rShank', 'lean'] as const
const POSE_KEYS = Object.keys(NEUTRAL_POSE) as Array<keyof SyntheticPoseAngles>
const MIRROR_KEY: Partial<Record<keyof SyntheticPoseAngles, keyof SyntheticPoseAngles>> = {}
for (const key of POSE_KEYS) {
  if (key.startsWith('l')) MIRROR_KEY[key] = `r${key.slice(1)}` as keyof SyntheticPoseAngles
  else if (key.startsWith('r')) MIRROR_KEY[key] = `l${key.slice(1)}` as keyof SyntheticPoseAngles
}

export function getBuiltinSpec(slug: string): SyntheticExerciseSpec {
  const spec = BUILTIN_SPECS[slug] ?? EXTRA_SPECS[slug]
  if (!spec) throw new Error(`unknown movement ${slug}`)
  return spec
}

/** Movements that are not built-ins, for "different movement" cases. */
export const EXTRA_SPECS: Record<string, SyntheticExerciseSpec> = {
  // Upper arms forward towards the camera, forearms up (elbows bent), twice.
  'bent-elbow-forward': {
    durationSec: 7,
    pose(t) {
      const b = ramp(t, 1, 1) * (1 - ramp(t, 2.5, 1)) + ramp(t, 3.5, 1) * (1 - ramp(t, 5, 1))
      return {
        lUpperFwd: 0.8 * b,
        rUpperFwd: 0.8 * b,
        lFore: NEUTRAL_POSE.lFore + 160 * b,
        rFore: NEUTRAL_POSE.rFore + 160 * b,
        lForeFwd: 0.3 * b,
        rForeFwd: 0.3 * b,
      }
    },
  },
  still: { durationSec: 6, pose: () => ({}) },
}

export interface SpecTransform {
  /** Scales every deviation from the neutral pose. */
  amplitude?: number
  /** The child mirrors the guide: left and right limbs exchanged, lean and side shift negated. */
  mirror?: boolean
  /** Smooth random wobble added to every limb and trunk angle (± degrees). */
  wobbleDeg?: number
  seed?: number
}

export function transformSpec(spec: SyntheticExerciseSpec, tr: SpecTransform): SyntheticExerciseSpec {
  const amplitude = tr.amplitude ?? 1
  const rand = mulberry32((tr.seed ?? 1) * 7919 + 13)
  const wobble = ANGLE_KEYS.map(() => ({ freq: 0.35 + 0.4 * rand(), phase: 2 * Math.PI * rand(), freq2: 0.9 + 0.5 * rand(), phase2: 2 * Math.PI * rand() }))
  return {
    durationSec: spec.durationSec,
    pose(t) {
      const raw = { ...NEUTRAL_POSE, ...spec.pose(t) } as SyntheticPoseAngles
      const out = { ...raw }
      for (const key of POSE_KEYS) out[key] = NEUTRAL_POSE[key] + amplitude * (raw[key] - NEUTRAL_POSE[key])
      if (tr.mirror) {
        const mirrored = { ...out }
        for (const key of POSE_KEYS) {
          const other = MIRROR_KEY[key]
          if (other) mirrored[key] = out[other]
        }
        mirrored.lean = -out.lean
        mirrored.shiftX = -out.shiftX
        Object.assign(out, mirrored)
      }
      const wobbleDeg = tr.wobbleDeg ?? 0
      if (wobbleDeg) {
        ANGLE_KEYS.forEach((key, k) => {
          const w = wobble[k]
          // Two incommensurate sines: smooth, within ±wobbleDeg.
          const s1 = Math.sin(2 * Math.PI * w.freq * t + w.phase)
          const s2 = Math.sin(2 * Math.PI * w.freq2 * t + w.phase2)
          out[key] += wobbleDeg * (0.7 * s1 + 0.3 * s2)
        })
      }
      return out
    },
  }
}

export interface ChildOptions extends SpecTransform {
  fps?: number
  leadSec?: number
  tailSec?: number
  /** The child takes `stretch` times as long as the demonstration. */
  stretch?: number
  /** Total output length (cuts the attempt short). */
  durationSec?: number
  body?: BodyProportions
  pxPerTorso?: number
  centerX?: number
  centerY?: number
  rollDeg?: number
  yawDeg?: number
  noisePx?: number
  dropRate?: number
  /** Whole-body sway (time-varying camera roll about the hips, ± degrees on top of `rollDeg`). */
  swayDeg?: number
  /** Knees, ankles and feet outside the picture. */
  hideLegs?: boolean
  /** Share of frames in which OpenPose exchanges the arm labels. */
  armSwapRate?: number
  /** Share of frames (a centred block) in which the child is detected at all. */
  coverage?: number
  /** Another person in the picture: a still adult at the edge, or someone doing the same movement. */
  extraPerson?: 'still' | 'moving' | null
  /** Horizontally reflected picture with anatomical labels (looks like a back view / flipped video). */
  flipVideo?: boolean
}

const ARM_SWAP = new Map([
  [2, 5],
  [3, 6],
  [4, 7],
  [5, 2],
  [6, 3],
  [7, 4],
])
const LEG_IDS = new Set([10, 11, 13, 14, 19, 20, 21, 22, 23, 24])

/** A child attempt at `spec` with the given camera conditions and transforms. */
export function childFrames(spec: SyntheticExerciseSpec, opts: ChildOptions = {}): OpenPoseKeypointFrame[] {
  const seed = opts.seed ?? 1
  const fps = opts.fps ?? CHILD_VIDEO.fps
  const lead = opts.leadSec ?? 1.5
  const tail = opts.tailSec ?? 1
  const stretch = opts.stretch ?? 1
  const durationSec = opts.durationSec ?? lead + spec.durationSec * stretch + tail
  const moved = transformSpec(spec, opts)
  const timeMap = (t: number) => (t - lead) / stretch
  const baseRoll = opts.rollDeg ?? 4
  const swayRand = mulberry32(seed * 31337 + 3)
  const sway = { f1: 0.3 + 0.3 * swayRand(), p1: 2 * Math.PI * swayRand(), f2: 0.8 + 0.4 * swayRand(), p2: 2 * Math.PI * swayRand() }
  const swayDeg = opts.swayDeg ?? 0
  const rollAt = (t: number) =>
    baseRoll + swayDeg * (0.7 * Math.sin(2 * Math.PI * sway.f1 * t + sway.p1) + 0.3 * Math.sin(2 * Math.PI * sway.f2 * t + sway.p2))
  const frames = makeSyntheticFrames(moved, {
    fps,
    durationSec,
    timeMap,
    body: opts.body ?? CHILD_BODY,
    width: CHILD_VIDEO.width,
    height: CHILD_VIDEO.height,
    pxPerTorso: opts.pxPerTorso ?? CHILD_PX_PER_TORSO,
    centerX: opts.centerX ?? 450,
    centerY: opts.centerY ?? 300,
    rollAt,
    yawDeg: opts.yawDeg ?? 0,
    noisePx: opts.noisePx ?? 2,
    dropRate: opts.dropRate ?? 0.03,
    seed,
  })

  const rand = mulberry32(seed * 104729 + 7)
  const count = frames.length
  const coverage = opts.coverage ?? 1
  const keepFrom = Math.floor(((1 - coverage) / 2) * count)
  const keepTo = keepFrom + Math.round(coverage * count)

  let extra: OpenPoseKeypointFrame[] | null = null
  if (opts.extraPerson === 'still') {
    extra = makeSyntheticFrames(EXTRA_SPECS.still, {
      fps,
      durationSec,
      body: ADULT_BODY,
      width: CHILD_VIDEO.width,
      height: CHILD_VIDEO.height,
      pxPerTorso: 105,
      centerX: 860,
      centerY: 290,
      noisePx: 1,
      confidence: 0.93,
      seed: seed + 101,
      personId: 1,
    })
  } else if (opts.extraPerson === 'moving') {
    extra = makeSyntheticFrames(moved, {
      fps,
      durationSec,
      timeMap: (t) => timeMap(t) - 0.3,
      body: ADULT_BODY,
      width: CHILD_VIDEO.width,
      height: CHILD_VIDEO.height,
      pxPerTorso: 95,
      centerX: 800,
      centerY: 290,
      noisePx: 1.5,
      seed: seed + 202,
      personId: 1,
    })
  }

  let out = frames.map((frame, i) => {
    const people: OpenPoseKeypointFrame['people'] = []
    if (i >= keepFrom && i < keepTo) {
      const swapArms = opts.armSwapRate ? rand() < opts.armSwapRate : false
      for (const person of frame.people) {
        people.push({
          person_id: person.person_id,
          body25: person.body25.map((j) => {
            if (opts.hideLegs && LEG_IDS.has(j.id)) return { id: j.id, x: 0, y: 0, confidence: 0 }
            return swapArms && ARM_SWAP.has(j.id) ? { ...j, id: ARM_SWAP.get(j.id) as number } : j
          }),
        })
      }
    }
    // The other person is listed first (and is the more confident one when still).
    if (extra) people.unshift(...extra[i].people)
    return { frame_index: i, people }
  })
  if (opts.flipVideo) out = reflectFrames(out, CHILD_VIDEO.width, false)
  return out
}

export function scenarioOptions(scenario: ScenarioName, seed: number): { movement: 'same' | 'different' | 'still'; opts: ChildOptions } {
  switch (scenario) {
    case 'identical':
      return { movement: 'same', opts: { seed } }
    case 'mirrored':
      return { movement: 'same', opts: { seed, mirror: true } }
    case 'half_amplitude':
      return { movement: 'same', opts: { seed, amplitude: 0.5 } }
    case 'still':
      return { movement: 'still', opts: { seed } }
    case 'different':
      return { movement: 'different', opts: { seed } }
    case 'legs_hidden':
      return { movement: 'same', opts: { seed, hideLegs: true } }
    case 'slow_1_5x':
      return { movement: 'same', opts: { seed, stretch: 1.5 } }
    case 'too_short':
      return { movement: 'same', opts: { seed, durationSec: 1 } }
  }
}

/** Contract for the e2e fake ML server (PB2): keypoints of a child attempt at a built-in exercise. */
export function buildScenario(
  slug: string,
  scenario: ScenarioName,
  opts: { seed?: number } = {},
): { frames: OpenPoseKeypointFrame[]; fps: number; width: number; height: number; durationMs: number } {
  if (!BUILTIN_SPECS[slug]) throw new Error(`unknown built-in exercise ${slug}`)
  const { movement, opts: childOpts } = scenarioOptions(scenario, opts.seed ?? 1)
  const spec =
    movement === 'same'
      ? BUILTIN_SPECS[slug]
      : movement === 'different'
        ? BUILTIN_SPECS[DIFFERENT_MOVEMENT[slug]]
        : { durationSec: BUILTIN_SPECS[slug].durationSec, pose: () => ({}) }
  const frames = childFrames(spec, childOpts)
  return {
    frames,
    fps: CHILD_VIDEO.fps,
    width: CHILD_VIDEO.width,
    height: CHILD_VIDEO.height,
    durationMs: Math.round((frames.length / CHILD_VIDEO.fps) * 1000),
  }
}

// ---------------------------------------------------------------------------
// Template + scoring helpers for the tests
// ---------------------------------------------------------------------------

const compiled = new Map<string, CompiledTemplate>()

export function compiledBuiltin(slug: string): CompiledTemplate {
  const cached = compiled.get(slug)
  if (cached) return cached
  const builtin = BUILTIN_EXERCISES.find((b) => b.slug === slug)
  if (!builtin) throw new Error(`unknown built-in exercise ${slug}`)
  const result = buildTemplate({
    frames: builtin.makeFrames(),
    fps: builtin.fps,
    mirrorPolicy: builtin.mirrorPolicy,
    videoSize: BUILTIN_VIDEO_SIZE,
  })
  if (!result.ok || !result.template) throw new Error(`built-in ${slug} does not compile: ${JSON.stringify(result.gates)}`)
  compiled.set(slug, result.template)
  return result.template
}

export function scoreFrames(
  template: CompiledTemplate,
  frames: OpenPoseKeypointFrame[],
  overrides: Partial<ScoreInput> & { mirrorPolicy?: MirrorPolicyValue } = {},
): ImitationResult {
  return scoreImitation({
    template: template.features,
    templateHash: template.templateHash,
    templateId: 'test-template',
    mirrorPolicy: 'EITHER',
    frames,
    fps: CHILD_VIDEO.fps,
    fpsSource: 'duration',
    fpsWarning: false,
    videoSize: { width: CHILD_VIDEO.width, height: CHILD_VIDEO.height },
    practiceMode: 'AFTER_DEMO',
    playbackRate: 1,
    guideOffsetMs: null,
    ...overrides,
  })
}

/** Score a child attempt at a built-in (or extra) movement against a built-in template. */
export function scoreAttempt(
  templateSlug: string,
  opts: ChildOptions & { movement?: string; score?: Partial<ScoreInput> } = {},
): ImitationResult {
  const spec = getBuiltinSpec(opts.movement ?? templateSlug)
  return scoreFrames(compiledBuiltin(templateSlug), childFrames(spec, opts), opts.score)
}

export { gaussian, mulberry32 }
