// The capture window runs on the audio thread and buffers at most one utterance.
const FRAME_MS = 20
const START_FRAMES = 5
const LEAD_FRAMES = 12
const SILENCE_FRAMES = 55
const TAIL_FRAMES = 9
const MAX_FRAMES = 600

class BuddyMicProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.frameSize = Math.round(sampleRate * FRAME_MS / 1000)
    this.frame = new Float32Array(this.frameSize)
    this.generation = 0
    this.noiseFloor = 0.003
    this.resetTurn()
    this.port.onmessage = ({ data }) => {
      this.generation = data
      this.resetTurn()
    }
  }

  resetTurn() {
    this.frames = []
    this.used = 0
    this.voiced = 0
    this.silence = 0
    this.speaking = false
  }

  acceptFrame(frame) {
    let energy = 0
    for (const sample of frame) energy += sample * sample
    const level = Math.sqrt(energy / frame.length)
    const threshold = this.speaking
      ? Math.max(0.008, 1.8 * this.noiseFloor)
      : Math.max(0.012, 2.8 * this.noiseFloor)
    const loud = level >= threshold
    this.frames.push(frame)

    if (!this.speaking) {
      if (this.frames.length > LEAD_FRAMES) this.frames.shift()
      this.voiced = loud ? this.voiced + 1 : 0
      if (!loud) this.noiseFloor = 0.97 * this.noiseFloor + 0.03 * level
      if (this.voiced >= START_FRAMES) {
        this.speaking = true
        this.port.postMessage({ type: 'speech', generation: this.generation })
      }
      return
    }

    this.silence = loud ? 0 : this.silence + 1
    if (this.silence < SILENCE_FRAMES && this.frames.length < MAX_FRAMES) return

    const generation = this.generation
    const trim = Math.max(0, this.silence - TAIL_FRAMES)
    const frames = this.frames.slice(0, this.frames.length - trim)
    this.generation = 0
    this.resetTurn()
    const endedAt = currentTime - trim * FRAME_MS / 1000
    this.port.postMessage({ type: 'turn', generation, frames, endedAt }, frames.map((part) => part.buffer))
  }

  process(inputs) {
    const input = inputs[0]?.[0]
    if (!input || !this.generation) return true
    let offset = 0
    while (offset < input.length && this.generation) {
      const count = Math.min(input.length - offset, this.frameSize - this.used)
      this.frame.set(input.subarray(offset, offset + count), this.used)
      this.used += count
      offset += count
      if (this.used === this.frameSize) {
        const completed = this.frame
        this.frame = new Float32Array(this.frameSize)
        this.used = 0
        this.acceptFrame(completed)
      }
    }
    // Outputs are left silent. The microphone is never routed to the speakers.
    return true
  }
}

registerProcessor('buddy-mic', BuddyMicProcessor)
