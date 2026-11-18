/**
 * "Bạn Bin" with his whole body, posed from a 15-joint skeleton (the exercise
 * guide). The head, torso, gloves and shoulder caps are the same drawings as
 * the chat character (BuddyParts); arms and legs are capsules stretched from
 * joint to joint, so any pose a person can show the camera is drawable.
 *
 * The component renders the parts once; `setPose` then moves them by writing
 * SVG attributes directly (60 times a second during a demonstration, without
 * re-rendering React).
 */
import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, type CSSProperties } from 'react'
import expressions from '../../lib/buddy/expressions.json'
import { FIGURE_ANKLE_LINE, FIGURE_UNIT, FIGURE_VIEW, HEAD_ART, HEAD_LIFT, HEAD_SCALE } from '../../lib/buddy/figure'
import { BUDDY_COLORS } from '../../lib/buddy/geometry'
import type { BrowShape, ExpressionName, EyeShape, HandShape, MouthShape } from '../../lib/buddy/types'
import { J, type PuppetPose, type Vec } from '../../lib/puppet'
import {
  BuddyAntenna,
  BuddyBlush,
  BuddyBoot,
  BuddyBrow,
  BuddyEar,
  BuddyEarpiece,
  BuddyEye,
  BuddyHand,
  BuddyHelmet,
  BuddyMouth,
  BuddyNeck,
  BuddyShoulder,
  BuddyTorso,
} from './BuddyParts'

const C = BUDDY_COLORS

// View box and scale live in lib/buddy/figure.ts (shared with the fitting rule).
const UNIT = FIGURE_UNIT
const ANKLE_LINE = FIGURE_ANKLE_LINE

const ARM_T = 18
const LEG_T = 23
const OUTLINE = 2.6
const ELBOW_R = ARM_T / 2 + 1
const KNEE_R = LEG_T / 2 + 1

// Where the torso drawing (BuddyTorso, character units) meets the skeleton.
const TORSO_ART = { centreX: 200, shoulderY: 290, hipY: 430, halfShoulder: 58 }
/** The body is drawn a little narrower than the shoulder joints; the shoulder caps cover the seam. */
const TORSO_SLIM = 0.94
/** Narrowest half shoulder width drawn (a turned body is not squeezed to a line). */
const MIN_HALF_SHOULDER = 24

const EAR_BASE = { left: 128, right: 272, y: 84 }
const EAR_REST = 24

const HAND_SCALE = 0.78
const BOOT_SCALE = 1.18
const SHOULDER_SCALE = 0.66
/** A leg whose knee comes this close to hip height is drawn in front of the body. */
const LEG_FRONT_ON = -0.32
const LEG_FRONT_OFF = -0.4

export type BuddyFigureHandle = {
  /** Skeleton pose in torso lengths (y up, mid-hip at the origin); `groundY` is the floor height. */
  setPose: (pose: PuppetPose, groundY: number) => void
  /** 0 = eyes open, 1 = closed. */
  setBlink: (amount: number) => void
}

type Face = {
  eyes: EyeShape
  brows: BrowShape
  mouth: MouthShape
  blush: number
  glow: number
  earLeft: number
  earRight: number
  tilt: number
  lookX: number
  lookY: number
}

const NEUTRAL_FACE: Face = {
  eyes: 'open',
  brows: 'neutral',
  mouth: 'smile',
  blush: 0.5,
  glow: 0.5,
  earLeft: 0,
  earRight: 0,
  tilt: 0,
  lookX: 0,
  lookY: 0,
}

/** The same expression library as the chat character (lib/buddy/expressions.json). */
function faceOf(name: ExpressionName): Face {
  const raw = (expressions as Record<string, Record<string, string | number>>)[name] ?? {}
  const text = <T extends string>(key: string, fallback: T) => (typeof raw[key] === 'string' ? (raw[key] as T) : fallback)
  const num = (key: string, fallback: number) => (typeof raw[key] === 'number' ? (raw[key] as number) : fallback)
  return {
    eyes: text('face.eyes', NEUTRAL_FACE.eyes),
    brows: text('face.brows', NEUTRAL_FACE.brows),
    mouth: text('face.mouth', NEUTRAL_FACE.mouth),
    blush: num('face.blush', NEUTRAL_FACE.blush),
    glow: num('face.glow', NEUTRAL_FACE.glow),
    earLeft: num('ears.left', 0),
    earRight: num('ears.right', 0),
    tilt: num('head.tilt', 0),
    lookX: num('face.lookX', 0),
    lookY: num('face.lookY', 0),
  }
}

// ---------------------------------------------------------------------------
// Static structure
// ---------------------------------------------------------------------------

/** Capsule between two joints: outline, fill and a soft shade stripe (three lines moved by setPose). */
function Segment({ id, thickness }: { id: string; thickness: number }) {
  return (
    <>
      <line data-part={`${id}.o`} stroke={C.outline} strokeWidth={thickness + 2 * OUTLINE} strokeLinecap="round" />
      <line data-part={`${id}.f`} stroke={C.arm} strokeWidth={thickness} strokeLinecap="round" />
      <line data-part={`${id}.s`} stroke={C.armShade} strokeOpacity={0.45} strokeWidth={thickness * 0.24} strokeLinecap="round" />
    </>
  )
}

/** Yellow band at the end of a limb (wrist cuff, boot top). */
function Cuff({ id, thickness }: { id: string; thickness: number }) {
  return (
    <>
      <line data-part={`${id}.o`} stroke={C.outline} strokeWidth={thickness + 4 + 2 * OUTLINE} strokeLinecap="butt" />
      <line data-part={`${id}.f`} stroke={C.yellow} strokeWidth={thickness + 4} strokeLinecap="butt" />
    </>
  )
}

function Joint({ id, r }: { id: string; r: number }) {
  return <circle data-part={id} r={r} fill={C.armShade} stroke={C.outline} strokeWidth={OUTLINE} />
}

/** One leg; it exists twice (behind and in front of the body) and setPose shows one copy. */
function Leg({ id, front }: { id: string; front: boolean }) {
  return (
    <g data-part={`${id}.layer`} style={front ? { display: 'none' } : undefined}>
      <Segment id={`${id}.thigh`} thickness={LEG_T} />
      {front && <Joint id={`${id}.hip`} r={KNEE_R} />}
      <Segment id={`${id}.shin`} thickness={LEG_T} />
      <Joint id={`${id}.knee`} r={KNEE_R} />
      <Cuff id={`${id}.cuff`} thickness={LEG_T} />
      <g data-part={`${id}.boot`}>
        <BuddyBoot />
      </g>
    </g>
  )
}

function Arm({ id, hand }: { id: string; hand: HandShape }) {
  return (
    <g>
      <Segment id={`${id}.upper`} thickness={ARM_T} />
      <Segment id={`${id}.fore`} thickness={ARM_T} />
      <Joint id={`${id}.elbow`} r={ELBOW_R} />
      <Cuff id={`${id}.cuff`} thickness={ARM_T} />
      <g data-part={`${id}.hand`}>
        <BuddyHand shape={hand} />
      </g>
      <g data-part={`${id}.cap`}>
        <g transform={`scale(${SHOULDER_SCALE})`}>
          <BuddyShoulder />
        </g>
      </g>
    </g>
  )
}

// ---------------------------------------------------------------------------
// Posing
// ---------------------------------------------------------------------------

type Parts = Record<string, SVGElement | undefined>

const fixed = (v: number) => v.toFixed(1)
const degrees = (radians: number) => (radians * 180) / Math.PI
const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

function setLine(el: SVGElement | undefined, a: Vec, b: Vec) {
  if (!el) return
  el.setAttribute('x1', fixed(a.x))
  el.setAttribute('y1', fixed(a.y))
  el.setAttribute('x2', fixed(b.x))
  el.setAttribute('y2', fixed(b.y))
}

function setCentre(el: SVGElement | undefined, p: Vec) {
  if (!el) return
  el.setAttribute('cx', fixed(p.x))
  el.setAttribute('cy', fixed(p.y))
}

/** Unit vector from a to b (straight down for coincident points). */
function direction(a: Vec, b: Vec): Vec {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy)
  return len > 1e-3 ? { x: dx / len, y: dy / len } : { x: 0, y: 1 }
}

/** Rotation (SVG degrees) that turns a part drawn along +y to point along `u`. */
const alongAngle = (u: Vec) => degrees(Math.atan2(-u.x, u.y))

function placeSegment(parts: Parts, id: string, a: Vec, b: Vec, thickness: number) {
  setLine(parts[`${id}.o`], a, b)
  setLine(parts[`${id}.f`], a, b)
  const u = direction(a, b)
  const length = Math.hypot(b.x - a.x, b.y - a.y)
  // The shade stripe stays on the same (picture-right) side whatever the limb does.
  const n = u.y >= 0 ? { x: u.y, y: -u.x } : { x: -u.y, y: u.x }
  const offset = thickness * 0.2
  const inset = Math.min(length * 0.3, thickness * 0.55)
  setLine(
    parts[`${id}.s`],
    { x: a.x + u.x * inset + n.x * offset, y: a.y + u.y * inset + n.y * offset },
    { x: b.x - u.x * inset + n.x * offset, y: b.y - u.y * inset + n.y * offset },
  )
}

/** Band over the last few units before `end`, across the limb coming from `from`. */
function placeCuff(parts: Parts, id: string, from: Vec, end: Vec, near: number, far: number) {
  const u = direction(from, end)
  const a = { x: end.x - u.x * far, y: end.y - u.y * far }
  const b = { x: end.x - u.x * near, y: end.y - u.y * near }
  setLine(parts[`${id}.f`], a, b)
  setLine(
    parts[`${id}.o`],
    { x: a.x - u.x * OUTLINE, y: a.y - u.y * OUTLINE },
    { x: b.x + u.x * OUTLINE, y: b.y + u.y * OUTLINE },
  )
}

function placeFigure(parts: Parts, pose: PuppetPose, groundY: number, legFront: { r: boolean; l: boolean }) {
  const P = pose.map((p) => ({ x: FIGURE_VIEW / 2 + p.x * UNIT, y: ANKLE_LINE - (p.y - groundY) * UNIT }))

  // ---- shadow under the feet
  const shadow = parts.shadow
  if (shadow) {
    const spread = Math.abs(P[J.rAnkle].x - P[J.lAnkle].x)
    shadow.setAttribute('cx', fixed((P[J.rAnkle].x + P[J.lAnkle].x) / 2))
    shadow.setAttribute('rx', fixed(Math.max(58, spread / 2 + 34)))
  }

  // ---- legs (the copy behind or in front of the body)
  for (const [side, hip, knee, ankle, outward] of [
    ['r', J.rHip, J.rKnee, J.rAnkle, -1],
    ['l', J.lHip, J.lKnee, J.lAnkle, 1],
  ] as const) {
    const raise = pose[knee].y - pose[hip].y
    const front = legFront[side] ? raise > LEG_FRONT_OFF : raise > LEG_FRONT_ON
    legFront[side] = front
    const back = parts[`${side}LegB.layer`]
    const fore = parts[`${side}LegF.layer`]
    if (back) back.style.display = front ? 'none' : ''
    if (fore) fore.style.display = front ? '' : 'none'
    const id = `${side}Leg${front ? 'F' : 'B'}`
    placeSegment(parts, `${id}.thigh`, P[hip], P[knee], LEG_T)
    placeSegment(parts, `${id}.shin`, P[knee], P[ankle], LEG_T)
    setCentre(parts[`${id}.hip`], P[hip])
    setCentre(parts[`${id}.knee`], P[knee])
    placeCuff(parts, `${id}.cuff`, P[knee], P[ankle], -1, 7)
    // On the floor the sole stays flat; a lifted foot hangs along the shin.
    const lifted = clamp01((pose[ankle].y - groundY - 0.04) / 0.16)
    const turn = lifted * alongAngle(direction(P[knee], P[ankle]))
    parts[`${id}.boot`]?.setAttribute(
      'transform',
      `translate(${fixed(P[ankle].x)} ${fixed(P[ankle].y)}) rotate(${fixed(turn)}) scale(${outward < 0 ? BOOT_SCALE : -BOOT_SCALE} ${BOOT_SCALE})`,
    )
  }

  // ---- torso: an affine map of the drawing onto the shoulder line and the hips
  const S = { x: (P[J.rShoulder].x + P[J.lShoulder].x) / 2, y: (P[J.rShoulder].y + P[J.lShoulder].y) / 2 }
  const H = P[J.midHip]
  let spine = { x: H.x - S.x, y: H.y - S.y }
  if (Math.hypot(spine.x, spine.y) < 20) spine = { x: 0, y: 20 }
  let half = { x: (P[J.lShoulder].x - P[J.rShoulder].x) / 2, y: (P[J.lShoulder].y - P[J.rShoulder].y) / 2 }
  const halfLength = Math.hypot(half.x, half.y)
  if (halfLength < 1) {
    // Shoulders on top of each other (seen from the side): across the spine.
    const s = Math.hypot(spine.x, spine.y)
    half = { x: (spine.y / s) * MIN_HALF_SHOULDER, y: (-spine.x / s) * MIN_HALF_SHOULDER }
  } else if (halfLength < MIN_HALF_SHOULDER) {
    half = { x: (half.x / halfLength) * MIN_HALF_SHOULDER, y: (half.y / halfLength) * MIN_HALF_SHOULDER }
  }
  const a = (half.x * TORSO_SLIM) / TORSO_ART.halfShoulder
  const b = (half.y * TORSO_SLIM) / TORSO_ART.halfShoulder
  const spineArt = TORSO_ART.hipY - TORSO_ART.shoulderY
  const c = spine.x / spineArt
  const d = spine.y / spineArt
  const e = S.x - a * TORSO_ART.centreX - c * TORSO_ART.shoulderY
  const f = S.y - b * TORSO_ART.centreX - d * TORSO_ART.shoulderY
  parts.torso?.setAttribute('transform', `matrix(${a.toFixed(4)} ${b.toFixed(4)} ${c.toFixed(4)} ${d.toFixed(4)} ${fixed(e)} ${fixed(f)})`)

  // ---- head: rigid, along the spine
  const up = direction(H, S)
  const neck = { x: S.x + up.x * HEAD_LIFT, y: S.y + up.y * HEAD_LIFT }
  parts.head?.setAttribute(
    'transform',
    `translate(${fixed(neck.x)} ${fixed(neck.y)}) rotate(${fixed(degrees(Math.atan2(up.x, -up.y)))}) scale(${HEAD_SCALE}) translate(${-HEAD_ART.centreX} ${-HEAD_ART.neckBaseY})`,
  )

  // ---- arms, in front of everything
  for (const [side, shoulder, elbow, wrist, mirror] of [
    ['r', J.rShoulder, J.rElbow, J.rWrist, 1],
    ['l', J.lShoulder, J.lElbow, J.lWrist, -1],
  ] as const) {
    const id = `${side}Arm`
    placeSegment(parts, `${id}.upper`, P[shoulder], P[elbow], ARM_T)
    placeSegment(parts, `${id}.fore`, P[elbow], P[wrist], ARM_T)
    setCentre(parts[`${id}.elbow`], P[elbow])
    placeCuff(parts, `${id}.cuff`, P[elbow], P[wrist], 1, 9)
    const fore = direction(P[elbow], P[wrist])
    parts[`${id}.hand`]?.setAttribute(
      'transform',
      `translate(${fixed(P[wrist].x)} ${fixed(P[wrist].y)}) rotate(${fixed(alongAngle(fore))}) scale(${mirror * HAND_SCALE} ${HAND_SCALE})`,
    )
    parts[`${id}.cap`]?.setAttribute('transform', `translate(${fixed(P[shoulder].x)} ${fixed(P[shoulder].y)})`)
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const BuddyFigure = forwardRef<
  BuddyFigureHandle,
  {
    /** Face, ears and chest glow, from the chat character's expression library. */
    expression?: ExpressionName
    hands?: HandShape
    /** Scale of the whole figure about its feet (lib/buddy/figure.ts `fitFigure`); 1 = one torso length is 100 view units. */
    fit?: number
    /** Accessible description, e.g. "Bạn Bin đang làm mẫu: Dang tay". */
    label: string
    className?: string
    style?: CSSProperties
  }
>(function BuddyFigure({ expression = 'neutral', hands = 'relaxed', fit = 1, label, className, style }, ref) {
  const root = useRef<SVGSVGElement>(null)
  const parts = useRef<Parts>({})
  const legFront = useRef({ r: false, l: false })
  const face = faceOf(expression)

  // The parts never change identity, but collect them again after every render to stay in step with React.
  useLayoutEffect(() => {
    const found: Parts = {}
    root.current?.querySelectorAll<SVGElement>('[data-part]').forEach((el) => {
      found[el.getAttribute('data-part') ?? ''] = el
    })
    parts.current = found
  })

  useImperativeHandle(
    ref,
    () => ({
      setPose: (pose, groundY) => placeFigure(parts.current, pose, groundY, legFront.current),
      setBlink: (amount) => {
        const open = 1 - Math.min(1, Math.max(0, amount)) * 0.92
        parts.current.eyeLeft?.setAttribute('transform', `scale(1 ${open.toFixed(2)})`)
        parts.current.eyeRight?.setAttribute('transform', `scale(1 ${open.toFixed(2)})`)
      },
    }),
    [],
  )

  // The figure is scaled about the middle of the floor, so the feet stay where they are.
  const floor = `${FIGURE_VIEW / 2} ${FIGURE_VIEW - 8}`
  return (
    <svg ref={root} viewBox={`0 0 ${FIGURE_VIEW} ${FIGURE_VIEW}`} role="img" aria-label={label} className={className} style={style}>
     <g transform={`translate(${floor}) scale(${fit.toFixed(4)}) translate(-${FIGURE_VIEW / 2} -${FIGURE_VIEW - 8})`}>
      <ellipse data-part="shadow" cx={FIGURE_VIEW / 2} cy={ANKLE_LINE + 19} rx={60} ry={9} fill={C.outline} opacity={0.13} />

      <Leg id="lLegB" front={false} />
      <Leg id="rLegB" front={false} />

      <g data-part="torso">
        <BuddyTorso glow={face.glow} />
      </g>

      <Leg id="lLegF" front />
      <Leg id="rLegF" front />

      <g data-part="head">
        <BuddyNeck />
        <g transform={`rotate(${face.tilt} 200 250)`}>
          <g transform={`translate(${EAR_BASE.left} ${EAR_BASE.y}) rotate(${-(EAR_REST + face.earLeft)})`}>
            <BuddyEar />
          </g>
          <g transform={`translate(${EAR_BASE.right} ${EAR_BASE.y}) scale(-1 1) rotate(${-(EAR_REST + face.earRight)})`}>
            <BuddyEar />
          </g>
          <g transform="translate(200 60)">
            <BuddyAntenna />
          </g>
          <BuddyHelmet />
          <g transform="translate(86 160)">
            <BuddyEarpiece />
          </g>
          <g transform="translate(314 160)">
            <BuddyEarpiece />
          </g>
          <g transform="translate(134 190)">
            <BuddyBlush amount={face.blush} />
          </g>
          <g transform="translate(266 190)">
            <BuddyBlush amount={face.blush} />
          </g>
          <g transform="translate(156 160)">
            <g data-part="eyeLeft">
              <BuddyEye shape={face.eyes === 'wink' ? 'open' : face.eyes} lookX={face.lookX} lookY={face.lookY} />
            </g>
          </g>
          <g transform="translate(244 160)">
            <g data-part="eyeRight">
              <BuddyEye shape={face.eyes === 'wink' ? 'happy' : face.eyes} lookX={face.lookX} lookY={face.lookY} />
            </g>
          </g>
          <g transform="translate(156 122)">
            <BuddyBrow shape={face.brows} />
          </g>
          <g transform="translate(244 122) scale(-1 1)">
            <BuddyBrow shape={face.brows} />
          </g>
          <g transform="translate(200 198)">
            <BuddyMouth shape={face.mouth} />
          </g>
        </g>
      </g>

      <Arm id="lArm" hand={hands} />
      <Arm id="rArm" hand={hands} />
     </g>
    </svg>
  )
})
