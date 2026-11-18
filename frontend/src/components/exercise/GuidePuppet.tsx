import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { BuddyFigure, type BuddyFigureHandle } from '../buddy/BuddyFigure'
import { fitFigure } from '../../lib/buddy/figure'
import type { ExpressionName, HandShape } from '../../lib/buddy/types'
import type { GuideTemplateDto } from '../../lib/exerciseTypes'
import {
  buildPuppetTrack,
  cheerPose,
  idlePose,
  mirrorFrame,
  plantFeet,
  samplePose,
  shrugPose,
  usePrefersReducedMotion,
  type PuppetPose,
} from '../../lib/puppet'

export type GuidePuppetProps = {
  guide: Pick<GuideTemplateDto, 'hz' | 'joints' | 'frames' | 'neutral' | 'durationSec'>
  /** Plays the demonstration once from the start while true. */
  playing: boolean
  speed?: 0.75 | 1
  /** Face-to-face (mirror) presentation; default true. */
  mirrored?: boolean
  pose?: 'demo' | 'idle' | 'cheer' | 'shrug'
  /** Bin's reaction to the live coach while he demonstrates or waits. */
  mood?: 'neutral' | 'encourage' | 'happy'
  /** Accessible title of the exercise. */
  title: string
  /** CSS size of the square box (default 320). */
  size?: number
  onEnded?: () => void
}

const PROCEDURAL = { idle: idlePose, cheer: cheerPose, shrug: shrugPose } as const

/** One blink every few seconds (0 = open, 1 = closed). */
const BLINK_EVERY_SEC = 3.6
const BLINK_SEC = 0.16
function blinkAt(tSec: number) {
  const phase = tSec % BLINK_EVERY_SEC
  return phase < BLINK_SEC ? Math.sin((Math.PI * phase) / BLINK_SEC) : 0
}

function look(pose: NonNullable<GuidePuppetProps['pose']>, mood: NonNullable<GuidePuppetProps['mood']>) {
  let expression: ExpressionName = 'neutral'
  let hands: HandShape = 'relaxed'
  if (pose === 'cheer') {
    expression = 'proud'
    hands = 'open'
  } else if (pose === 'shrug') {
    expression = 'curious'
    hands = 'open'
  } else if (mood === 'happy') expression = 'happy'
  else if (mood === 'encourage') expression = 'encourage'
  return { expression, hands }
}

/**
 * The exercise guide "bạn Bin": the whole-body robot (BuddyFigure) driven by
 * the template's normalised skeleton (demo) or by procedural poses (idle,
 * cheer, shrug). `mirrored` (default) shows the demonstration face to face, as
 * the camera saw it. The template's face points are never used: Bin's own face
 * shows how he feels (`pose`, `mood`).
 */
export function GuidePuppet({
  guide,
  playing,
  speed = 1,
  mirrored = true,
  pose = 'demo',
  mood = 'neutral',
  title,
  size = 320,
  onEnded,
}: GuidePuppetProps) {
  const figure = useRef<BuddyFigureHandle>(null)
  const reducedMotion = usePrefersReducedMotion()
  const { hz, joints, frames, neutral } = guide
  const track = useMemo(() => buildPuppetTrack({ hz, joints, frames, neutral }), [hz, joints, frames, neutral])
  // One scale for the whole exercise (demonstration and waiting poses alike), so Bin never changes size on screen.
  const fit = useMemo(
    () =>
      fitFigure(
        [track.neutral, ...track.frames, cheerPose(track.neutral, 0.18, true), shrugPose(track.neutral, 0.5, true)].map((p) =>
          plantFeet(p, track.groundY),
        ),
        track.groundY,
      ),
    [track],
  )

  const onEndedRef = useRef(onEnded)
  useEffect(() => {
    onEndedRef.current = onEnded
  }, [onEnded])

  useLayoutEffect(() => {
    const bin = figure.current
    if (!bin) return
    const render = (p: PuppetPose) => bin.setPose(plantFeet(mirrored ? p : mirrorFrame(p), track.groundY), track.groundY)
    bin.setBlink(0)

    let raf = 0
    let startedAt: number | null = null
    if (pose === 'demo') {
      if (!playing) {
        render(samplePose(track, 0))
        return
      }
      render(samplePose(track, 0))
      const tick = (now: number) => {
        startedAt ??= now
        const elapsed = (now - startedAt) / 1000
        const t = elapsed * speed
        if (t >= track.durationSec) {
          render(track.frames[track.frames.length - 1])
          bin.setBlink(0)
          onEndedRef.current?.()
          return
        }
        render(samplePose(track, t))
        if (!reducedMotion) bin.setBlink(blinkAt(elapsed + 1))
        raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)
      return () => cancelAnimationFrame(raf)
    }

    const procedural = PROCEDURAL[pose]
    render(procedural(track.neutral, 0, false))
    if (reducedMotion) return
    const tick = (now: number) => {
      startedAt ??= now
      const elapsed = (now - startedAt) / 1000
      render(procedural(track.neutral, elapsed, true))
      // Happy eyes are already closed arcs; only open eyes blink.
      if (pose === 'idle') bin.setBlink(blinkAt(elapsed + 1))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [track, playing, speed, mirrored, pose, reducedMotion])

  const { expression, hands } = look(pose, mood)
  return (
    <BuddyFigure
      ref={figure}
      expression={expression}
      hands={hands}
      fit={fit}
      label={`Bạn Bin đang làm mẫu: ${title}`}
      className="block max-w-full"
      style={{ width: size, height: 'auto', aspectRatio: '1 / 1' }}
    />
  )
}
