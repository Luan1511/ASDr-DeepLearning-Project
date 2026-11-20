/**
 * Bin's speech recognition through Deepgram's pre-recorded API (Vietnamese).
 * Every request opts out of Deepgram's Model Improvement Program, so the
 * child's audio is kept only while it is being transcribed. Nothing is
 * stored here either.
 */
const LISTEN_URL = 'https://api.deepgram.com/v1/listen'

export class DeepgramError extends Error {
  constructor(readonly status: number) {
    super(`Deepgram HTTP ${status}`)
    this.name = 'DeepgramError'
  }
}

export function deepgramListenUrl(model: string): string {
  const params = new URLSearchParams({ model, language: 'vi', smart_format: 'true', mip_opt_out: 'true' })
  return `${LISTEN_URL}?${params}`
}

/** The best transcript of the first channel, or '' when nothing was recognised. */
export function deepgramTranscript(data: unknown): string {
  const channel = (data as { results?: { channels?: Array<{ alternatives?: Array<{ transcript?: unknown }> }> } } | null)
    ?.results?.channels?.[0]
  const text = channel?.alternatives?.[0]?.transcript
  return typeof text === 'string' ? text.trim() : ''
}

/**
 * Deepgram drops the first word, or returns nothing, when speech starts right
 * at the edge of the clip (measured 2026-11-20: 38 of 75 test clips empty
 * without padding, none with 0.5 s). Adds silence on both sides of a plain
 * 16-bit mono PCM WAV with the 44-byte header the Bin page sends; any other
 * input is returned unchanged.
 */
export const DEEPGRAM_PAD_MS = 500

export function padWavSilence(audio: Uint8Array<ArrayBuffer>, ms = DEEPGRAM_PAD_MS): Uint8Array<ArrayBuffer> {
  if (audio.length < 44) return audio
  const view = new DataView(audio.buffer, audio.byteOffset, audio.byteLength)
  const tag = (at: number) => String.fromCharCode(...audio.subarray(at, at + 4))
  const plain = tag(0) === 'RIFF' && tag(8) === 'WAVE' && tag(12) === 'fmt ' && view.getUint32(16, true) === 16
    && view.getUint16(20, true) === 1 && view.getUint16(22, true) === 1 && view.getUint16(34, true) === 16
    && tag(36) === 'data'
  if (!plain) return audio
  const rate = view.getUint32(24, true)
  const dataBytes = Math.min(view.getUint32(40, true), audio.length - 44)
  const pad = Math.round((rate * ms) / 1000) * 2
  const out = new Uint8Array(44 + pad + dataBytes + pad)
  out.set(audio.subarray(0, 44))
  out.set(audio.subarray(44, 44 + dataBytes), 44 + pad)
  const header = new DataView(out.buffer)
  header.setUint32(4, out.length - 8, true)
  header.setUint32(40, pad + dataBytes + pad, true)
  return out
}

export async function transcribeWithDeepgram(
  audio: Uint8Array<ArrayBuffer>,
  contentType: string,
  options: { apiKey: string; model: string; signal: AbortSignal },
): Promise<string> {
  const res = await fetch(deepgramListenUrl(options.model), {
    method: 'POST',
    headers: { Authorization: `Token ${options.apiKey}`, 'Content-Type': contentType },
    body: padWavSilence(audio),
    signal: options.signal,
  })
  if (!res.ok) {
    await res.body?.cancel()
    throw new DeepgramError(res.status)
  }
  return deepgramTranscript(await res.json())
}
