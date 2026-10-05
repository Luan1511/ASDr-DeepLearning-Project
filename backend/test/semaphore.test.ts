import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Semaphore } from '../src/lib/semaphore'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function maxConcurrency(capacity: number, tasks: number) {
  const gate = new Semaphore(capacity)
  let active = 0
  let peak = 0
  const order: number[] = []
  await Promise.all(
    Array.from({ length: tasks }, (_, i) =>
      gate.run(async () => {
        active += 1
        peak = Math.max(peak, active)
        await sleep(10)
        order.push(i)
        active -= 1
      }),
    ),
  )
  return { peak, order }
}

describe('Semaphore', () => {
  it('serialises work at capacity 1 in FIFO order', async () => {
    const { peak, order } = await maxConcurrency(1, 4)
    assert.equal(peak, 1)
    assert.deepEqual(order, [0, 1, 2, 3])
  })

  it('allows up to `capacity` tasks in parallel', async () => {
    const { peak } = await maxConcurrency(2, 6)
    assert.equal(peak, 2)
  })

  it('releases the slot when a task throws', async () => {
    const gate = new Semaphore(1)
    await assert.rejects(gate.run(async () => Promise.reject(new Error('boom'))))
    assert.equal(await gate.run(async () => 'ok'), 'ok')
    assert.equal(gate.inFlight, 0)
  })
})
