/**
 * Drawing of every part of "bạn Bin" (upper body only). Each part is drawn in its
 * own local frame so it can be shown alone (parts sheet) or posed by BuddyCharacter:
 *  - arms hang along +y from the shoulder; elbow at y=ARM.upper, wrist at ARM.fore
 *    below the elbow; hands are drawn from the wrist with fingers along +y.
 *  - ears grow up (−y) from their base pivot.
 *  - eyes / brows / mouth are centred on (0, 0).
 */
import { ARM, BUDDY_COLORS } from '../../lib/buddy/geometry'
import type { BrowShape, EyeShape, HandShape, MouthShape } from '../../lib/buddy/types'

const C = BUDDY_COLORS

// ------------------------------------------------------------------ body

export function BuddyTorso({ glow = 0.5 }: { glow?: number }) {
  return (
    <g>
      <path
        d="M134 292 C134 266 164 256 200 256 C236 256 266 266 266 292 L274 392 C278 436 246 452 200 452 C154 452 122 436 126 392 Z"
        fill={C.blue}
        stroke={C.outline}
        strokeWidth={4}
        strokeLinejoin="round"
      />
      <path
        d="M238 262 C256 268 264 278 265 292 L272 392 C275 428 258 446 230 450 C248 428 250 360 238 262 Z"
        fill={C.navy}
        opacity={0.55}
      />
      <path d="M150 298 C147 336 145 374 151 414" stroke={C.blueHi} strokeWidth={7} strokeLinecap="round" fill="none" opacity={0.55} />
      <ellipse cx={200} cy={374} rx={48} ry={62} fill={C.belly} />
      <ellipse cx={200} cy={374} rx={48} ry={62} fill="none" stroke="#B8CBF3" strokeWidth={2} />
      <BuddyCore glow={glow} cx={200} cy={352} />
    </g>
  )
}

/** Glowing yellow ring on the chest; `glow` 0..1. */
export function BuddyCore({ glow = 0.5, cx = 0, cy = 0 }: { glow?: number; cx?: number; cy?: number }) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={27} fill={C.yellow} opacity={0.12 + glow * 0.35} />
      <circle cx={cx} cy={cy} r={16} fill="#FFF8D6" stroke={C.yellow} strokeWidth={7} />
      <circle cx={cx} cy={cy} r={19.5} fill="none" stroke={C.outline} strokeWidth={1.5} opacity={0.35} />
      <circle cx={cx - 5} cy={cy - 5} r={3.5} fill="white" opacity={0.9} />
    </g>
  )
}

export function BuddyNeck() {
  return (
    <g>
      <rect x={182} y={234} width={36} height={28} rx={9} fill={C.navy} stroke={C.outline} strokeWidth={3.5} />
      <path d="M184 248 L216 248" stroke={C.blueHi} strokeWidth={3} opacity={0.6} />
    </g>
  )
}

// ------------------------------------------------------------------ head

export function BuddyHelmet() {
  return (
    <g>
      <rect x={86} y={56} width={228} height={190} rx={96} ry={90} fill={C.blue} stroke={C.outline} strokeWidth={4} />
      <path d="M118 96 C136 74 170 63 206 62" stroke={C.blueHi} strokeWidth={10} strokeLinecap="round" fill="none" opacity={0.75} />
      <path d="M290 200 C282 222 262 236 236 241" stroke={C.navy} strokeWidth={8} strokeLinecap="round" fill="none" opacity={0.6} />
      <rect x={110} y={90} width={180} height={140} rx={70} ry={62} fill={C.face} stroke={C.navy} strokeWidth={3} />
    </g>
  )
}

/** Side "headphone" disc, centred at (0, 0). */
export function BuddyEarpiece() {
  return (
    <g>
      <ellipse cx={0} cy={0} rx={18} ry={31} fill={C.navy} stroke={C.outline} strokeWidth={4} />
      <ellipse cx={0} cy={0} rx={8} ry={17} fill={C.yellow} stroke={C.outline} strokeWidth={2} />
    </g>
  )
}

/** Bunny-like ear growing up from (0, 0). */
export function BuddyEar() {
  return (
    <g>
      <path
        d="M-17 8 C-27 -28 -19 -74 2 -96 C21 -74 25 -28 15 8 Z"
        fill={C.blue}
        stroke={C.outline}
        strokeWidth={4}
        strokeLinejoin="round"
      />
      <path d="M-8 -6 C-13 -30 -8 -60 2 -77 C11 -60 13 -30 7 -6 Z" fill={C.yellow} />
      <path d="M-11 -20 C-12 -40 -8 -58 -2 -70" stroke={C.yellowHi} strokeWidth={3} strokeLinecap="round" fill="none" opacity={0.8} />
    </g>
  )
}

/** Antenna from its base (0, 0) up to the ball. */
export function BuddyAntenna() {
  return (
    <g>
      <path d="M0 2 L0 -28" stroke={C.outline} strokeWidth={8} strokeLinecap="round" />
      <path d="M0 2 L0 -28" stroke={C.navy} strokeWidth={4} strokeLinecap="round" />
      <circle cx={0} cy={-36} r={12} fill={C.yellow} stroke={C.outline} strokeWidth={3} />
      <circle cx={-4} cy={-40} r={4} fill={C.yellowHi} />
    </g>
  )
}

// ------------------------------------------------------------------ face

export function BuddyEye({
  shape,
  lookX = 0,
  lookY = 0,
  blink = 0,
}: {
  shape: EyeShape
  lookX?: number
  lookY?: number
  blink?: number
}) {
  const dx = lookX * 7
  const dy = lookY * 6
  if (shape === 'happy') {
    return <path d="M-15 5 Q0 -14 15 5" stroke={C.eye} strokeWidth={5.5} strokeLinecap="round" fill="none" />
  }
  if (shape === 'closed') {
    return <path d="M-14 -1 Q0 9 14 -1" stroke={C.eye} strokeWidth={5} strokeLinecap="round" fill="none" />
  }
  const [rx, ry, oy] = shape === 'wide' ? [16, 21, 0] : shape === 'sad' ? [13, 15, 3] : [14, 18, 0]
  const open = 1 - Math.min(1, blink) * 0.92
  return (
    <g transform={`translate(${dx} ${dy + oy}) scale(1 ${open})`}>
      <ellipse cx={0} cy={0} rx={rx} ry={ry} fill={C.eye} />
      <circle cx={-5} cy={-ry * 0.4} r={shape === 'wide' ? 6.5 : 5.5} fill="white" />
      <circle cx={5} cy={ry * 0.35} r={2.6} fill="white" opacity={0.9} />
    </g>
  )
}

/** Left brow (viewer's left); mirror it for the right one. */
export function BuddyBrow({ shape }: { shape: BrowShape }) {
  const [y, rot, d] =
    shape === 'raised'
      ? [-7, 0, 'M-12 2 Q0 -7 12 2']
      : shape === 'happy'
        ? [-3, 0, 'M-12 3 Q0 -6 12 3']
        : shape === 'worried'
          ? [-2, -15, 'M-12 1 Q0 -4 12 1']
          : shape === 'focused'
            ? [3, 13, 'M-12 1 Q0 -3 12 1']
            : [0, 0, 'M-12 2 Q0 -4 12 2']
  return (
    <path d={d} transform={`translate(0 ${y}) rotate(${rot})`} stroke={C.eye} strokeWidth={4.5} strokeLinecap="round" fill="none" />
  )
}

function OpenMouth({ w, depth }: { w: number; depth: number }) {
  return (
    <g>
      <path d={`M${-w} -1 Q0 2 ${w} -1 Q0 ${depth * 2} ${-w} -1 Z`} fill={C.mouth} stroke={C.outline} strokeWidth={2.5} strokeLinejoin="round" />
      {depth > 7 && <ellipse cx={0} cy={depth * 0.62} rx={w * 0.45} ry={depth * 0.24} fill={C.tongue} />}
    </g>
  )
}

/** `open` 0..1 overrides the shape with a talking mouth. */
export function BuddyMouth({ shape, open = 0 }: { shape: MouthShape; open?: number }) {
  if (open > 0.05) return <OpenMouth w={12 + open * 3} depth={4 + open * 13} />
  const line = (d: string) => <path d={d} stroke={C.eye} strokeWidth={5} strokeLinecap="round" fill="none" />
  switch (shape) {
    case 'grin':
      return <OpenMouth w={17} depth={14} />
    case 'open':
      return <ellipse cx={0} cy={4} rx={10} ry={12} fill={C.mouth} stroke={C.outline} strokeWidth={2.5} />
    case 'o':
      return <ellipse cx={0} cy={3} rx={7} ry={9} fill={C.mouth} stroke={C.outline} strokeWidth={2.5} />
    case 'small':
      return line('M-8 0 Q0 7 8 0')
    case 'flat':
      return line('M-9 2 L9 2')
    case 'sad':
      return line('M-13 6 Q0 -5 13 6')
    default:
      return line('M-15 -3 Q0 12 15 -3')
  }
}

export function BuddyBlush({ amount = 0.6 }: { amount?: number }) {
  return <ellipse cx={0} cy={0} rx={13} ry={8} fill={C.blush} opacity={0.15 + amount * 0.65} />
}

// ------------------------------------------------------------------ arms

/** Upper arm (cánh tay) from the shoulder (0, 0) down to the elbow. */
export function BuddyUpperArm() {
  return (
    <g>
      <rect x={-14} y={-4} width={28} height={ARM.upper + 4} rx={14} fill={C.arm} stroke={C.outline} strokeWidth={3.5} />
      <rect x={3} y={6} width={7} height={ARM.upper - 16} rx={3.5} fill={C.armShade} opacity={0.5} />
    </g>
  )
}

/** Forearm (cẳng tay) from the elbow (0, 0) down to the wrist, with the cuff. */
export function BuddyForearm() {
  return (
    <g>
      <rect x={-13} y={-4} width={26} height={ARM.fore + 2} rx={12} fill={C.arm} stroke={C.outline} strokeWidth={3.5} />
      <rect x={3} y={8} width={6} height={ARM.fore - 24} rx={3} fill={C.armShade} opacity={0.5} />
      <rect x={-15.5} y={ARM.fore - 14} width={31} height={14} rx={6} fill={C.yellow} stroke={C.outline} strokeWidth={3} />
    </g>
  )
}

/** Ball joint covering the seam between two segments. */
export function BuddyJoint({ r = 14.5, fill = C.armShade }: { r?: number; fill?: string }) {
  return <circle cx={0} cy={0} r={r} fill={fill} stroke={C.outline} strokeWidth={3.5} />
}

export function BuddyShoulder() {
  return (
    <g>
      <circle cx={0} cy={0} r={17} fill={C.blue} stroke={C.outline} strokeWidth={3.5} />
      <path d="M-11 -8 A13 13 0 0 1 11 -8" stroke={C.yellow} strokeWidth={4.5} strokeLinecap="round" fill="none" />
    </g>
  )
}

function Finger({ x, y, angle, len, w = 8 }: { x: number; y: number; angle: number; len: number; w?: number }) {
  return (
    <rect
      x={-w / 2}
      y={-2}
      width={w}
      height={len + 2}
      rx={w / 2}
      transform={`translate(${x} ${y}) rotate(${angle})`}
      fill={C.glove}
      stroke={C.outline}
      strokeWidth={3}
    />
  )
}

function Palm({ closed = false }: { closed?: boolean }) {
  return (
    <g>
      <ellipse cx={0} cy={16} rx={15.5} ry={closed ? 15 : 14} fill={C.glove} stroke={C.outline} strokeWidth={3.5} />
      <path d="M6 6 C11 10 12 18 9 25" stroke={C.gloveShade} strokeWidth={4} strokeLinecap="round" fill="none" opacity={0.7} />
    </g>
  )
}

const KNUCKLES = (
  <path d="M-9 24 Q-6 28 -2 25 M-1 26 Q2 30 6 26" stroke={C.outline} strokeWidth={2.2} strokeLinecap="round" fill="none" opacity={0.75} />
)

/** Glove hand from the wrist (0, 0), fingers along +y, thumb on the −x side. */
export function BuddyHand({ shape }: { shape: HandShape }) {
  switch (shape) {
    case 'open':
      return (
        <g>
          <Finger x={-9} y={24} angle={24} len={17} />
          <Finger x={-3} y={26} angle={8} len={20} />
          <Finger x={3} y={26} angle={-8} len={20} />
          <Finger x={9} y={24} angle={-24} len={16} />
          <Finger x={-12} y={12} angle={72} len={15} />
          <Palm />
        </g>
      )
    case 'fist':
      return (
        <g>
          <Palm closed />
          {KNUCKLES}
          <Finger x={-12} y={12} angle={-62} len={13} w={8.5} />
        </g>
      )
    case 'point':
      return (
        <g>
          <Finger x={3} y={24} angle={0} len={22} />
          <Palm closed />
          {KNUCKLES}
          <Finger x={-12} y={12} angle={-62} len={13} w={8.5} />
        </g>
      )
    case 'thumbs_up':
      return (
        <g>
          <Finger x={-11} y={14} angle={90} len={18} w={9} />
          <Palm closed />
          {KNUCKLES}
        </g>
      )
    case 'peace':
      return (
        <g>
          <Finger x={-4} y={25} angle={14} len={21} />
          <Finger x={5} y={25} angle={-14} len={21} />
          <Palm closed />
          <Finger x={-12} y={12} angle={-62} len={13} w={8.5} />
        </g>
      )
    case 'ok':
      return (
        <g>
          <Finger x={-1} y={26} angle={6} len={19} />
          <Finger x={5} y={25} angle={-6} len={19} />
          <Finger x={10} y={22} angle={-20} len={16} />
          <Palm />
          <circle cx={-12} cy={28} r={7.5} fill="none" stroke={C.outline} strokeWidth={10} />
          <circle cx={-12} cy={28} r={7.5} fill="none" stroke={C.glove} strokeWidth={4.5} />
        </g>
      )
    default:
      return (
        <g>
          <Finger x={-7.5} y={23} angle={6} len={11} w={7.5} />
          <Finger x={-2.5} y={24} angle={2} len={13} w={7.5} />
          <Finger x={2.5} y={24} angle={-2} len={13} w={7.5} />
          <Finger x={7.5} y={23} angle={-6} len={11} w={7.5} />
          <Finger x={-12} y={11} angle={40} len={12} />
          <Palm />
        </g>
      )
  }
}

/** One whole arm: shoulder ball, upper arm, elbow, forearm, cuff and hand. */
export function BuddyArm({
  shoulder,
  elbow,
  wrist,
  hand,
}: {
  shoulder: number
  elbow: number
  wrist: number
  hand: HandShape
}) {
  return (
    <g transform={`rotate(${shoulder})`}>
      <BuddyUpperArm />
      <g transform={`translate(0 ${ARM.upper}) rotate(${elbow})`}>
        <BuddyForearm />
        <BuddyJoint />
        <g transform={`translate(0 ${ARM.fore - 2}) rotate(${wrist}) scale(1.22)`}>
          <BuddyHand shape={hand} />
        </g>
      </g>
      <BuddyShoulder />
    </g>
  )
}
