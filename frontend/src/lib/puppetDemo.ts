/**
 * Small synthetic demonstrations in the guide-template format, for showing the
 * whole-body Bin where no exercise template is at hand (the character studio).
 * They are drawings of movements, not exercise templates: nothing is scored
 * against them.
 */
import type { GuideTemplateDto } from './exerciseTypes'
import { DEFAULT_NEUTRAL, J, type PuppetPose, type Vec } from './puppet'

export type DemoGuide = Pick<GuideTemplateDto, 'hz' | 'joints' | 'frames' | 'neutral' | 'durationSec'>

const HZ = 15
const UPPER_ARM = 0.47
const FOREARM = 0.44
const THIGH = 0.68
const SHIN = 0.68
const SHOULDER: Record<-1 | 1, Vec> = { [-1]: { x: -0.38, y: 0.97 }, 1: { x: 0.38, y: 0.97 } }
const HIP: Record<-1 | 1, Vec> = { [-1]: { x: -0.2, y: 0 }, 1: { x: 0.2, y: 0 } }

const rad = (deg: number) => (deg * Math.PI) / 180
/** Point `length` away from `from`; 0° hangs straight down, positive angles swing to the body's own side. */
const swing = (from: Vec, side: -1 | 1, deg: number, length: number): Vec => ({
  x: from.x + side * Math.sin(rad(deg)) * length,
  y: from.y - Math.cos(rad(deg)) * length,
})

type Figure = {
  /** Upper arm / forearm angles of the right and left arm. */
  arms?: Partial<Record<'r' | 'l', [number, number]>>
  /** Outward angle of each whole leg. */
  legs?: Partial<Record<'r' | 'l', number>>
  /** Knee lifted towards the viewer, 0..1 (the thigh shortens in the picture). */
  kneeLift?: Partial<Record<'r' | 'l', number>>
  /** Side bend of the upper body in degrees (positive = to the picture's right). */
  lean?: number
}

function figure({ arms = {}, legs = {}, kneeLift = {}, lean = 0 }: Figure): PuppetPose {
  const pose = DEFAULT_NEUTRAL.map((p) => ({ ...p }))
  const bend = (p: Vec): Vec => {
    const a = rad(lean)
    return { x: p.x * Math.cos(a) + p.y * Math.sin(a), y: -p.x * Math.sin(a) + p.y * Math.cos(a) }
  }
  pose[J.neck] = bend({ x: 0, y: 1 })
  pose[J.nose] = bend({ x: 0, y: 1.3 })
  for (const [key, side, s, e, w] of [
    ['r', -1, J.rShoulder, J.rElbow, J.rWrist],
    ['l', 1, J.lShoulder, J.lElbow, J.lWrist],
  ] as const) {
    const [upper, fore] = arms[key] ?? [8, 5]
    const shoulder = bend(SHOULDER[side])
    // The arms hang by gravity: a side bend moves the shoulders, not the arm angles.
    const elbow = swing(shoulder, side, upper, UPPER_ARM)
    pose[s] = shoulder
    pose[e] = elbow
    pose[w] = swing(elbow, side, fore, FOREARM)
  }
  for (const [key, side, h, k, a] of [
    ['r', -1, J.rHip, J.rKnee, J.rAnkle],
    ['l', 1, J.lHip, J.lKnee, J.lAnkle],
  ] as const) {
    const lift = kneeLift[key] ?? 0
    const out = legs[key] ?? 2
    const knee = swing(HIP[side], side, out, THIGH * (1 - 0.72 * lift))
    pose[h] = { ...HIP[side] }
    pose[k] = knee
    pose[a] = swing(knee, side, out * 0.4, SHIN * (1 - 0.12 * lift))
  }
  return pose
}

function guide(durationSec: number, at: (tSec: number) => Figure): DemoGuide {
  const encode = (pose: PuppetPose) => pose.flatMap((p) => [Number(p.x.toFixed(4)), Number(p.y.toFixed(4))])
  const count = Math.round(durationSec * HZ)
  return {
    hz: 15,
    durationSec,
    joints: Array.from({ length: 15 }, (_, j) => j),
    neutral: encode(DEFAULT_NEUTRAL),
    frames: Array.from({ length: count }, (_, i) => encode(figure(at(i / HZ)))),
  }
}

/** 0 → 1 → 0 once per `period`, starting at `from`; 0 outside [from, from + cycles × period]. */
function pulse(t: number, from: number, period: number, cycles: number) {
  const u = (t - from) / period
  if (u <= 0 || u >= cycles) return 0
  return 0.5 - 0.5 * Math.cos(2 * Math.PI * u)
}

export const DEMO_GUIDES: Array<{ id: string; label: string; guide: DemoGuide }> = [
  {
    id: 'jacks',
    label: 'Bật tách chân',
    guide: guide(6, (t) => {
      const s = pulse(t, 0.6, 1.2, 4)
      return {
        arms: { r: [8 + 157 * s, 5 + 165 * s], l: [8 + 157 * s, 5 + 165 * s] },
        legs: { r: 2 + 20 * s, l: 2 + 20 * s },
      }
    }),
  },
  {
    id: 'march',
    label: 'Bước đều',
    guide: guide(6, (t) => {
      const left = pulse(t, 0.6, 1.2, 4) > 0 && Math.floor((t - 0.6) / 1.2) % 2 === 0 ? pulse(t, 0.6, 1.2, 4) : 0
      const right = pulse(t, 0.6, 1.2, 4) > 0 && Math.floor((t - 0.6) / 1.2) % 2 === 1 ? pulse(t, 0.6, 1.2, 4) : 0
      return {
        kneeLift: { l: left, r: right },
        // The opposite arm swings forward with each knee.
        arms: { r: [8 + 30 * left, 5 + 60 * left], l: [8 + 30 * right, 5 + 60 * right] },
      }
    }),
  },
  {
    id: 'bend',
    label: 'Nghiêng người',
    guide: guide(6.5, (t) => {
      const lean = t > 0.6 && t < 5.9 ? 18 * Math.sin((2 * Math.PI * (t - 0.6)) / 2.65) : 0
      return { lean, arms: { r: [14, 8], l: [14, 8] } }
    }),
  },
  {
    id: 'wave',
    label: 'Giơ tay chào',
    guide: guide(5, (t) => {
      const up = Math.min(1, Math.max(0, (t - 0.5) / 0.8)) * Math.min(1, Math.max(0, (4.5 - t) / 0.8))
      const wave = t > 1.3 && t < 3.7 ? 18 * Math.sin(2 * Math.PI * (t - 1.3) * 1.25) : 0
      return { arms: { r: [8 + 142 * up, 5 + 150 * up + wave] } }
    }),
  },
]
