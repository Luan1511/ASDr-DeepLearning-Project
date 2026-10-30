/**
 * Control format of "bạn Bin", the 2D companion.
 *
 * Three layers, all plain JSON:
 *  - Pose: flat map of channels ("armLeft.shoulder": 90, "face.mouth": "grin").
 *    Numeric channels are interpolated, discrete ones switch.
 *  - Clip: keyframed motion over channels (gesture library in clips.json, or inline).
 *  - Script: sequence of steps (say + expression + gesture + ears + look), what the
 *    backend / LLM sends.
 *
 * Angles are degrees. Arms: "armLeft" is the arm on the viewer's left. shoulder 0 =
 * hanging down, 90 = straight out sideways, 180 = straight up; negative swings in
 * front of the body. elbow/wrist rotate relative to the previous segment, same
 * sign convention (both arms are mirrored, so the same numbers give a symmetric pose).
 */

export const HAND_SHAPES = ['relaxed', 'open', 'fist', 'point', 'thumbs_up', 'peace', 'ok'] as const
export const EYE_SHAPES = ['open', 'happy', 'closed', 'wide', 'wink', 'sad'] as const
export const BROW_SHAPES = ['neutral', 'raised', 'happy', 'worried', 'focused'] as const
export const MOUTH_SHAPES = ['smile', 'grin', 'open', 'o', 'small', 'flat', 'sad'] as const

export type HandShape = (typeof HAND_SHAPES)[number]
export type EyeShape = (typeof EYE_SHAPES)[number]
export type BrowShape = (typeof BROW_SHAPES)[number]
export type MouthShape = (typeof MOUTH_SHAPES)[number]

/** Numeric channels with their allowed range (values are clamped). */
export const NUMERIC_CHANNELS = {
  'body.lean': [-15, 15],
  'body.bob': [-30, 30],
  'head.tilt': [-25, 25],
  'head.nod': [-15, 15],
  'head.turn': [-1, 1],
  'ears.left': [-40, 70],
  'ears.right': [-40, 70],
  'antenna.bend': [-35, 35],
  'armLeft.shoulder': [-60, 180],
  'armLeft.elbow': [-170, 170],
  'armLeft.wrist': [-90, 90],
  'armRight.shoulder': [-60, 180],
  'armRight.elbow': [-170, 170],
  'armRight.wrist': [-90, 90],
  'face.lookX': [-1, 1],
  'face.lookY': [-1, 1],
  'face.blush': [0, 1],
  'face.glow': [0, 1],
  'face.mouthOpen': [0, 1],
} as const satisfies Record<string, readonly [number, number]>

export const DISCRETE_CHANNELS = {
  'armLeft.hand': HAND_SHAPES,
  'armRight.hand': HAND_SHAPES,
  'face.eyes': EYE_SHAPES,
  'face.brows': BROW_SHAPES,
  'face.mouth': MOUTH_SHAPES,
} as const

export type NumericChannel = keyof typeof NUMERIC_CHANNELS
export type DiscreteChannel = keyof typeof DISCRETE_CHANNELS
export type Channel = NumericChannel | DiscreteChannel

export type Pose = { [K in NumericChannel]: number } & {
  'armLeft.hand': HandShape
  'armRight.hand': HandShape
  'face.eyes': EyeShape
  'face.brows': BrowShape
  'face.mouth': MouthShape
}
export type PartialPose = Partial<Record<Channel, number | string>>

export type Ease = 'linear' | 'ease' | 'easeIn' | 'easeOut' | 'back'

export type Keyframe = {
  /** ms from clip start. */
  t: number
  /** Easing of the segment that arrives at this keyframe. */
  ease?: Ease
  pose: PartialPose
}

export type Clip = {
  duration: number
  loop?: boolean
  /** ms to fade from the current pose into the clip (default 250). */
  blendIn?: number
  /** ms to fade back out after the clip ends / is stopped (default 350). */
  blendOut?: number
  keyframes: Keyframe[]
}

export const EXPRESSIONS = [
  'neutral',
  'happy',
  'curious',
  'encourage',
  'surprised',
  'listening',
  'thinking',
  'sad',
  'proud',
] as const
export type ExpressionName = (typeof EXPRESSIONS)[number]

export const EAR_MOTIONS = ['none', 'wiggle', 'flap', 'perk', 'droop'] as const
export type EarMotion = (typeof EAR_MOTIONS)[number]

export const LOOKS = ['center', 'left', 'right', 'up', 'down'] as const
export type LookName = (typeof LOOKS)[number]

export type BuddyStep = {
  say?: string
  expression?: ExpressionName
  /** Name in the clip library, or an inline clip. */
  gesture?: string | Clip
  ears?: EarMotion
  look?: LookName | { x: number; y: number }
  /** Static channel overrides held for the whole step. */
  pose?: PartialPose
  /** Minimum step length in ms. */
  hold?: number
}

export type BuddyScript = {
  version?: 1
  steps: BuddyStep[]
  /** Expression after the last step. */
  idle?: ExpressionName
  suggestions?: string[]
}
