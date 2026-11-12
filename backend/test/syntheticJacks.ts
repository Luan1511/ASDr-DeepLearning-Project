import type { OpenPoseKeypointFrame } from '../src/services/openposeService'

/** Two visible, repeatable faults: the left arm and both feet stay still. */
export function syntheticJacks(faults: boolean) {
  const fps = 15
  const width = 960
  const height = 540
  const period = 1.2
  const lead = 1.2
  const active = 6 * period
  const syntheticFrames: OpenPoseKeypointFrame[] = Array.from({ length: 10 * fps }, (_, frame_index) => {
    const elapsed = frame_index / fps - lead
    const phase = elapsed >= 0 && elapsed < active ? (1 - Math.cos(2 * Math.PI * elapsed / period)) / 2 : 0
    const positions: Array<[number, number]> = [[0, 1.35], [0, 1]]
    for (const side of [-1, 1]) {
      const angle = faults && side === 1 ? 0 : phase * 2.5
      const shoulder = side * 0.33
      positions.push([shoulder, 1])
      for (const length of [0.48, 0.96]) {
        positions.push([shoulder + side * length * Math.sin(angle), 1 - length * Math.cos(angle)])
      }
    }
    positions.push([0, 0])
    for (const side of [-1, 1]) {
      const angle = faults ? 0 : phase * 0.52
      const hip = side * 0.2
      positions.push([hip, 0])
      for (const length of [0.75, 1.5]) {
        positions.push([hip + side * length * Math.sin(angle), -length * Math.cos(angle)])
      }
    }
    return {
      frame_index,
      people: [{
        person_id: 0,
        body25: positions.map(([x, y], id) => ({ id, x: 480 + 100 * x, y: 310 - 100 * y, confidence: 1 })),
      }],
    }
  })
  return { syntheticFrames, fps, width, height }
}
