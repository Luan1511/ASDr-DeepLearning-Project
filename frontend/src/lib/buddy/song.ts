import type { BuddySong } from './types'

/** Audio supplied by the team in public/buddy-music/<id>.mp3. */
export function buddySongUrl(song: BuddySong): string {
  return `${import.meta.env.BASE_URL}buddy-music/${song}.mp3`
}

export type SongResult = 'ended' | 'stopped' | 'failed'

/**
 * Plays one song to the end. Stops at once when `signal` aborts (the parent
 * pressed "Dừng nhạc", the child spoke or typed, the page was left).
 */
export function playBuddySong(song: BuddySong, signal: AbortSignal, volume = 0.9): Promise<SongResult> {
  if (signal.aborted) return Promise.resolve('stopped')
  return new Promise((resolve) => {
    const audio = new Audio(buddySongUrl(song))
    audio.volume = volume
    let settled = false
    const finish = (result: SongResult) => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', stop)
      audio.onended = null
      audio.onerror = null
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
      resolve(result)
    }
    const stop = () => finish('stopped')
    audio.onended = () => finish('ended')
    audio.onerror = () => finish('failed')
    signal.addEventListener('abort', stop, { once: true })
    audio.play().catch(() => finish(signal.aborted ? 'stopped' : 'failed'))
  })
}
