import { useEffect } from 'react'

/** Poll only while visible, serialize requests, and back off after failures. */
export function useChatPolling(task: () => Promise<void>, interval: number) {
  useEffect(() => {
    let stopped = false
    let running = false
    let failures = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    async function tick() {
      clearTimeout(timer)
      if (stopped || running || document.hidden || !navigator.onLine) return
      running = true
      try { await task(); failures = 0 } catch { failures = Math.min(failures + 1, 4) }
      finally {
        running = false
        if (!stopped && !document.hidden) timer = setTimeout(tick, Math.min(interval * 2 ** failures, 60000))
      }
    }
    const resume = () => { if (!document.hidden) void tick(); else clearTimeout(timer) }
    document.addEventListener('visibilitychange', resume)
    window.addEventListener('online', resume)
    void tick()
    return () => { stopped = true; clearTimeout(timer); document.removeEventListener('visibilitychange', resume); window.removeEventListener('online', resume) }
  }, [task, interval])
}
