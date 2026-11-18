/**
 * Live coaching rules: what "bạn Bin" may say WHILE the child practises.
 *
 * The verdict of an attempt is always the report the backend computes after
 * the session (backend/src/services/exerciseMovement). These rules only watch
 * for the same repeated mistakes early, and are tuned so that a live reminder
 * is never stricter than that report:
 *
 *   'open'      ↔ JACKS_MISSING_FOOT_OPEN        (jacks.js: closedMargin, minRepetitions)
 *   'alternate' ↔ KICK_SAME_LEG_REPEATED         (kicks.js: REST_RISE, KICK_RISE, 4 s adjacency)
 *   'cross'     ↔ ARM_LEG_COORDINATION_INVERTED  (coordination.js: strongRelation)
 *
 * Landmarks come from MediaPipe Pose (33 points, image coordinates, y down).
 * Every measure is divided by the shoulder–hip height, the same "torso" unit
 * the backend uses. This module has no runtime imports so it can be unit
 * tested without a browser (rules.test.ts).
 */
import type { MovementProfile } from '../exerciseTypes'

/** One pose landmark as MediaPipe gives it (normalised image coordinates). */
export type Landmark = { x: number; y: number; visibility?: number }

export const CUE_TEXT = {
  cross: 'Con thử đưa tay này cùng chân bên kia nhé!',
  open: 'Khi nâng tay, con thử mở hai chân nhé!',
  alternate: 'Lượt tới con thử đổi chân nhé!',
} as const
export type Cue = keyof typeof CUE_TEXT

/** Shown (never spoken) after a few correct repetitions in a row. */
export const PRAISE_TEXT = ['Đúng rồi, con làm tốt lắm!', 'Tuyệt quá, cứ thế nhé!', 'Con giỏi lắm!'] as const

export type CoachEvent = { kind: 'cue'; cue: Cue } | { kind: 'praise' } | null

/** The one reminder each movement profile can give. */
export const PROFILE_CUE: Record<MovementProfile, Cue> = {
  'jump-twists': 'cross',
  'jumping-jacks': 'open',
  'high-kicks': 'alternate',
}

export const LIVE_LIMITS = {
  /** Tracking lost for this long: forget everything counted so far. */
  lostMs: 450,
  /** Correct repetitions in a row before a praise. */
  praiseAfter: 3,
  jacks: {
    /** Wrists this far above / below the shoulders: arms raised / arms back down. */
    armUp: 0.25,
    armDown: -0.35,
    /** The feet count as opened when they got this much wider than the closed stance. */
    openMargin: 0.1,
    /** A stance is "closed" when the ankles are no wider than max(this, ratio × hip width) — as in jacks.js. */
    closedStanceMax: 0.4,
    closedStanceHipRatio: 1.25,
    /** Repetitions in a row without opening before the reminder (jacks.js minRepetitions). */
    repeats: 2,
  },
  kicks: {
    /** Difference of the two leg heights: at most `rest` = standing, at least `kick` = a kick (kicks.js). */
    rest: 0.07,
    kick: 0.14,
    minKickMs: 180,
    readyMs: 120,
    /** A longer pause between two kicks starts a new series (kicks.js: 4 s). */
    adjacencyMs: 4000,
  },
  twists: {
    windowMs: 2600,
    minSpanMs: 1700,
    minSamples: 18,
    armDeadband: 0.1,
    minReversals: 3,
    armRms: 0.11,
    kneeRms: 0.045,
    /** |correlation| of arm and knee swing that counts as clearly together / clearly opposed. */
    relation: 0.65,
    praiseEveryMs: 3000,
  },
} as const

/** Body measures of one frame, in torso lengths. */
export type PoseMeasure = {
  /** Height of the lower wrist above its shoulder (negative = hands down). */
  armLift: number
  /** Horizontal offset of the wrists from the shoulders (twist signal). */
  armX: number
  /** Horizontal offset of the knees from the hips (twist signal). */
  kneeX: number
  /** Distance between the ankles. */
  feetWidth: number
  /** Distance between the hips. */
  hipWidth: number
  /** Hip-to-ankle height of each leg; it shrinks when that leg is lifted. */
  legLeft: number
  legRight: number
}

const LEFT_SHOULDER = 11
const RIGHT_SHOULDER = 12
const LEFT_WRIST = 15
const RIGHT_WRIST = 16
const LEFT_HIP = 23
const RIGHT_HIP = 24
const LEFT_KNEE = 25
const RIGHT_KNEE = 26
const LEFT_ANKLE = 27
const RIGHT_ANKLE = 28
const REQUIRED = [
  LEFT_SHOULDER,
  RIGHT_SHOULDER,
  LEFT_WRIST,
  RIGHT_WRIST,
  LEFT_HIP,
  RIGHT_HIP,
  LEFT_KNEE,
  RIGHT_KNEE,
  LEFT_ANKLE,
  RIGHT_ANKLE,
]
const MIN_VISIBILITY = 0.65
const FRAME_MARGIN = 0.02

/**
 * Measures of one detected person, or null when the rules must not judge this
 * frame: a needed joint is hidden or at the picture edge, the person is too
 * small, or is not facing the camera.
 */
export function measurePose(points: Landmark[], width: number, height: number): PoseMeasure | null {
  for (const id of REQUIRED) {
    const point = points[id]
    if (!point || (point.visibility ?? 0) < MIN_VISIBILITY) return null
    const inside = point.x > FRAME_MARGIN && point.x < 1 - FRAME_MARGIN && point.y > FRAME_MARGIN && point.y < 1 - FRAME_MARGIN
    if (!inside) return null
  }
  const x = (id: number) => points[id].x * width
  const y = (id: number) => points[id].y * height
  const torso = (y(LEFT_HIP) + y(RIGHT_HIP) - y(LEFT_SHOULDER) - y(RIGHT_SHOULDER)) / 2
  if (torso < height * 0.09 || Math.abs(x(LEFT_SHOULDER) - x(RIGHT_SHOULDER)) < torso * 0.35) return null
  return {
    armLift: Math.min(y(LEFT_SHOULDER) - y(LEFT_WRIST), y(RIGHT_SHOULDER) - y(RIGHT_WRIST)) / torso,
    armX: (x(LEFT_WRIST) + x(RIGHT_WRIST) - x(LEFT_SHOULDER) - x(RIGHT_SHOULDER)) / (2 * torso),
    kneeX: (x(LEFT_KNEE) + x(RIGHT_KNEE) - x(LEFT_HIP) - x(RIGHT_HIP)) / (2 * torso),
    feetWidth: Math.abs(x(LEFT_ANKLE) - x(RIGHT_ANKLE)) / torso,
    hipWidth: Math.abs(x(LEFT_HIP) - x(RIGHT_HIP)) / torso,
    legLeft: (y(LEFT_ANKLE) - y(LEFT_HIP)) / torso,
    legRight: (y(RIGHT_ANKLE) - y(RIGHT_HIP)) / torso,
  }
}

type TwistSample = { arm: number; knee: number; time: number }
type Side = 'left' | 'right'

/** 'same' = arms and knees swing to the same side, 'opposed' = to opposite sides, null = not enough clear motion. */
export function twistRelation(samples: TwistSample[]): 'same' | 'opposed' | null {
  const L = LIVE_LIMITS.twists
  const n = samples.length
  if (n < L.minSamples || samples[n - 1].time - samples[0].time < L.minSpanMs) return null
  const meanArm = samples.reduce((sum, row) => sum + row.arm, 0) / n
  const meanKnee = samples.reduce((sum, row) => sum + row.knee, 0) / n
  let armSquares = 0
  let kneeSquares = 0
  let product = 0
  let reversals = 0
  let direction = 0
  for (const row of samples) {
    const arm = row.arm - meanArm
    const knee = row.knee - meanKnee
    armSquares += arm * arm
    kneeSquares += knee * knee
    product += arm * knee
    if (Math.abs(arm) > L.armDeadband && Math.sign(arm) !== direction) {
      if (direction) reversals += 1
      direction = Math.sign(arm)
    }
  }
  if (reversals < L.minReversals || armSquares / n < L.armRms ** 2 || kneeSquares / n < L.kneeRms ** 2) return null
  const correlation = product / Math.sqrt(armSquares * kneeSquares)
  if (correlation >= L.relation) return 'same'
  if (correlation <= -L.relation) return 'opposed'
  return null
}

/**
 * Streaming detector of one movement profile. Feed it every analysed frame
 * (null when no single clear person was seen); it answers with a reminder
 * when a mistake REPEATED, or a praise after a few correct repetitions.
 */
export class LiveRules {
  private readonly profile: MovementProfile
  private lastSeen = -Infinity
  private missingSince: number | null = null
  private goodStreak = 0

  // jumping jacks
  private armsWereDown = false
  private raised = false
  private repMaxFeet = -Infinity
  private closedWidth: number | null = null
  private missedOpens = 0

  // high kicks
  private legOffset = 0
  private restSince: number | null = null
  private ready = false
  private departed = false
  private active: { side: Side; start: number; samples: number } | null = null
  private previousKick: { side: Side; end: number } | null = null

  // jump twists
  private twists: TwistSample[] = []
  private lastTwistPraise = -Infinity

  constructor(profile: MovementProfile) {
    this.profile = profile
  }

  update(pose: PoseMeasure | null, time: number): CoachEvent {
    if (!pose) {
      this.missingSince ??= time
      if (time - this.missingSince >= LIVE_LIMITS.lostMs) this.reset()
      return null
    }
    if (time - this.lastSeen >= LIVE_LIMITS.lostMs) this.reset()
    this.missingSince = null
    this.lastSeen = time

    if (this.profile === 'jumping-jacks') return this.jacks(pose)
    if (this.profile === 'high-kicks') return this.kicks(pose, time)
    return this.twist(pose, time)
  }

  private good(): CoachEvent {
    this.goodStreak += 1
    if (this.goodStreak < LIVE_LIMITS.praiseAfter) return null
    this.goodStreak = 0
    return { kind: 'praise' }
  }

  private jacks(pose: PoseMeasure): CoachEvent {
    const L = LIVE_LIMITS.jacks
    const armsDown = pose.armLift < L.armDown

    if (armsDown && !this.raised) {
      // Standing between repetitions: remember the narrowest closed stance and
      // start the next repetition with a clean slate.
      const closedLimit = Math.max(L.closedStanceMax, L.closedStanceHipRatio * pose.hipWidth)
      if (pose.feetWidth <= closedLimit) this.closedWidth = Math.min(this.closedWidth ?? Infinity, pose.feetWidth)
      this.repMaxFeet = -Infinity
      this.armsWereDown = true
      return null
    }

    this.repMaxFeet = Math.max(this.repMaxFeet, pose.feetWidth)
    if (pose.armLift > L.armUp) this.raised = true
    if (!armsDown) return null

    // The arms just came back down: one repetition ended.
    this.raised = false
    const complete = this.armsWereDown
    const widest = this.repMaxFeet
    this.repMaxFeet = -Infinity
    this.armsWereDown = true
    // Without a closed stance to compare with (or when the repetition was
    // already under way when tracking started) nothing can be said.
    if (!complete || this.closedWidth === null) return null

    if (widest >= this.closedWidth + L.openMargin) {
      this.missedOpens = 0
      return this.good()
    }
    this.goodStreak = 0
    this.missedOpens += 1
    return this.missedOpens >= L.repeats ? { kind: 'cue', cue: 'open' } : null
  }

  private kicks(pose: PoseMeasure, time: number): CoachEvent {
    const L = LIVE_LIMITS.kicks
    // Positive when the RIGHT leg is the shorter (lifted) one. A constant
    // difference of the two standing legs (stance, camera angle) is removed.
    const raw = pose.legLeft - pose.legRight
    const difference = raw - this.legOffset
    const elevation = Math.abs(difference)

    if (elevation <= L.rest) {
      this.legOffset += 0.2 * (raw - this.legOffset)
      let event: CoachEvent = null
      if (this.active) {
        const kick = this.active
        this.active = null
        if (time - kick.start >= L.minKickMs && kick.samples >= 2) event = this.kickDone(kick.side, kick.start, time)
        else this.previousKick = null
        this.ready = false
        this.restSince = null
      } else if (this.departed) {
        // A visible but unresolved lift may have been a kick of the other leg:
        // the next kick is not "the same leg again".
        this.previousKick = null
        this.ready = false
        this.restSince = null
      }
      this.departed = false
      this.restSince ??= time
      if (time - this.restSince >= L.readyMs) this.ready = true
      return event
    }

    const side: Side = difference > 0 ? 'right' : 'left'
    this.departed = true
    this.restSince = null
    if (this.active && this.active.side !== side) {
      this.active = null
      this.ready = false
      this.previousKick = null
      return null
    }
    if (!this.active && this.ready && elevation >= L.kick) this.active = { side, start: time, samples: 0 }
    if (this.active) this.active.samples += 1
    // A lasting small difference that is not a kick (one foot a little forward,
    // a tilted camera) is slowly taken as the standing stance.
    else if (elevation < L.kick) this.legOffset += 0.05 * (raw - this.legOffset)
    return null
  }

  private kickDone(side: Side, start: number, end: number): CoachEvent {
    const previous = this.previousKick
    this.previousKick = { side, end }
    if (!previous || start - previous.end > LIVE_LIMITS.kicks.adjacencyMs) return null
    if (previous.side === side) {
      this.goodStreak = 0
      return { kind: 'cue', cue: 'alternate' }
    }
    return this.good()
  }

  private twist(pose: PoseMeasure, time: number): CoachEvent {
    const L = LIVE_LIMITS.twists
    this.twists.push({ arm: pose.armX, knee: pose.kneeX, time })
    while (time - this.twists[0].time > L.windowMs) this.twists.shift()
    const relation = twistRelation(this.twists)
    if (relation === 'same') return { kind: 'cue', cue: 'cross' }
    if (relation === 'opposed' && time - this.lastTwistPraise >= L.praiseEveryMs) {
      this.lastTwistPraise = time
      return this.good()
    }
    return null
  }

  private reset() {
    this.goodStreak = 0
    this.armsWereDown = false
    this.raised = false
    this.repMaxFeet = -Infinity
    this.closedWidth = null
    this.missedOpens = 0
    this.legOffset = 0
    this.restSince = null
    this.ready = false
    this.departed = false
    this.active = null
    this.previousKick = null
    this.twists = []
    this.lastTwistPraise = -Infinity
  }
}

export const CUE_GAP_MS = 6500
export const PRAISE_GAP_MS = 9000

/**
 * Keeps the coach quiet: at most one reminder every CUE_GAP_MS, and a praise
 * only when nothing else was said for PRAISE_GAP_MS.
 */
export class CoachPacer {
  private lastCue = -Infinity
  private lastMessage = -Infinity

  /** The event when it may be shown now, otherwise null. */
  accept(event: CoachEvent, now: number): CoachEvent {
    if (!event) return null
    if (event.kind === 'cue') {
      if (now - this.lastCue < CUE_GAP_MS) return null
      this.lastCue = now
    } else if (now - this.lastMessage < PRAISE_GAP_MS) {
      return null
    }
    this.lastMessage = now
    return event
  }
}
