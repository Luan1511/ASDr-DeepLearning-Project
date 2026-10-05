/**
 * Synthetic BODY_25 walkers with known ground truth (cadence, step length,
 * speed, arm swing, asymmetry) for testing gaitFeatures.ts.
 */
import type { OpenPoseKeypointFrame } from '../src/services/openposeService'

export type WalkerOptions = {
  view?: 'side' | 'frontal'
  fps?: number
  durationSec?: number
  /** Left and right step durations in seconds (heel strike to heel strike). */
  leftStepSec?: number
  rightStepSec?: number
  legPx?: number
  /** Half of the maximal inter-ankle distance along the walking axis. */
  ankleAmplitudePx?: number
  armAmplitudePx?: number
  speedPxPerSec?: number
  direction?: 1 | -1
  trunkLeanDeg?: number
  /** Frontal view: growth of the body in the image over the clip (walking towards the camera). */
  scaleGrowth?: number
  noisePx?: number
  dropRate?: number
  extraPerson?: boolean
  heelRaisedPx?: number
  seed?: number
}

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Phase that hits a heel strike (|sin| = 1) at every step boundary. */
function phaseAt(t: number, left: number, right: number) {
  // Piece k runs from phase -π/2 + kπ to π/2 + kπ; even pieces end with the
  // left foot ahead (left step), odd pieces with the right foot ahead.
  let k = 0
  let start = 0
  for (;;) {
    const dur = k % 2 === 0 ? left : right
    if (t < start + dur) {
      const progress = (t - start) / dur
      return { phase: -Math.PI / 2 + (k + progress) * Math.PI, piece: k, progress }
    }
    start += dur
    k += 1
  }
}

export function makeWalker(options: WalkerOptions = {}): OpenPoseKeypointFrame[] {
  const o = {
    view: 'side' as const,
    fps: 30,
    durationSec: 6,
    leftStepSec: 0.4,
    rightStepSec: 0.4,
    legPx: 200,
    ankleAmplitudePx: 50,
    armAmplitudePx: 40,
    speedPxPerSec: 150,
    direction: 1 as const,
    trunkLeanDeg: 5,
    scaleGrowth: 0.3,
    noisePx: 0,
    dropRate: 0,
    extraPerson: false,
    heelRaisedPx: 0,
    seed: 7,
    ...options,
  }
  const rand = mulberry32(o.seed)
  const gauss = () => {
    const u = Math.max(rand(), 1e-9)
    const v = rand()
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }
  const n = Math.round(o.fps * o.durationSec)
  const frames: OpenPoseKeypointFrame[] = []
  const thigh = o.legPx / 2

  for (let i = 0; i < n; i += 1) {
    const t = i / o.fps
    const { phase, piece, progress } = phaseAt(t, o.leftStepSec, o.rightStepSec)
    const s = Math.sin(phase)
    const leftSwinging = piece % 2 === 0
    const lift = 12 * Math.sin(progress * Math.PI)
    const joints: Array<[number, number]> = new Array(25)

    if (o.view === 'side') {
      const d = o.direction
      const hipX = 300 + d * o.speedPxPerSec * t
      const hipY = 400
      const torso = 200
      const lean = (o.trunkLeanDeg * Math.PI) / 180
      const neckX = hipX + d * Math.sin(lean) * torso
      const neckY = hipY - Math.cos(lean) * torso
      const lAnkleX = hipX + d * o.ankleAmplitudePx * s
      const rAnkleX = hipX - d * o.ankleAmplitudePx * s
      const lAnkleY = hipY + o.legPx - (leftSwinging ? lift : 0)
      const rAnkleY = hipY + o.legPx - (!leftSwinging ? lift : 0)
      joints[0] = [neckX + d * 15, neckY - 40]
      joints[1] = [neckX, neckY]
      joints[2] = [neckX - 4, neckY + 8]
      joints[5] = [neckX + 4, neckY + 8]
      joints[3] = [neckX - 4 + d * (o.armAmplitudePx / 2) * s, neckY + 90]
      joints[4] = [neckX - 4 + d * o.armAmplitudePx * s, neckY + 180]
      joints[6] = [neckX + 4 - d * (o.armAmplitudePx / 2) * s, neckY + 90]
      joints[7] = [neckX + 4 - d * o.armAmplitudePx * s, neckY + 180]
      joints[8] = [hipX, hipY]
      joints[9] = [hipX - 3, hipY]
      joints[12] = [hipX + 3, hipY]
      joints[10] = [(hipX + rAnkleX) / 2 + d * 8, hipY + thigh]
      joints[13] = [(hipX + lAnkleX) / 2 + d * 8, hipY + thigh]
      joints[11] = [rAnkleX, rAnkleY]
      joints[14] = [lAnkleX, lAnkleY]
      joints[15] = [neckX + d * 20, neckY - 48]
      joints[16] = [neckX + d * 20, neckY - 48]
      joints[17] = [neckX + d * 5, neckY - 45]
      joints[18] = [neckX + d * 5, neckY - 45]
      const foot = (ax: number, ay: number): Array<[number, number]> => [
        [ax + d * 25, ay + 12], // big toe
        [ax + d * 22, ay + 12], // small toe
        [ax - d * 10, ay + 12 - o.heelRaisedPx], // heel
      ]
      ;[joints[19], joints[20], joints[21]] = foot(lAnkleX, lAnkleY)
      ;[joints[22], joints[23], joints[24]] = foot(rAnkleX, rAnkleY)
    } else {
      const scale = 1 + o.scaleGrowth * (t / o.durationSec)
      const cx = 640
      const cy = 360
      const P = (x: number, y: number): [number, number] => [cx + (x - cx) * scale, cy + (y - cy) * scale]
      const hipX = 640
      const hipY = 400
      const c = 20
      joints[0] = P(hipX, 160)
      joints[1] = P(hipX, 200)
      joints[2] = P(hipX - 70, 210)
      joints[5] = P(hipX + 70, 210)
      joints[3] = P(hipX - 80, 300)
      joints[6] = P(hipX + 80, 300)
      joints[4] = P(hipX - 85, 380)
      joints[7] = P(hipX + 85, 380)
      joints[8] = P(hipX, hipY)
      joints[9] = P(hipX - 35, hipY)
      joints[12] = P(hipX + 35, hipY)
      joints[10] = P(hipX - 32, hipY + thigh)
      joints[13] = P(hipX + 32, hipY + thigh)
      joints[11] = P(hipX - 30, hipY + o.legPx - c * s)
      joints[14] = P(hipX + 30, hipY + o.legPx + c * s)
      joints[15] = P(hipX - 12, 150)
      joints[16] = P(hipX + 12, 150)
      joints[17] = P(hipX - 25, 155)
      joints[18] = P(hipX + 25, 155)
      joints[19] = P(hipX + 32, hipY + o.legPx + 20)
      joints[20] = P(hipX + 40, hipY + o.legPx + 20)
      joints[21] = P(hipX + 30, hipY + o.legPx + 8)
      joints[22] = P(hipX - 32, hipY + o.legPx + 20)
      joints[23] = P(hipX - 40, hipY + o.legPx + 20)
      joints[24] = P(hipX - 30, hipY + o.legPx + 8)
    }

    const people: OpenPoseKeypointFrame['people'] = []
    if (rand() >= o.dropRate) {
      people.push({
        person_id: 0,
        body25: joints.map(([x, y], id) => ({
          id,
          x: x + o.noisePx * gauss(),
          y: y + o.noisePx * gauss(),
          confidence: 0.85,
        })),
      })
    }
    if (o.extraPerson) {
      // A still, very confident adult standing at the side of the frame.
      people.unshift({
        person_id: 1,
        body25: Array.from({ length: 25 }, (_, id) => ({
          id,
          x: 1700 + (id % 3) * 10,
          y: 100 + id * 25,
          confidence: 0.95,
        })),
      })
    }
    frames.push({ frame_index: i, people })
  }
  return frames
}
