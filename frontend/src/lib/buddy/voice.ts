import { api } from '../api'

const PCM_SAMPLE_RATE = 48_000
const FIRST_BUFFER_BYTES = 9_600 // 100 ms of mono PCM16, enough to smooth small network stalls.

export async function buddyVoiceEnabled(signal: AbortSignal) {
  const { data } = await api.get<{ enabled: boolean }>('/buddy/voice', { signal })
  return data.enabled
}

export async function transcribeBuddyTurn(audio: Blob, signal: AbortSignal) {
  const { data } = await api.post<{ text: string }>('/buddy/voice/transcribe', audio, {
    headers: { 'Content-Type': audio.type },
    signal,
  })
  return data.text
}

export type BuddyMic = { setListening: (listening: boolean) => void }

type MicMessage = { generation: number } & ({ type: 'speech' } | { type: 'turn'; frames: Float32Array[]; endedAt: number })

export type BuddyVoiceTiming = { endedAt: number; frameMs: number; energy: number[] }

/** The worklet detects utterances locally. The input is disabled between turns. */
export async function openBuddyMic(
  context: AudioContext,
  signal: AbortSignal,
  events: { onSpeech: () => void; onTurn: (audio: Blob, timing: BuddyVoiceTiming) => void; onError: () => void },
): Promise<BuddyMic> {
  signal.throwIfAborted()
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    video: false,
  })
  const tracks = stream.getAudioTracks()
  tracks.forEach((track) => { track.enabled = false })
  let source: MediaStreamAudioSourceNode | undefined
  let node: AudioWorkletNode | undefined
  const cleanup = () => {
    signal.removeEventListener('abort', cleanup)
    tracks.forEach((track) => {
      track.removeEventListener('ended', events.onError)
      track.stop()
    })
    source?.disconnect()
    if (node) {
      node.removeEventListener('processorerror', events.onError)
      node.port.onmessage = null
      node.port.close()
      node.disconnect()
    }
  }
  signal.addEventListener('abort', cleanup, { once: true })

  try {
    signal.throwIfAborted()
    await context.audioWorklet.addModule(`${import.meta.env.BASE_URL}buddy-mic.worklet.js`)
    signal.throwIfAborted()
    if (!tracks.some((track) => track.readyState === 'live')) throw new Error('Microphone disconnected')

    source = context.createMediaStreamSource(stream)
    const processor = new AudioWorkletNode(context, 'buddy-mic', {
      channelCount: 1, channelCountMode: 'explicit', outputChannelCount: [1],
    })
    node = processor
    tracks.forEach((track) => track.addEventListener('ended', events.onError))
    processor.addEventListener('processorerror', events.onError)
    source.connect(processor).connect(context.destination)

    let nextGeneration = 0
    let generation = 0
    function setListening(listening: boolean) {
      if (signal.aborted) return
      generation = listening ? ++nextGeneration : 0
      processor.port.postMessage(generation)
      tracks.forEach((track) => { track.enabled = listening })
    }

    processor.port.onmessage = ({ data }: MessageEvent<MicMessage>) => {
      if (!generation || data.generation !== generation || signal.aborted) return
      if (data.type === 'speech') {
        events.onSpeech()
        return
      }
      setListening(false)
      events.onTurn(voiceWav(data.frames, context.sampleRate), {
        endedAt: performance.now() + (data.endedAt - context.currentTime) * 1000,
        frameMs: 1000 * data.frames[0].length / context.sampleRate,
        energy: data.frames.map(rms),
      })
    }
    return { setListening }
  } catch (error) {
    cleanup()
    throw error
  }
}

function voiceWav(frames: Float32Array[], inputRate: number) {
  const samples = new Float32Array(frames.reduce((count, frame) => count + frame.length, 0))
  let offset = 0
  for (const frame of frames) {
    samples.set(frame, offset)
    offset += frame.length
  }

  // Keep the 12-second maximum comfortably under the 1 MB upload limit.
  const stride = Math.ceil(inputRate / 24_000)
  const rate = Math.round(inputRate / stride)
  const count = Math.floor(samples.length / stride)
  const bytes = new ArrayBuffer(44 + count * 2)
  const header = new DataView(bytes)
  const tag = (position: number, value: string) => {
    for (let i = 0; i < value.length; i++) header.setUint8(position + i, value.charCodeAt(i))
  }
  tag(0, 'RIFF')
  header.setUint32(4, bytes.byteLength - 8, true)
  tag(8, 'WAVEfmt ')
  header.setUint32(16, 16, true)
  header.setUint16(20, 1, true) // PCM
  header.setUint16(22, 1, true) // Mono
  header.setUint32(24, rate, true)
  header.setUint32(28, rate * 2, true)
  header.setUint16(32, 2, true)
  header.setUint16(34, 16, true)
  tag(36, 'data')
  header.setUint32(40, count * 2, true)
  for (let i = 0; i < count; i++) {
    let sum = 0
    for (let j = 0; j < stride; j++) sum += samples[i * stride + j]
    const value = Math.max(-1, Math.min(1, sum / stride))
    header.setInt16(44 + 2 * i, Math.round(value * 32767), true)
  }
  return new Blob([bytes], { type: 'audio/wav' })
}

function rms(samples: Float32Array) {
  let sum = 0
  for (const sample of samples) sum += sample * sample
  return Math.sqrt(sum / samples.length)
}

export type VoiceStart = (readLevel: () => number) => void

/** Schedules PCM on Web Audio's clock and stops both playback and fetch on interruption. */
export async function speakBuddyLine(context: AudioContext, text: string, signal: AbortSignal, onStart: VoiceStart) {
  const { data } = await api.post<ReadableStream<Uint8Array>>('/buddy/voice/speak', { text }, {
    adapter: 'fetch',
    responseType: 'stream',
    signal,
  })
  const reader = data.getReader()
  const analyser = context.createAnalyser()
  analyser.fftSize = 512
  analyser.connect(context.destination)
  const waveform = new Float32Array(analyser.fftSize)
  const sources = new Set<AudioBufferSourceNode>()
  let nextStart = 0
  let startTimer = 0
  let pending: Uint8Array = new Uint8Array()
  let ended: Promise<void> | undefined
  const abort = () => {
    clearTimeout(startTimer)
    for (const source of sources) source.stop()
    void reader.cancel().catch(() => undefined)
  }
  signal.addEventListener('abort', abort, { once: true })

  function schedule(bytes: Uint8Array) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const count = Math.floor(view.byteLength / 2)
    if (!count) return
    const audio = context.createBuffer(1, count, PCM_SAMPLE_RATE)
    const samples = audio.getChannelData(0)
    for (let i = 0; i < count; i++) samples[i] = view.getInt16(i * 2, true) / 32768

    const source = context.createBufferSource()
    source.buffer = audio
    source.connect(analyser)
    sources.add(source)
    ended = new Promise((resolve) => {
      source.onended = () => {
        sources.delete(source)
        source.disconnect()
        resolve()
      }
    })
    const start = Math.max(nextStart, context.currentTime + 0.025)
    if (!nextStart) {
      startTimer = window.setTimeout(() => {
        if (!signal.aborted) onStart(() => {
          analyser.getFloatTimeDomainData(waveform)
          return Math.min(1, rms(waveform) * 6)
        })
      }, (start - context.currentTime) * 1000)
    }
    source.start(start)
    nextStart = start + audio.duration
  }

  try {
    signal.throwIfAborted()
    while (true) {
      const { value, done } = await reader.read()
      signal.throwIfAborted()
      if (done) break
      const combined = new Uint8Array(pending.length + value.length)
      combined.set(pending)
      combined.set(value, pending.length)
      const minimum = nextStart ? 3_840 : FIRST_BUFFER_BYTES
      if (combined.length < minimum) {
        pending = combined
        continue
      }
      const aligned = combined.length - combined.length % 2
      schedule(combined.subarray(0, aligned))
      pending = combined.slice(aligned)
    }
    schedule(pending)
    if (!ended) throw new Error('No audio returned')
    await ended
    signal.throwIfAborted()
  } finally {
    signal.removeEventListener('abort', abort)
    abort()
    analyser.disconnect()
    reader.releaseLock()
  }
}
