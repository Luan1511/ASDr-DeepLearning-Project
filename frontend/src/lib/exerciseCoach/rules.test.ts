import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CUE_GAP_MS,
  CoachPacer,
  LIVE_LIMITS,
  LiveRules,
  PRAISE_GAP_MS,
  CUE_TEXT,
  PROFILE_CUE,
  PROFILE_CUES,
  outOfFrame,
  measurePose,
  twistRelation,
  type CoachEvent,
  type Landmark,
  type PoseMeasure,
} from './rules'

// ---------------------------------------------------------------------------
// Synthetic input
// ---------------------------------------------------------------------------

const WIDTH = 640
const HEIGHT = 480
const STEP_MS = 100

/** A facing person in MediaPipe layout; positions are fractions of the picture. */
function person(over: Partial<Record<number, Partial<Landmark>>> = {}): Landmark[] {
  const points: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.99 }))
  const set = (id: number, x: number, y: number) => {
    points[id] = { x, y, visibility: 0.99 }
  }
  set(11, 0.58, 0.3) // left shoulder (the person's left is on the picture's right)
  set(12, 0.42, 0.3)
  set(15, 0.6, 0.52) // wrists hanging
  set(16, 0.4, 0.52)
  set(23, 0.54, 0.5) // hips
  set(24, 0.46, 0.5)
  set(25, 0.54, 0.65) // knees
  set(26, 0.46, 0.65)
  set(27, 0.54, 0.8) // ankles
  set(28, 0.46, 0.8)
  for (const [id, change] of Object.entries(over)) points[Number(id)] = { ...points[Number(id)], ...change }
  return points
}

const standing: PoseMeasure = {
  armLift: -1,
  armX: 0,
  kneeX: 0,
  feetWidth: 0.3,
  hipWidth: 0.35,
  legLeft: 1.4,
  legRight: 1.4,
}

/** Runs `frames` through fresh or given rules at 10 Hz and collects the events with their frame index. */
function run(rules: LiveRules, frames: Array<PoseMeasure | null>, startMs = 0) {
  const events: Array<{ at: number; event: NonNullable<CoachEvent> }> = []
  frames.forEach((pose, i) => {
    const event = rules.update(pose, startMs + i * STEP_MS)
    if (event) events.push({ at: i, event })
  })
  return events
}

const kinds = (events: ReturnType<typeof run>) => events.map(({ event }) => (event.kind === 'cue' ? event.cue : 'praise'))
const still = (count: number, pose: PoseMeasure = standing) => Array.from({ length: count }, () => pose)

// ---------------------------------------------------------------------------
// measurePose
// ---------------------------------------------------------------------------

describe('measurePose', () => {
  it('measures a standing person in torso lengths', () => {
    const pose = measurePose(person(), WIDTH, HEIGHT)
    expect(pose).not.toBeNull()
    // torso = 0.2 of the picture height = 96 px
    expect(pose!.armLift).toBeCloseTo(-1.1, 5)
    expect(pose!.feetWidth).toBeCloseTo((0.08 * WIDTH) / 96, 5)
    expect(pose!.hipWidth).toBeCloseTo((0.08 * WIDTH) / 96, 5)
    expect(pose!.legLeft).toBeCloseTo(1.5, 5)
    expect(pose!.legRight).toBeCloseTo(1.5, 5)
    expect(pose!.armX).toBeCloseTo(0, 5)
    expect(pose!.kneeX).toBeCloseTo(0, 5)
  })

  it('reads raised arms, a lifted leg and a sideways swing with the right sign', () => {
    const pose = measurePose(
      person({
        15: { y: 0.1 },
        16: { y: 0.12 },
        28: { y: 0.7 }, // right ankle lifted
        25: { x: 0.58 },
        26: { x: 0.5 }, // both knees to the picture's right
      }),
      WIDTH,
      HEIGHT,
    )
    expect(pose!.armLift).toBeCloseTo((0.3 - 0.12) / 0.2, 5) // the lower of the two wrists
    expect(pose!.legRight).toBeLessThan(pose!.legLeft)
    expect(pose!.kneeX).toBeGreaterThan(0)
  })

  it('does not judge a frame with a hidden joint, a joint at the edge, a tiny or a sideways person', () => {
    expect(measurePose(person({ 27: { visibility: 0.4 } }), WIDTH, HEIGHT)).toBeNull()
    expect(measurePose(person({ 15: { y: 0.01 } }), WIDTH, HEIGHT)).toBeNull()
    expect(measurePose(person({ 16: { x: 0.99 } }), WIDTH, HEIGHT)).toBeNull()
    // torso shorter than 9% of the picture height
    expect(measurePose(person({ 23: { y: 0.36 }, 24: { y: 0.36 } }), WIDTH, HEIGHT)).toBeNull()
    // shoulders almost on top of each other: turned sideways
    expect(measurePose(person({ 11: { x: 0.51 }, 12: { x: 0.49 } }), WIDTH, HEIGHT)).toBeNull()
    expect(measurePose([], WIDTH, HEIGHT)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Jumping jacks
// ---------------------------------------------------------------------------

const JACK_LIFTS = [-0.6, -0.1, 0.4, 0.9, 1, 0.9, 0.4, -0.1, -0.6, -1]
/** Frame of a repetition at which the arms are back below the "down" line: the repetition is judged there. */
const JACK_DONE = JACK_LIFTS.findIndex((lift, i) => i > 4 && lift < LIVE_LIMITS.jacks.armDown)

/** One repetition: arms up and down over 1 s; the feet reach `openTo` at the top. */
function jack(openTo: number, closed = 0.3): PoseMeasure[] {
  const lifts = JACK_LIFTS
  return lifts.map((armLift) => {
    const phase = (armLift + 1) / 2
    return { ...standing, armLift, feetWidth: closed + (openTo - closed) * phase }
  })
}

describe('LiveRules: jumping jacks', () => {
  it('praises after three repetitions with the feet opening, and never reminds', () => {
    const rules = new LiveRules('jumping-jacks')
    const events = run(rules, [...still(5), ...jack(1), ...jack(1), ...jack(1), ...jack(1)])
    expect(kinds(events)).toEqual(['praise'])
    // The praise comes with the third completed repetition.
    expect(events[0].at).toBe(5 + 2 * 10 + JACK_DONE)
  })

  it('reminds to open the feet once two repetitions in a row kept them closed', () => {
    const rules = new LiveRules('jumping-jacks')
    const events = run(rules, [...still(5), ...jack(0.3), ...jack(0.3)])
    expect(kinds(events)).toEqual(['open'])
    expect(events[0].at).toBe(5 + 10 + JACK_DONE)
  })

  it('does not remind after a single closed repetition between good ones', () => {
    const rules = new LiveRules('jumping-jacks')
    expect(kinds(run(rules, [...still(5), ...jack(1), ...jack(0.3), ...jack(1), ...jack(0.3), ...jack(1)]))).toEqual([])
  })

  it('counts a small but visible opening as opened, like the post-session report', () => {
    const margin = LIVE_LIMITS.jacks.openMargin
    const opened = new LiveRules('jumping-jacks')
    expect(kinds(run(opened, [...still(5), ...jack(0.3 + margin + 0.02), ...jack(0.3 + margin + 0.02)]))).toEqual([])
    const closed = new LiveRules('jumping-jacks')
    expect(kinds(run(closed, [...still(5), ...jack(0.3 + margin - 0.02), ...jack(0.3 + margin - 0.02)]))).toEqual(['open'])
  })

  it('says nothing when the child never stood with the feet together', () => {
    const wide: PoseMeasure = { ...standing, feetWidth: 0.9 }
    const rules = new LiveRules('jumping-jacks')
    const frames = [...still(5, wide), ...jack(0.9, 0.9), ...jack(0.9, 0.9), ...jack(0.9, 0.9)]
    expect(kinds(run(rules, frames))).toEqual([])
  })

  it('ignores a repetition that was already under way when tracking started', () => {
    const rules = new LiveRules('jumping-jacks')
    // Starts with the arms up: that half repetition is not judged, the next two are.
    const events = run(rules, [...jack(0.3).slice(4), ...jack(0.3), ...jack(0.3)])
    expect(kinds(events)).toEqual(['open'])
    expect(events[0].at).toBe(6 + 10 + JACK_DONE)
  })

  it('starts counting again after the child left the picture', () => {
    const rules = new LiveRules('jumping-jacks')
    const gap: null[] = Array.from({ length: 6 }, () => null) // 600 ms without a clear person
    expect(kinds(run(rules, [...still(5), ...jack(0.3), ...gap, ...still(3), ...jack(0.3)]))).toEqual([])
  })

  it('keeps its counters over a single dropped frame', () => {
    const rules = new LiveRules('jumping-jacks')
    expect(kinds(run(rules, [...still(5), ...jack(0.3), null, ...still(2), ...jack(0.3)]))).toEqual(['open'])
  })
})

// ---------------------------------------------------------------------------
// High kicks
// ---------------------------------------------------------------------------

/** One kick: the given leg gets shorter by `rise` for `frames` frames, then stands again. */
function kick(side: 'left' | 'right', rise = 1.2, frames = 4, restFrames = 4): PoseMeasure[] {
  const lifted: PoseMeasure =
    side === 'left' ? { ...standing, legLeft: standing.legLeft - rise } : { ...standing, legRight: standing.legRight - rise }
  return [...Array.from({ length: frames }, () => lifted), ...still(restFrames)]
}

describe('LiveRules: high kicks', () => {
  it('praises after three changes of leg and never reminds', () => {
    const rules = new LiveRules('high-kicks')
    const events = run(rules, [...still(4), ...kick('left'), ...kick('right'), ...kick('left'), ...kick('right')])
    expect(kinds(events)).toEqual(['praise'])
  })

  it('reminds to change leg at the second kick of the same leg', () => {
    const rules = new LiveRules('high-kicks')
    const events = run(rules, [...still(4), ...kick('left'), ...kick('left')])
    expect(kinds(events)).toEqual(['alternate'])
    // Reported when the second kick is back on the floor.
    expect(events[0].at).toBe(4 + 8 + 4)
  })

  it('uses the kick thresholds of the post-session report', () => {
    const small = new LiveRules('high-kicks')
    expect(kinds(run(small, [...still(4), ...kick('left', LIVE_LIMITS.kicks.kick - 0.02), ...kick('left', LIVE_LIMITS.kicks.kick - 0.02)]))).toEqual([])
    const enough = new LiveRules('high-kicks')
    expect(kinds(run(enough, [...still(4), ...kick('left', LIVE_LIMITS.kicks.kick + 0.02), ...kick('left', LIVE_LIMITS.kicks.kick + 0.02)]))).toEqual([
      'alternate',
    ])
  })

  it('does not call it "the same leg again" when a small lift of the other leg came in between', () => {
    const rules = new LiveRules('high-kicks')
    // The right foot leaves the floor a little (below the kick threshold): maybe a low kick.
    const events = run(rules, [...still(4), ...kick('left'), ...kick('right', 0.1), ...kick('left')])
    expect(kinds(events)).toEqual([])
  })

  it('asks to kick higher after two low kicks in a row, whatever the legs', () => {
    const low = LIVE_LIMITS.kicks.lowKick + 0.02
    const rules = new LiveRules('high-kicks')
    const events = run(rules, [...still(4), ...kick('left', low), ...kick('right', low)])
    expect(kinds(events)).toEqual(['higher'])
    expect(events[0].at).toBe(4 + 8 + 4)
  })

  it('asks to kick higher when real kicks, even changing leg, stay under the height', () => {
    const half = (LIVE_LIMITS.kicks.kick + LIVE_LIMITS.kicks.highKick) / 2
    const rules = new LiveRules('high-kicks')
    expect(kinds(run(rules, [...still(4), ...kick('left', half), ...kick('right', half)]))).toEqual(['higher'])
    // High enough kicks changing leg: praise, never "higher".
    const high = new LiveRules('high-kicks')
    const highRise = LIVE_LIMITS.kicks.highKick + 0.05
    expect(kinds(run(high, [...still(4), ...kick('left', highRise), ...kick('right', highRise), ...kick('left', highRise), ...kick('right', highRise)]))).toEqual(['praise'])
  })

  it('reminds to start kicking after standing still, then not again for a while', () => {
    const rules = new LiveRules('high-kicks')
    const events = run(rules, still(190))
    expect(kinds(events)).toEqual(['move', 'move'])
    expect(events.map(({ at }) => at)).toEqual([LIVE_LIMITS.kicks.idleMs / STEP_MS, (LIVE_LIMITS.kicks.idleMs + LIVE_LIMITS.kicks.idleRepeatMs) / STEP_MS])
    // Kicking now and then keeps it quiet.
    const busy = new LiveRules('high-kicks')
    const highRise = LIVE_LIMITS.kicks.highKick + 0.05
    expect(kinds(run(busy, [...still(40), ...kick('left', highRise), ...still(40), ...kick('right', highRise), ...still(40)]))).not.toContain('move')
  })

  it('forgets a low kick after a real kick or a long pause', () => {
    const low = LIVE_LIMITS.kicks.lowKick + 0.02
    const afterKick = new LiveRules('high-kicks')
    expect(kinds(run(afterKick, [...still(4), ...kick('left', low), ...kick('right'), ...kick('left', low)]))).toEqual([])
    const afterPause = new LiveRules('high-kicks')
    expect(kinds(run(afterPause, [...still(4), ...kick('left', low), ...still(45), ...kick('right', low)]))).toEqual([])
  })

  it('takes the demo video as high and its foot shuffles as nothing', () => {
    // Measured on the adult High-Kicks template v2: kicks peak at 2.2-2.8, shuffles at 0.15-0.27.
    expect(LIVE_LIMITS.kicks.highKick).toBeLessThan(2.2)
    expect(LIVE_LIMITS.kicks.lowKick).toBeGreaterThan(0.27)
    const rules = new LiveRules('high-kicks')
    expect(kinds(run(rules, [...still(4), ...kick('left', 2.2), ...kick('right', 0.27), ...kick('right', 2.2), ...kick('left', 0.2)]))).not.toContain('higher')
  })

  it('ignores small shifts below the low-kick height and one-frame lifts', () => {
    const tiny = new LiveRules('high-kicks')
    const shift = LIVE_LIMITS.kicks.lowKick - 0.01
    expect(kinds(run(tiny, [...still(4), ...kick('left', shift), ...kick('right', shift), ...kick('left', shift)]))).toEqual([])
    const blip = new LiveRules('high-kicks')
    const low = LIVE_LIMITS.kicks.lowKick + 0.02
    expect(kinds(run(blip, [...still(4), ...kick('left', low, 1), ...kick('right', low, 1)]))).toEqual([])
  })

  it('does not count a one-frame blip as a kick', () => {
    const rules = new LiveRules('high-kicks')
    expect(kinds(run(rules, [...still(4), ...kick('left', 0.5, 1), ...kick('left', 0.5, 1), ...kick('left', 0.5, 1)]))).toEqual([])
  })

  it('starts a new series after a long pause', () => {
    const rules = new LiveRules('high-kicks')
    expect(kinds(run(rules, [...still(4), ...kick('left'), ...still(45), ...kick('left')]))).toEqual([])
  })

  it('needs a short stand on both feet before a kick counts', () => {
    const rules = new LiveRules('high-kicks')
    // Tracking starts with the leg already in the air: that kick is not counted,
    // so the next one is the first of the series...
    const first = [...kick('left'), ...kick('left')]
    expect(kinds(run(rules, first))).toEqual([])
    // ...and only the one after it is "the same leg again".
    expect(kinds(run(rules, kick('left'), first.length * STEP_MS))).toEqual(['alternate'])
  })

  it('copes with legs that look unequal while standing', () => {
    const uneven: PoseMeasure = { ...standing, legRight: standing.legRight - 0.05 }
    const lift = (side: 'left' | 'right'): PoseMeasure[] => [
      ...Array.from({ length: 4 }, () =>
        side === 'left' ? { ...uneven, legLeft: uneven.legLeft - 0.5 } : { ...uneven, legRight: uneven.legRight - 0.5 },
      ),
      ...still(4, uneven),
    ]
    const rules = new LiveRules('high-kicks')
    expect(kinds(run(rules, [...still(10, uneven), ...lift('right'), ...lift('right')]))).toEqual(['alternate'])
  })

  it('forgets the previous kick when the child left the picture', () => {
    const rules = new LiveRules('high-kicks')
    const gap: null[] = Array.from({ length: 6 }, () => null)
    expect(kinds(run(rules, [...still(4), ...kick('left'), ...gap, ...still(4), ...kick('left')]))).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Jump twists
// ---------------------------------------------------------------------------

/** Arms swing left-right once per second; the knees follow with `kneeGain` (negative = to the other side). */
function twistFrames(seconds: number, kneeGain: number, armAmplitude = 0.3): PoseMeasure[] {
  return Array.from({ length: seconds * 10 }, (_, i) => {
    const swing = Math.sin((2 * Math.PI * i) / 10)
    return { ...standing, armX: armAmplitude * swing, kneeX: armAmplitude * kneeGain * swing }
  })
}

describe('LiveRules: jump twists', () => {
  it('reminds when arms and knees keep swinging to the same side', () => {
    const rules = new LiveRules('jump-twists')
    const events = run(rules, twistFrames(4, 0.5))
    expect(new Set(kinds(events))).toEqual(new Set(['cross']))
    // Not before enough of the movement was seen.
    expect(events[0].at * STEP_MS).toBeGreaterThanOrEqual(LIVE_LIMITS.twists.minSpanMs)
  })

  it('praises sustained opposite swings and never reminds', () => {
    const rules = new LiveRules('jump-twists')
    expect(kinds(run(rules, twistFrames(12, -0.5)))).toEqual(['praise'])
  })

  it('says nothing about a tiny swing or about arms alone', () => {
    expect(kinds(run(new LiveRules('jump-twists'), twistFrames(5, 0.5, 0.05)))).toEqual([])
    expect(kinds(run(new LiveRules('jump-twists'), twistFrames(5, 0)))).toEqual([])
  })

  it('classifies a window of samples', () => {
    const samples = (gain: number) =>
      twistFrames(3, gain).map((pose, i) => ({ arm: pose.armX, knee: pose.kneeX, time: i * STEP_MS }))
    expect(twistRelation(samples(0.5))).toBe('same')
    expect(twistRelation(samples(-0.5))).toBe('opposed')
    expect(twistRelation(samples(0.5).slice(0, 10))).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Pacing
// ---------------------------------------------------------------------------

describe('CoachPacer', () => {
  const cue: CoachEvent = { kind: 'cue', cue: 'open' }
  const praise: CoachEvent = { kind: 'praise' }

  it('lets a reminder through at most once per gap', () => {
    const pacer = new CoachPacer()
    expect(pacer.accept(cue, 1000)).toEqual(cue)
    expect(pacer.accept(cue, 1000 + CUE_GAP_MS - 1)).toBeNull()
    expect(pacer.accept(cue, 1000 + CUE_GAP_MS)).toEqual(cue)
  })

  it('holds a praise back shortly after anything else was said', () => {
    const pacer = new CoachPacer()
    expect(pacer.accept(praise, 0)).toEqual(praise)
    expect(pacer.accept(praise, PRAISE_GAP_MS - 1)).toBeNull()
    expect(pacer.accept(cue, 2000)).toEqual(cue)
    expect(pacer.accept(praise, 2000 + PRAISE_GAP_MS - 1)).toBeNull()
    expect(pacer.accept(praise, 2000 + PRAISE_GAP_MS)).toEqual(praise)
  })

  it('never delays a reminder because of a praise', () => {
    const pacer = new CoachPacer()
    expect(pacer.accept(praise, 0)).toEqual(praise)
    expect(pacer.accept(cue, 500)).toEqual(cue)
    expect(pacer.accept(null, 600)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Step back into the picture
// ---------------------------------------------------------------------------

describe('step-back reminder', () => {
  it('detects a hidden or cut-off joint but not a turned person', () => {
    expect(outOfFrame(person())).toBe(false)
    expect(outOfFrame(person({ 27: { y: 0.995 } }))).toBe(true)
    expect(outOfFrame(person({ 15: { visibility: 0.3 } }))).toBe(true)
    // Shoulders close together (turned sideways): measurePose rejects it, but it is in the picture.
    expect(outOfFrame(person({ 11: { x: 0.51 }, 12: { x: 0.49 } }))).toBe(false)
  })

  /** Feeds `count` frames at 10 Hz; `cutOff` frames have no measures. */
  function feed(rules: LiveRules, count: number, cutOff: boolean, start: number) {
    const cues: Array<{ at: number; cue: string }> = []
    for (let i = 0; i < count; i++) {
      const time = start + i * STEP_MS
      const event = cutOff ? rules.update(null, time, true) : rules.update(standing, time)
      if (event?.kind === 'cue') cues.push({ at: time, cue: event.cue })
    }
    return cues
  }

  it('asks once after two seconds cut off, and not again for ten seconds', () => {
    const rules = new LiveRules('high-kicks')
    const first = feed(rules, 50, true, 0)
    expect(first).toEqual([{ at: LIVE_LIMITS.frameMs, cue: 'frame' }])
    const later = feed(rules, 100, true, 5000)
    expect(later).toEqual([{ at: LIVE_LIMITS.frameMs + LIVE_LIMITS.frameRepeatMs, cue: 'frame' }])
  })

  it('says nothing when no single person is seen, or when the child comes back in time', () => {
    const rules = new LiveRules('high-kicks')
    const silent: Array<CoachEvent> = []
    for (let i = 0; i < 40; i++) silent.push(rules.update(null, i * STEP_MS, false))
    expect(silent.filter(Boolean)).toEqual([])
    const back = new LiveRules('high-kicks')
    expect([...feed(back, 15, true, 0), ...feed(back, 2, false, 1500), ...feed(back, 15, true, 1700)]).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Agreement with the post-session detectors
// ---------------------------------------------------------------------------

describe('live rules follow the backend detectors', () => {
  const backend = resolve(process.cwd(), '..', 'backend', 'src', 'services', 'exerciseMovement')
  const available = existsSync(backend)
  const number = (source: string, name: RegExp) => {
    const match = name.exec(source)
    if (!match) throw new Error(`constant not found: ${name}`)
    return Number(match[1])
  }

  it('gives each movement profile its one reminder', () => {
    expect(PROFILE_CUE).toEqual({ 'jump-twists': 'cross', 'jumping-jacks': 'open', 'high-kicks': 'alternate' })
  })

  it('has a voice clip for every reminder a profile can give', () => {
    const clips = resolve(process.cwd(), 'public', 'exercise-coach')
    for (const [profile, cues] of Object.entries(PROFILE_CUES)) {
      expect(cues[0]).toBe(PROFILE_CUE[profile as keyof typeof PROFILE_CUE])
      for (const cue of cues) {
        expect(CUE_TEXT[cue]).toBeTruthy()
        expect(existsSync(resolve(clips, `${cue}.wav`)), `${cue}.wav`).toBe(true)
      }
    }
  })

  // If one of these fails, a backend threshold moved: revisit LIVE_LIMITS so the
  // reminder during practice still agrees with the report after it.
  it.skipIf(!available)('kick thresholds equal kicks.js', () => {
    const source = readFileSync(resolve(backend, 'kicks.js'), 'utf8')
    expect(LIVE_LIMITS.kicks.rest).toBe(number(source, /REST_RISE = ([\d.]+)/))
    expect(LIVE_LIMITS.kicks.kick).toBe(number(source, /KICK_RISE = ([\d.]+)/))
    expect(LIVE_LIMITS.kicks.adjacencyMs).toBe(1000 * number(source, /time - restStart > (\d+)/))
  })

  it.skipIf(!available)('jumping-jack limits are never stricter than jacks.js', () => {
    const source = readFileSync(resolve(backend, 'jacks.js'), 'utf8')
    expect(LIVE_LIMITS.jacks.repeats).toBe(number(source, /minRepetitions: (\d+)/))
    // The report calls the opening missing up to closedMargin; the live rule uses a
    // slightly larger margin for the noisier browser tracking, but stays small.
    const closedMargin = number(source, /closedMargin: ([\d.]+)/)
    expect(LIVE_LIMITS.jacks.openMargin).toBeGreaterThanOrEqual(closedMargin)
    expect(LIVE_LIMITS.jacks.openMargin).toBeLessThanOrEqual(2 * closedMargin)
    // The closed stance the report compares with is defined in index.ts (readyFrames).
    expect(readFileSync(resolve(backend, 'index.ts'), 'utf8')).toContain('Math.max(0.4, 1.25 * hips)')
    expect(LIVE_LIMITS.jacks.closedStanceMax).toBe(0.4)
    expect(LIVE_LIMITS.jacks.closedStanceHipRatio).toBe(1.25)
  })

  it.skipIf(!available)('the twist reminder needs a clearer relation than coordination.js', () => {
    const source = readFileSync(resolve(backend, 'coordination.js'), 'utf8')
    expect(LIVE_LIMITS.twists.relation).toBeGreaterThanOrEqual(number(source, /strongRelation: ([\d.]+)/))
  })
})
