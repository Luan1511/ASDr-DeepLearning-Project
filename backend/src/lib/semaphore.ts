/**
 * Minimal FIFO counting semaphore for limiting concurrent async work in this
 * process (e.g. OpenPose requests that would otherwise exhaust GPU memory).
 */
export class Semaphore {
  private active = 0
  private readonly waiters: Array<() => void> = []

  constructor(private readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error(`Semaphore capacity must be a positive integer, got ${capacity}`)
    }
  }

  get inFlight() {
    return this.active
  }

  get waiting() {
    return this.waiters.length
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire()
    try {
      return await task()
    } finally {
      this.release()
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.capacity) {
      this.active += 1
      return Promise.resolve()
    }
    return new Promise((resolve) => {
      this.waiters.push(() => {
        this.active += 1
        resolve()
      })
    })
  }

  private release() {
    this.active -= 1
    const next = this.waiters.shift()
    if (next) next()
  }
}
