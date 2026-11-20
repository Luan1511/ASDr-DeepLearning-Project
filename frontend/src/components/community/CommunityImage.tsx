import { useEffect, useRef, useState } from 'react'
import { api } from '../../lib/api'

/** Fetch private community media through Axios so the user's bearer token is sent. */
export function CommunityImage({ url }: { url: string }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const [source, setSource] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    if (!('IntersectionObserver' in window)) {
      setVisible(true)
      return
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setVisible(true)
        observer.disconnect()
      }
    }, { rootMargin: '250px' })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!visible) return
    let cancelled = false
    let objectUrl: string | null = null
    // Older running servers return /api/community/...; Axios's baseURL
    // already includes /api, so keep the resource path relative to that base.
    const mediaPath = url.replace(/^\/api\/community\//, '/community/')
    setSource(null)
    setFailed(false)
    api.get<Blob>(mediaPath, { responseType: 'blob' }).then((response) => {
      if (cancelled) return
      objectUrl = URL.createObjectURL(response.data)
      setSource(objectUrl)
    }).catch(() => {
      if (!cancelled) setFailed(true)
    })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [url, visible])

  return (
    <div
      ref={containerRef}
      className="flex h-full min-h-0 w-full items-center justify-center overflow-hidden bg-duo-mist"
    >
      {source ? <a href={source} target="_blank" rel="noopener noreferrer" aria-label="Mở ảnh đầy đủ trong tab mới" className="block h-full w-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-duo-green"><img src={source} alt="Ảnh đính kèm bài viết" className="h-full w-full object-cover" /></a> : failed ? <span className="p-3 text-xs font-semibold text-duo-mute">Không tải được ảnh đính kèm.</span> : <span className="p-3 text-xs text-duo-mute">Đang tải ảnh…</span>}
    </div>
  )
}
