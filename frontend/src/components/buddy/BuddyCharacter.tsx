import type { BuddyFrame } from '../../lib/buddy/engine'
import type { Pose } from '../../lib/buddy/types'
import {
  BuddyAntenna,
  BuddyArm,
  BuddyBlush,
  BuddyBrow,
  BuddyEar,
  BuddyEarpiece,
  BuddyEye,
  BuddyHelmet,
  BuddyMouth,
  BuddyNeck,
  BuddyTorso,
} from './BuddyParts'

const SHOULDER_Y = 290
const SHOULDER_X = { left: 142, right: 258 }
const EAR_BASE = { left: 128, right: 272, y: 84 }
/** Ears lean outward by this much at rest. */
const EAR_REST = 24

/** "Bạn Bin", posed from one frame of BuddyDirector. */
export function BuddyCharacter({
  frame,
  className,
  viewBox = '-30 -30 460 490',
}: {
  frame: Pick<BuddyFrame, 'pose' | 'blink'>
  className?: string
  viewBox?: string
}) {
  const p: Pose = frame.pose
  const turn = p['head.turn']
  const nod = p['head.nod']
  const faceX = turn * 14
  const faceY = nod * 0.9
  return (
    <svg viewBox={viewBox} className={className} role="img" aria-label="Bạn Bin">
      <g transform={`translate(0 ${p['body.bob']}) rotate(${p['body.lean']} 200 450)`}>
        <BuddyTorso glow={p['face.glow']} />
        <BuddyNeck />

        <g transform={`translate(${turn * 5} ${nod * 0.6}) rotate(${p['head.tilt']} 200 250)`}>
          <g transform={`translate(${EAR_BASE.left - turn * 4} ${EAR_BASE.y}) rotate(${-(EAR_REST + p['ears.left'])})`}>
            <BuddyEar />
          </g>
          <g transform={`translate(${EAR_BASE.right - turn * 4} ${EAR_BASE.y}) scale(-1 1) rotate(${-(EAR_REST + p['ears.right'])})`}>
            <BuddyEar />
          </g>
          <g transform={`translate(200 60) rotate(${p['antenna.bend']})`}>
            <BuddyAntenna />
          </g>
          <BuddyHelmet />
          <g transform={`translate(${86 - turn * 3} 160)`}>
            <BuddyEarpiece />
          </g>
          <g transform={`translate(${314 - turn * 3} 160)`}>
            <BuddyEarpiece />
          </g>

          <g transform={`translate(${faceX} ${faceY})`}>
            <g transform="translate(134 190)">
              <BuddyBlush amount={p['face.blush']} />
            </g>
            <g transform="translate(266 190)">
              <BuddyBlush amount={p['face.blush']} />
            </g>
            <g transform="translate(156 160)">
              <BuddyEye shape={p['face.eyes'] === 'wink' ? 'open' : p['face.eyes']} lookX={p['face.lookX']} lookY={p['face.lookY']} blink={frame.blink} />
            </g>
            <g transform="translate(244 160)">
              <BuddyEye shape={p['face.eyes'] === 'wink' ? 'happy' : p['face.eyes']} lookX={p['face.lookX']} lookY={p['face.lookY']} blink={frame.blink} />
            </g>
            <g transform="translate(156 122)">
              <BuddyBrow shape={p['face.brows']} />
            </g>
            <g transform="translate(244 122) scale(-1 1)">
              <BuddyBrow shape={p['face.brows']} />
            </g>
            <g transform="translate(200 198)">
              <BuddyMouth shape={p['face.mouth']} open={p['face.mouthOpen']} />
            </g>
          </g>
        </g>

        <g transform={`translate(${SHOULDER_X.left} ${SHOULDER_Y})`}>
          <BuddyArm
            shoulder={p['armLeft.shoulder']}
            elbow={p['armLeft.elbow']}
            wrist={p['armLeft.wrist']}
            hand={p['armLeft.hand']}
          />
        </g>
        <g transform={`translate(${SHOULDER_X.right} ${SHOULDER_Y}) scale(-1 1)`}>
          <BuddyArm
            shoulder={p['armRight.shoulder']}
            elbow={p['armRight.elbow']}
            wrist={p['armRight.wrist']}
            hand={p['armRight.hand']}
          />
        </g>
      </g>
    </svg>
  )
}
