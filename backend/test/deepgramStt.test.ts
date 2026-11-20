import { afterEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { DeepgramError, deepgramListenUrl, deepgramTranscript, padWavSilence, transcribeWithDeepgram } from '../src/services/deepgramStt'

/** Mono 16-bit PCM WAV with the 44-byte header, as voiceWav() in the Bin page builds it. */
function wav(samples: number[], rate = 24000): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(44 + samples.length * 2)
  const v = new DataView(out.buffer)
  const tag = (at: number, s: string) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)))
  tag(0, 'RIFF'); v.setUint32(4, out.length - 8, true); tag(8, 'WAVE'); tag(12, 'fmt ')
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true)
  v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); tag(36, 'data')
  v.setUint32(40, samples.length * 2, true)
  samples.forEach((s, i) => v.setInt16(44 + 2 * i, s, true))
  return out
}

describe('padWavSilence', () => {
  it('adds the silence on both sides and fixes the sizes in the header', () => {
    const out = padWavSilence(wav([1000, -1000, 500]), 500)
    const v = new DataView(out.buffer)
    const pad = 12000
    assert.equal(out.length, 44 + 2 * (pad + 3 + pad))
    assert.equal(v.getUint32(4, true), out.length - 8)
    assert.equal(v.getUint32(40, true), 2 * (pad + 3 + pad))
    assert.equal(v.getInt16(44, true), 0)
    assert.deepEqual([0, 1, 2].map((i) => v.getInt16(44 + 2 * (pad + i), true)), [1000, -1000, 500])
    assert.equal(v.getInt16(out.length - 2, true), 0)
  })

  it('leaves anything that is not a plain mono 16-bit WAV unchanged', () => {
    const notWav = new Uint8Array(100).fill(7)
    assert.equal(padWavSilence(notWav), notWav)
    const stereo = wav([1, 2])
    new DataView(stereo.buffer).setUint16(22, 2, true)
    assert.equal(padWavSilence(stereo), stereo)
    const short = new Uint8Array(10)
    assert.equal(padWavSilence(short), short)
  })
})

const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
})

describe('Deepgram speech recognition', () => {
  it('always asks for Vietnamese and opts out of model improvement', () => {
    const url = new URL(deepgramListenUrl('nova-3'))
    assert.equal(url.origin + url.pathname, 'https://api.deepgram.com/v1/listen')
    assert.equal(url.searchParams.get('model'), 'nova-3')
    assert.equal(url.searchParams.get('language'), 'vi')
    assert.equal(url.searchParams.get('mip_opt_out'), 'true')
  })

  it('reads the first alternative and tolerates empty or odd answers', () => {
    const answer = { results: { channels: [{ alternatives: [{ transcript: ' Bin ơi, chơi trốn tìm đi! ' }, { transcript: 'khác' }] }] } }
    assert.equal(deepgramTranscript(answer), 'Bin ơi, chơi trốn tìm đi!')
    assert.equal(deepgramTranscript({ results: { channels: [{ alternatives: [{ transcript: '' }] }] } }), '')
    assert.equal(deepgramTranscript({ results: { channels: [] } }), '')
    assert.equal(deepgramTranscript(null), '')
    assert.equal(deepgramTranscript({ results: { channels: [{ alternatives: [{ transcript: 5 }] }] } }), '')
  })

  it('sends the audio with the key and content type, and returns the text', async () => {
    let seen: { url: string; init: RequestInit } | undefined
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      seen = { url, init }
      return new Response(JSON.stringify({ results: { channels: [{ alternatives: [{ transcript: 'con thích tàu hỏa' }] }] } }))
    }) as typeof fetch
    const text = await transcribeWithDeepgram(new Uint8Array([1, 2, 3]), 'audio/wav', {
      apiKey: 'test-key', model: 'nova-3', signal: new AbortController().signal,
    })
    assert.equal(text, 'con thích tàu hỏa')
    assert.equal(seen!.init.method, 'POST')
    const headers = seen!.init.headers as Record<string, string>
    assert.equal(headers.Authorization, 'Token test-key')
    assert.equal(headers['Content-Type'], 'audio/wav')
    assert.match(seen!.url, /mip_opt_out=true/)
  })

  it('reports the HTTP status of a failed request', async () => {
    globalThis.fetch = (async () => new Response('{"err_code":"INVALID_AUTH"}', { status: 401 })) as unknown as typeof fetch
    await assert.rejects(
      transcribeWithDeepgram(new Uint8Array([1]), 'audio/wav', { apiKey: 'bad', model: 'nova-3', signal: new AbortController().signal }),
      (error: unknown) => error instanceof DeepgramError && error.status === 401,
    )
  })
})
