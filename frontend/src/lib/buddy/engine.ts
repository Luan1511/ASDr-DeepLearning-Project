/**
 * Animation engine of "bạn Bin": samples a full Pose every frame from
 *   neutral pose → expression (cross-faded) → clip layers (gestures, ears, step
 *   overrides; later layers win) → procedural idle (breathing, ear sway, blink)
 *   → talking mouth while a caption is being typed.
 * BuddyDirector also plays BuddyScripts (the JSON the backend / LLM sends).
 */
import { useEffect, useRef, useState } from 'react'
import clipsJson from './clips.json'
import expressionsJson from './expressions.json'
import {
  DISCRETE_CHANNELS,
  EAR_MOTIONS,
  EXPRESSIONS,
  LOOKS,
  NUMERIC_CHANNELS,
  type BuddyScript,
  type BuddyStep,
  type Channel,
  type Clip,
  type Ease,
  type ExpressionName,
  type Keyframe,
  type NumericChannel,
  type PartialPose,
  type Pose,
} from './types'

export const NEUTRAL_POSE: Pose = {
  'body.lean': 0,
  'body.bob': 0,
  'head.tilt': 0,
  'head.nod': 0,
  'head.turn': 0,
  'ears.left': 0,
  'ears.right': 0,
  'antenna.bend': 0,
  'armLeft.shoulder': 16,
  'armLeft.elbow': -12,
  'armLeft.wrist': 0,
  'armRight.shoulder': 16,
  'armRight.elbow': -12,
  'armRight.wrist': 0,
  'face.lookX': 0,
  'face.lookY': 0,
  'face.blush': 0.5,
  'face.glow': 0.5,
  'face.mouthOpen': 0,
  'armLeft.hand': 'relaxed',
  'armRight.hand': 'relaxed',
  'face.eyes': 'open',
  'face.brows': 'neutral',
  'face.mouth': 'smile',
}

const isNumericChannel = (k: string): k is NumericChannel => k in NUMERIC_CHANNELS
const isDiscreteChannel = (k: string): k is keyof typeof DISCRETE_CHANNELS => k in DISCRETE_CHANNELS

/** Keeps only known channels with in-range values. */
export function normalizePose(raw: unknown): PartialPose {
  const out: PartialPose = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (isNumericChannel(k) && typeof v === 'number' && Number.isFinite(v)) {
      const [lo, hi] = NUMERIC_CHANNELS[k]
      out[k] = Math.min(hi, Math.max(lo, v))
    } else if (isDiscreteChannel(k) && typeof v === 'string' && (DISCRETE_CHANNELS[k] as readonly string[]).includes(v)) {
      out[k] = v
    }
  }
  return out
}

const EASES: Ease[] = ['linear', 'ease', 'easeIn', 'easeOut', 'back']

export function normalizeClip(raw: unknown): Clip | null {
  if (!raw || typeof raw !== 'object') return null
  const c = raw as Record<string, unknown>
  const frames = Array.isArray(c.keyframes) ? c.keyframes : []
  const keyframes: Keyframe[] = frames
    .filter((f): f is Record<string, unknown> => !!f && typeof f === 'object')
    .map((f) => ({
      t: Math.max(0, Math.min(20_000, Number(f.t) || 0)),
      ease: EASES.includes(f.ease as Ease) ? (f.ease as Ease) : undefined,
      pose: normalizePose(f.pose),
    }))
    .filter((f) => Object.keys(f.pose).length > 0)
    .sort((a, b) => a.t - b.t)
  if (keyframes.length === 0) return null
  const last = keyframes[keyframes.length - 1].t
  const duration = Math.max(last, Math.min(20_000, Number(c.duration) || last || 1000))
  return {
    duration,
    loop: c.loop === true,
    blendIn: typeof c.blendIn === 'number' ? Math.max(0, c.blendIn) : undefined,
    blendOut: typeof c.blendOut === 'number' ? Math.max(0, c.blendOut) : undefined,
    keyframes,
  }
}

export const CLIP_LIBRARY: Record<string, Clip> = Object.fromEntries(
  Object.entries(clipsJson as Record<string, unknown>).flatMap(([name, raw]) => {
    const clip = normalizeClip(raw)
    return clip ? [[name, clip]] : []
  }),
)

export const EXPRESSION_LIBRARY = Object.fromEntries(
  EXPRESSIONS.map((name) => [name, normalizePose((expressionsJson as Record<string, unknown>)[name])]),
) as Record<ExpressionName, PartialPose>

/** Every channel any expression touches, so switching expression resets the others. */
const EXPRESSION_CHANNELS = Array.from(
  new Set(Object.values(EXPRESSION_LIBRARY).flatMap((p) => Object.keys(p) as Channel[])),
)

export const GESTURE_NAMES = Object.keys(CLIP_LIBRARY).filter((n) => !n.startsWith('ears_'))

const LOOK_TARGETS: Record<(typeof LOOKS)[number], { x: number; y: number }> = {
  center: { x: 0, y: 0 },
  left: { x: -0.8, y: 0 },
  right: { x: 0.8, y: 0 },
  up: { x: 0, y: -0.8 },
  down: { x: 0, y: 0.7 },
}

/** Validates a script from any source (backend, playground textarea). */
export function normalizeScript(raw: unknown): BuddyScript | null {
  if (!raw || typeof raw !== 'object') return null
  const s = raw as Record<string, unknown>
  const steps: BuddyStep[] = (Array.isArray(s.steps) ? s.steps : [])
    .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
    .slice(0, 12)
    .map((x) => {
      const step: BuddyStep = {}
      if (typeof x.say === 'string' && x.say.trim()) step.say = x.say.trim().slice(0, 300)
      if (EXPRESSIONS.includes(x.expression as ExpressionName)) step.expression = x.expression as ExpressionName
      if (typeof x.gesture === 'string' && (x.gesture === 'none' || CLIP_LIBRARY[x.gesture])) step.gesture = x.gesture
      else if (x.gesture && typeof x.gesture === 'object') step.gesture = normalizeClip(x.gesture) ?? undefined
      if (EAR_MOTIONS.includes(x.ears as (typeof EAR_MOTIONS)[number])) step.ears = x.ears as BuddyStep['ears']
      if (typeof x.look === 'string' && x.look in LOOK_TARGETS) step.look = x.look as BuddyStep['look']
      else if (x.look && typeof x.look === 'object') {
        const l = x.look as Record<string, unknown>
        step.look = { x: Number(l.x) || 0, y: Number(l.y) || 0 }
      }
      if (x.pose) step.pose = normalizePose(x.pose)
      if (typeof x.hold === 'number') step.hold = Math.max(0, Math.min(15_000, x.hold))
      return step
    })
  if (steps.length === 0) return null
  return {
    version: 1,
    steps,
    idle: EXPRESSIONS.includes(s.idle as ExpressionName) ? (s.idle as ExpressionName) : undefined,
    suggestions: Array.isArray(s.suggestions) ? s.suggestions.filter((x): x is string => typeof x === 'string').slice(0, 4) : [],
  }
}

// ---------------------------------------------------------------- sampling

function easeFn(ease: Ease | undefined, x: number) {
  switch (ease) {
    case 'linear':
      return x
    case 'easeIn':
      return x * x * x
    case 'easeOut':
      return 1 - (1 - x) ** 3
    case 'back': {
      const c1 = 1.70158
      const c3 = c1 + 1
      return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2
    }
    default:
      return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2
  }
}

const lerp = (a: number, b: number, f: number) => a + (b - a) * f
const smooth = (x: number) => {
  const c = Math.min(1, Math.max(0, x))
  return c * c * (3 - 2 * c)
}

type Track = Array<{ t: number; v: number | string; ease?: Ease }>
const trackCache = new WeakMap<Clip, Map<Channel, Track>>()

function tracksOf(clip: Clip) {
  let tracks = trackCache.get(clip)
  if (!tracks) {
    tracks = new Map()
    for (const kf of clip.keyframes) {
      for (const [ch, v] of Object.entries(kf.pose) as Array<[Channel, number | string]>) {
        if (!tracks.has(ch)) tracks.set(ch, [])
        tracks.get(ch)!.push({ t: kf.t, v, ease: kf.ease })
      }
    }
    trackCache.set(clip, tracks)
  }
  return tracks
}

/**
 * Applies a clip at local time `t` onto `pose` with weight `w`. A channel whose
 * first keyframe is after 0 starts from the pose it found (implicit keyframe).
 */
function applyClip(pose: Pose, clip: Clip, t: number, w: number, wIn: number) {
  const target = pose as Record<Channel, number | string>
  for (const [ch, track] of tracksOf(clip)) {
    const base = target[ch]
    let value: number | string
    let weight = w
    if (typeof track[0].v === 'number') {
      const b = base as number
      if (t <= track[0].t) {
        if (track[0].t === 0) {
          value = track[0].v
          weight *= wIn
        } else value = lerp(b, track[0].v as number, easeFn(track[0].ease, t / track[0].t))
      } else {
        let i = track.length - 1
        while (i > 0 && track[i].t > t) i--
        const a = track[i]
        const n = track[i + 1]
        value = n ? lerp(a.v as number, n.v as number, easeFn(n.ease, (t - a.t) / Math.max(1, n.t - a.t))) : a.v
      }
      target[ch] = lerp(b, value as number, weight)
    } else {
      let i = track.length - 1
      while (i >= 0 && track[i].t > t) i--
      if (i >= 0 && weight > 0.5) target[ch] = track[i].v
    }
  }
}

type Layer = { id: string; clip: Clip; start: number; stopAt?: number }

export type BuddyCaption = { text: string; start: number; msPerChar: number }

export type BuddyFrame = {
  pose: Pose
  /** 0 = eyes open, 1 = shut (procedural blink). */
  blink: number
  caption: { full: string; visible: string; speaking: boolean } | null
}

const MS_PER_CHAR = 46
let layerSeq = 0

export class BuddyDirector {
  private layers: Layer[] = []
  private exprFrom: PartialPose = {}
  private exprTo: PartialPose = EXPRESSION_LIBRARY.neutral
  private exprStart = 0
  private exprName: ExpressionName = 'neutral'
  private caption: BuddyCaption | null = null
  private voiceLevel: (() => number) | null = null
  private nextBlink = 1500
  private blinkStart = -1
  private scriptToken = 0

  get expression() {
    return this.exprName
  }

  setExpression(name: ExpressionName, now = performance.now()) {
    this.exprFrom = this.sampleExpression(now)
    this.exprTo = EXPRESSION_LIBRARY[name] ?? EXPRESSION_LIBRARY.neutral
    this.exprStart = now
    this.exprName = name
  }

  /** Starts a gesture / ear clip (library name or inline). Returns the layer id. */
  play(gesture: string | Clip, opts: { id?: string; loop?: boolean } = {}, now = performance.now()) {
    const clip = typeof gesture === 'string' ? CLIP_LIBRARY[gesture] : gesture
    if (!clip) return null
    const id = opts.id ?? `layer-${++layerSeq}`
    // A replaced layer fades out under the new one instead of snapping away.
    for (const l of this.layers) {
      if (l.id !== id) continue
      l.id = `${id}~${++layerSeq}`
      if (l.stopAt === undefined) l.stopAt = now
    }
    this.layers.push({ id, clip: opts.loop === undefined ? clip : { ...clip, loop: opts.loop }, start: now })
    return id
  }

  stop(id: string, now = performance.now()) {
    for (const l of this.layers) if (l.id === id && l.stopAt === undefined) l.stopAt = now
  }

  stopAll(now = performance.now()) {
    for (const l of this.layers) if (l.stopAt === undefined) l.stopAt = now
  }

  say(text: string, now = performance.now()) {
    this.voiceLevel = null
    this.caption = text ? { text, start: now, msPerChar: MS_PER_CHAR } : null
    return text.length * MS_PER_CHAR
  }

  /** Cancels a running script (its pending steps never start). */
  cancelScript() {
    this.scriptToken++
    this.voiceLevel = null
    for (const id of ['step-gesture', 'step-ears', 'step-pose']) this.stop(id)
  }

  async runScript(
    script: BuddyScript,
    onStep?: (index: number, step: BuddyStep) => void,
    playVoice?: (text: string, start: (readLevel: () => number) => void) => Promise<void>,
  ) {
    const token = ++this.scriptToken
    for (const [i, step] of script.steps.entries()) {
      if (token !== this.scriptToken) return false
      let started = false
      const start = (readLevel?: () => number) => {
        if (token !== this.scriptToken) return 0
        started = true
        onStep?.(i, step)
        const wait = this.startStep(step)
        if (step.say && readLevel) {
          this.caption = { text: step.say, start: performance.now(), msPerChar: MS_PER_CHAR }
          this.voiceLevel = readLevel
        }
        return wait
      }
      if (step.say && playVoice) {
        try {
          await playVoice(step.say, start)
        } catch {
          if (token !== this.scriptToken) return false
          // The text version is still usable if audio is interrupted by a service error.
          if (!started) await new Promise((resolve) => setTimeout(resolve, start()))
          playVoice = undefined
        }
      } else {
        await new Promise((resolve) => setTimeout(resolve, start()))
      }
      if (token !== this.scriptToken) return false
      if (this.voiceLevel && this.caption) {
        this.caption.start = performance.now() - (this.caption.text.length + 1) * MS_PER_CHAR
      }
      this.voiceLevel = null
      this.stop('step-gesture')
    }
    this.stop('step-pose')
    this.setExpression(script.idle ?? 'listening')
    return true
  }

  private startStep(step: BuddyStep) {
    const now = performance.now()
    if (step.expression) this.setExpression(step.expression, now)
    let wait = 700
    const gesture = step.gesture && step.gesture !== 'none' ? step.gesture : null
    const gestureClip = typeof gesture === 'string' ? CLIP_LIBRARY[gesture] : gesture
    if (gestureClip) {
      const loops = gestureClip.loop
      this.play(gestureClip, { id: 'step-gesture' }, now)
      if (!loops) wait = Math.max(wait, gestureClip.duration)
    }
    if (step.ears && step.ears !== 'none') {
      const ears = CLIP_LIBRARY[`ears_${step.ears}`]
      if (ears) {
        this.play(ears, { id: 'step-ears' }, now)
        wait = Math.max(wait, ears.duration)
      }
    }
    const held: PartialPose = { ...(step.pose ?? {}) }
    if (step.look) {
      const look = typeof step.look === 'string' ? LOOK_TARGETS[step.look] : step.look
      if (look && (look.x !== 0 || look.y !== 0 || typeof step.look !== 'string')) {
        held['face.lookX'] = look.x
        held['face.lookY'] = look.y
      }
    }
    if (Object.keys(held).length > 0) {
      this.play({ duration: 1, loop: true, keyframes: [{ t: 0, pose: held }] }, { id: 'step-pose' }, now)
    } else this.stop('step-pose', now)
    if (step.say) {
      const typing = this.say(step.say, now)
      wait = Math.max(wait, typing + 700 + Math.min(step.say.length * 14, 1400))
    }
    if (step.hold) wait = Math.max(wait, step.hold)
    return wait
  }

  private sampleExpression(now: number): PartialPose {
    const f = smooth((now - this.exprStart) / 380)
    const out: PartialPose = {}
    for (const ch of EXPRESSION_CHANNELS) {
      const to = this.exprTo[ch] ?? NEUTRAL_POSE[ch]
      const from = this.exprFrom[ch] ?? to
      out[ch] = typeof to === 'number' ? lerp(from as number, to, f) : f > 0.35 ? to : from
    }
    return out
  }

  sample(now = performance.now()): BuddyFrame {
    const pose: Pose = { ...NEUTRAL_POSE, ...(this.sampleExpression(now) as Partial<Pose>) }

    this.layers = this.layers.filter((l) => {
      const blendOut = l.clip.blendOut ?? 350
      const end = l.stopAt ?? (l.clip.loop ? Infinity : l.start + l.clip.duration)
      return now < end + blendOut
    })
    for (const l of this.layers) {
      const blendIn = l.clip.blendIn ?? 250
      const blendOut = l.clip.blendOut ?? 350
      const elapsed = now - l.start
      const local = l.clip.loop ? elapsed % l.clip.duration : Math.min(elapsed, l.clip.duration)
      const end = l.stopAt ?? (l.clip.loop ? Infinity : l.start + l.clip.duration)
      const wOut = now > end ? 1 - smooth((now - end) / blendOut) : 1
      const wIn = blendIn > 0 ? smooth(elapsed / blendIn) : 1
      applyClip(pose, l.clip, local, wOut, wIn)
    }

    // Procedural idle: always on, small enough to sit on top of any gesture.
    const s = now / 1000
    const wave = (period: number, phase = 0) => Math.sin((2 * Math.PI * s) / period + phase)
    pose['body.bob'] += wave(3.4) * 2.2
    pose['head.tilt'] += wave(4.1) * 1.6
    pose['ears.left'] += wave(2.6) * 3.5
    pose['ears.right'] += wave(2.6, 1.7) * 3.5
    pose['antenna.bend'] += wave(2.1, 0.6) * 5
    pose['armLeft.shoulder'] += wave(3.4, 0.5) * 1.5
    pose['armRight.shoulder'] += wave(3.4, 0.9) * 1.5
    pose['face.glow'] *= 0.78 + 0.22 * wave(2.2)

    // Blink every 2.5-5 s.
    if (this.blinkStart < 0 && now >= this.nextBlink) this.blinkStart = now
    let blink = 0
    if (this.blinkStart >= 0) {
      const p = (now - this.blinkStart) / 160
      if (p >= 1) {
        this.blinkStart = -1
        this.nextBlink = now + 2500 + Math.random() * 2500
      } else blink = 1 - Math.abs(1 - 2 * p)
    }

    let caption: BuddyFrame['caption'] = null
    if (this.caption && this.voiceLevel) {
      caption = { full: this.caption.text, visible: this.caption.text, speaking: false }
      pose['face.mouthOpen'] = this.voiceLevel()
    } else if (this.caption) {
      const { text, start, msPerChar } = this.caption
      const count = Math.min(text.length, Math.max(0, Math.floor((now - start) / msPerChar)))
      const speaking = count < text.length
      caption = { full: text, visible: text.slice(0, count), speaking }
      if (speaking) {
        const last = text[count - 1] ?? ''
        const pause = /[,.!?…;:]/.test(last)
        const flap = Math.abs(Math.sin(s * 19)) * 0.7 + Math.abs(Math.sin(s * 7.3)) * 0.3
        pose['face.mouthOpen'] = pause ? 0.05 : 0.25 + 0.75 * flap
      }
    }

    return { pose, blink, caption }
  }
}

/** Re-renders every animation frame with the director's current frame. */
export function useBuddyFrame(director: BuddyDirector) {
  const [frame, setFrame] = useState<BuddyFrame>(() => director.sample())
  const raf = useRef(0)
  useEffect(() => {
    const tick = () => {
      setFrame(director.sample())
      raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
  }, [director])
  return frame
}
