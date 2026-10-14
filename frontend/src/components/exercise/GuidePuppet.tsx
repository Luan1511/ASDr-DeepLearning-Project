import { useEffect, useMemo, useRef } from 'react'
import type { GuideTemplateDto } from '../../lib/exerciseTypes'
import {
  J,
  buildPuppetTrack,
  cheerPose,
  idlePose,
  mirrorFrame,
  plantFeet,
  samplePose,
  shrugPose,
  usePrefersReducedMotion,
  type PuppetPose,
  type Vec,
} from '../../lib/puppet'

export type GuidePuppetProps = {
  guide: Pick<GuideTemplateDto, 'hz' | 'joints' | 'frames' | 'neutral' | 'durationSec'>
  /** Plays the demonstration once from the start while true. */
  playing: boolean
  speed?: 0.75 | 1
  /** Face-to-face (mirror) presentation; default true. */
  mirrored?: boolean
  pose?: 'demo' | 'idle' | 'cheer' | 'shrug'
  /** Accessible title of the exercise. */
  title: string
  /** CSS size of the square canvas box (default 320). */
  size?: number
  onEnded?: () => void
}

const BODY = '#22c55e'
const BODY_FAR = '#16a34a'
const OUTLINE = '#166534'
const FACE = '#14532D'
const CHEEK = 'rgba(244, 114, 182, 0.35)'
const SHADOW = 'rgba(22, 101, 52, 0.16)'

/** Visible height in torso lengths: room for raised arms, the sprout and a deep squat. */
const VIEW_HEIGHT_L = 4.2
/** Floor sits this far (L) above the bottom edge. */
const FLOOR_MARGIN_L = 0.3
const LEG_THICKNESS = 0.2
const ARM_THICKNESS = 0.15
const HEAD_RADIUS = 0.34
const HEAD_OFFSET = 0.55

type Frame = { size: number; groundY: number; scale: number }

function unit(v: Vec): Vec {
  const len = Math.hypot(v.x, v.y)
  return len > 1e-6 ? { x: v.x / len, y: v.y / len } : { x: 0, y: 1 }
}

function drawPuppet(ctx: CanvasRenderingContext2D, pose: PuppetPose, frame: Frame) {
  const { size, groundY, scale: s } = frame
  const floorPx = size - FLOOR_MARGIN_L * s
  const px = (p: Vec) => ({ x: size / 2 + p.x * s, y: floorPx - (p.y - groundY) * s })
  const outline = Math.max(1.5, 0.035 * s)

  ctx.clearRect(0, 0, size, size)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  // Ground shadow under the root.
  const root = px({ x: pose[J.midHip].x, y: groundY })
  ctx.fillStyle = SHADOW
  ctx.beginPath()
  ctx.ellipse(root.x, root.y, 0.7 * s, 0.12 * s, 0, 0, Math.PI * 2)
  ctx.fill()

  const limb = (ids: number[], thickness: number, color: string) => {
    const points = ids.map((id) => px(pose[id]))
    const path = () => {
      ctx.beginPath()
      ctx.moveTo(points[0].x, points[0].y)
      for (const p of points.slice(1)) ctx.lineTo(p.x, p.y)
    }
    path()
    ctx.strokeStyle = OUTLINE
    ctx.lineWidth = thickness * s + 2 * outline
    ctx.stroke()
    path()
    ctx.strokeStyle = color
    ctx.lineWidth = thickness * s
    ctx.stroke()
  }

  // The puppet's left side (screen right) is the far side: darker and drawn first.
  limb([J.lHip, J.lKnee, J.lAnkle], LEG_THICKNESS, BODY_FAR)
  limb([J.rHip, J.rKnee, J.rAnkle], LEG_THICKNESS, BODY)

  // Torso: rounded trapezoid from the shoulder pair to the hip pair.
  const corners = [J.rShoulder, J.lShoulder, J.lHip, J.rHip].map((id) => px(pose[id]))
  const round = 0.16 * s
  const torso = () => {
    ctx.beginPath()
    ctx.moveTo(corners[0].x, corners[0].y)
    for (const c of corners.slice(1)) ctx.lineTo(c.x, c.y)
    ctx.closePath()
  }
  torso()
  ctx.strokeStyle = OUTLINE
  ctx.lineWidth = round + 2 * outline
  ctx.stroke()
  torso()
  ctx.fillStyle = BODY
  ctx.strokeStyle = BODY
  ctx.lineWidth = round
  ctx.fill()
  ctx.stroke()

  drawHead(ctx, pose, px, s, outline)

  limb([J.lShoulder, J.lElbow, J.lWrist], ARM_THICKNESS, BODY_FAR)
  limb([J.rShoulder, J.rElbow, J.rWrist], ARM_THICKNESS, BODY)
}

/** Synthetic face and sprout, oriented along the torso; template face points are never used. */
function drawHead(
  ctx: CanvasRenderingContext2D,
  pose: PuppetPose,
  px: (p: Vec) => Vec,
  s: number,
  outline: number,
) {
  const neck = pose[J.neck]
  const up = unit({ x: neck.x - pose[J.midHip].x, y: neck.y - pose[J.midHip].y })
  const right = { x: up.y, y: -up.x }
  const at = (u: number, v: number): Vec => ({
    x: neck.x + right.x * u + up.x * (HEAD_OFFSET + v),
    y: neck.y + right.y * u + up.y * (HEAD_OFFSET + v),
  })
  const r = HEAD_RADIUS * s
  // Canvas rotation of the head's local axes (canvas y points down).
  const tilt = Math.atan2(-right.y, right.x)

  // Sprout: a stem and two leaves on top of the head.
  const stemBase = px(at(0, HEAD_RADIUS * 0.9))
  const stemTop = px(at(0, HEAD_RADIUS + 0.2))
  ctx.strokeStyle = OUTLINE
  ctx.lineWidth = Math.max(2, 0.05 * s)
  ctx.beginPath()
  ctx.moveTo(stemBase.x, stemBase.y)
  ctx.lineTo(stemTop.x, stemTop.y)
  ctx.stroke()
  for (const side of [-1, 1] as const) {
    const c = px(at(side * 0.12, HEAD_RADIUS + 0.24))
    ctx.beginPath()
    ctx.ellipse(c.x, c.y, 0.14 * s, 0.065 * s, tilt - side * 0.55, 0, Math.PI * 2)
    ctx.fillStyle = side < 0 ? BODY : BODY_FAR
    ctx.fill()
    ctx.lineWidth = outline
    ctx.strokeStyle = OUTLINE
    ctx.stroke()
  }

  const centre = px(at(0, 0))
  ctx.beginPath()
  ctx.arc(centre.x, centre.y, r, 0, Math.PI * 2)
  ctx.fillStyle = BODY
  ctx.fill()
  ctx.lineWidth = outline
  ctx.strokeStyle = OUTLINE
  ctx.stroke()

  for (const side of [-1, 1] as const) {
    const cheek = px(at(side * 0.2, -0.1))
    ctx.beginPath()
    ctx.arc(cheek.x, cheek.y, 0.055 * s, 0, Math.PI * 2)
    ctx.fillStyle = CHEEK
    ctx.fill()
    const eye = px(at(side * 0.12, 0.05))
    ctx.beginPath()
    ctx.arc(eye.x, eye.y, Math.max(1.5, 0.038 * s), 0, Math.PI * 2)
    ctx.fillStyle = FACE
    ctx.fill()
  }

  ctx.beginPath()
  for (let i = 0; i <= 12; i += 1) {
    const a = Math.PI * (1.15 + (0.7 * i) / 12)
    const p = px(at(0.13 * Math.cos(a), -0.02 + 0.11 * Math.sin(a)))
    if (i === 0) ctx.moveTo(p.x, p.y)
    else ctx.lineTo(p.x, p.y)
  }
  ctx.strokeStyle = FACE
  ctx.lineWidth = Math.max(1.5, 0.03 * s)
  ctx.stroke()
}

const PROCEDURAL = { idle: idlePose, cheer: cheerPose, shrug: shrugPose } as const

/**
 * The guide character "bạn Mầm": a canvas puppet driven by the template's
 * normalised skeleton (demo) or by procedural poses (idle, cheer, shrug).
 * `mirrored` (default) shows the demonstration face to face, as the camera saw it.
 */
export function GuidePuppet({
  guide,
  playing,
  speed = 1,
  mirrored = true,
  pose = 'demo',
  title,
  size = 320,
  onEnded,
}: GuidePuppetProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const reducedMotion = usePrefersReducedMotion()
  const { hz, joints, frames, neutral } = guide
  const track = useMemo(() => buildPuppetTrack({ hz, joints, frames, neutral }), [hz, joints, frames, neutral])

  const onEndedRef = useRef(onEnded)
  useEffect(() => {
    onEndedRef.current = onEnded
  }, [onEnded])

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(size * dpr)
    canvas.height = Math.round(size * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const frame: Frame = { size, groundY: track.groundY, scale: size / VIEW_HEIGHT_L }
    const render = (p: PuppetPose) => drawPuppet(ctx, plantFeet(mirrored ? p : mirrorFrame(p), track.groundY), frame)

    let raf = 0
    let startedAt: number | null = null
    if (pose === 'demo') {
      if (!playing) {
        render(samplePose(track, 0))
        return
      }
      const tick = (now: number) => {
        startedAt ??= now
        const t = ((now - startedAt) / 1000) * speed
        if (t >= track.durationSec) {
          render(track.frames[track.frames.length - 1])
          onEndedRef.current?.()
          return
        }
        render(samplePose(track, t))
        raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)
      return () => cancelAnimationFrame(raf)
    }

    const procedural = PROCEDURAL[pose]
    if (reducedMotion) {
      render(procedural(track.neutral, 0, false))
      return
    }
    const tick = (now: number) => {
      startedAt ??= now
      render(procedural(track.neutral, (now - startedAt) / 1000, true))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [track, playing, speed, mirrored, pose, size, reducedMotion])

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={`Bạn Mầm đang làm mẫu: ${title}`}
      width={size}
      height={size}
      className="block max-w-full"
      style={{ width: size, height: 'auto', aspectRatio: '1 / 1' }}
    />
  )
}
