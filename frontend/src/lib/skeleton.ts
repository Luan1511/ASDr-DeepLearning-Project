/** OpenPose BODY_25 drawing helpers shared by skeleton views. */

export type Body25Joint = {
  id: number
  x: number
  y: number
  confidence: number
}

export type SkeletonFrame = {
  frame_index: number
  people: Array<{
    person_id: number
    body25: Body25Joint[]
  }>
}

export type VideoSize = { width?: number | null; height?: number | null } | null | undefined

/** Standard OpenPose BODY_25 limb pairs (keep in sync with the OpenPose docs). */
export const BODY25_PAIRS: Array<[number, number]> = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [1, 5],
  [5, 6],
  [6, 7],
  [1, 8],
  [8, 9],
  [9, 10],
  [10, 11],
  [8, 12],
  [12, 13],
  [13, 14],
  [0, 15],
  [15, 17],
  [0, 16],
  [16, 18],
  [14, 21],
  [14, 19],
  [19, 20],
  [11, 24],
  [11, 22],
  [22, 23],
]

export const MIN_JOINT_CONFIDENCE = 0.2

export type Viewport = {
  scale: number
  offsetX: number
  offsetY: number
  /** 'video' = real frame size known; 'bounds' = fitted to the skeleton's extent. */
  source: 'video' | 'bounds'
  frameWidth: number
  frameHeight: number
}

/**
 * Map image coordinates to the canvas with ONE uniform scale so skeletons are
 * never stretched. Uses the real video size when the ML server reports it,
 * otherwise fits the bounding box of all confident joints in the clip.
 */
export function computeViewport(frames: SkeletonFrame[], canvasWidth: number, canvasHeight: number, video?: VideoSize): Viewport {
  const fit = (w: number, h: number, x0: number, y0: number, source: Viewport['source']): Viewport => {
    const scale = Math.min(canvasWidth / w, canvasHeight / h)
    return {
      scale,
      offsetX: (canvasWidth - w * scale) / 2 - x0 * scale,
      offsetY: (canvasHeight - h * scale) / 2 - y0 * scale,
      source,
      frameWidth: w,
      frameHeight: h,
    }
  }

  if (video?.width && video?.height) return fit(video.width, video.height, 0, 0, 'video')

  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const frame of frames) {
    for (const person of frame.people ?? []) {
      for (const j of person.body25 ?? []) {
        if (j.confidence <= MIN_JOINT_CONFIDENCE || (j.x === 0 && j.y === 0)) continue
        minX = Math.min(minX, j.x)
        minY = Math.min(minY, j.y)
        maxX = Math.max(maxX, j.x)
        maxY = Math.max(maxY, j.y)
      }
    }
  }
  if (!Number.isFinite(minX)) return fit(1920, 1080, 0, 0, 'bounds')
  const pad = 0.08 * Math.max(maxX - minX, maxY - minY, 1)
  return fit(maxX - minX + 2 * pad, maxY - minY + 2 * pad, minX - pad, minY - pad, 'bounds')
}

function meanConfidence(person: SkeletonFrame['people'][number]) {
  const c = (person.body25 ?? []).map((j) => j.confidence)
  return c.length ? c.reduce((a, b) => a + b, 0) / c.length : 0
}

/** Draws every detected person; the most confident one (what ST-GCN analyses) is highlighted. */
export function drawSkeletonFrame(
  ctx: CanvasRenderingContext2D,
  frame: SkeletonFrame | null,
  viewport: Viewport,
  width: number,
  height: number,
) {
  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = '#07111d'
  ctx.fillRect(0, 0, width, height)

  if (viewport.source === 'video') {
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)'
    ctx.lineWidth = 1
    ctx.strokeRect(viewport.offsetX, viewport.offsetY, viewport.frameWidth * viewport.scale, viewport.frameHeight * viewport.scale)
  }

  if (!frame || !frame.people?.length) return

  const people = [...frame.people].sort((a, b) => meanConfidence(b) - meanConfidence(a))
  const tx = (x: number) => viewport.offsetX + x * viewport.scale
  const ty = (y: number) => viewport.offsetY + y * viewport.scale

  people.forEach((person, rank) => {
    const main = rank === 0
    const points = (person.body25 ?? []).filter((j) => j.confidence > MIN_JOINT_CONFIDENCE && (j.x !== 0 || j.y !== 0))
    const byId = new Map(points.map((j) => [j.id, j]))

    ctx.lineWidth = main ? 3 : 2
    ctx.strokeStyle = main ? '#6ee7b7' : 'rgba(148, 163, 184, 0.6)'
    for (const [a, b] of BODY25_PAIRS) {
      const start = byId.get(a)
      const end = byId.get(b)
      if (!start || !end) continue
      ctx.beginPath()
      ctx.moveTo(tx(start.x), ty(start.y))
      ctx.lineTo(tx(end.x), ty(end.y))
      ctx.stroke()
    }

    for (const joint of points) {
      ctx.beginPath()
      ctx.arc(tx(joint.x), ty(joint.y), main ? 4 : 3, 0, Math.PI * 2)
      ctx.fillStyle = !main ? 'rgba(148, 163, 184, 0.8)' : joint.confidence > 0.6 ? '#facc15' : '#7dd3fc'
      ctx.fill()
    }
  })
}
