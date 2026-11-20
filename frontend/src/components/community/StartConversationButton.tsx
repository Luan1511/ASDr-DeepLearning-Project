import { useRef, useState, useEffect, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../lib/api'
import { useAuth } from '../../state/useAuth'
import { conversationError } from '../../lib/conversations'

export function StartConversationButton({ recipientId, displayName, postId, postTitle, trigger }: { recipientId: string; displayName: string; postId?: string; postTitle?: string; trigger?: ReactNode }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [content, setContent] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const requestId = useRef(crypto.randomUUID())
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { if (open) dialog.current?.showModal(); else dialog.current?.close() }, [open])
  if (!user || user.role !== 'USER' || user.doctor || recipientId === user.id || recipientId === 'anonymous') return null
  async function start() {
    setBusy(true); setError('')
    try {
      const { data } = await api.get(`/community/conversations/peer/${recipientId}`)
      if (data.conversationId && ['ACCEPTED','PENDING'].includes(data.status)) navigate(`/community/messages/${data.conversationId}`)
      else setOpen(true)
    } catch (failure) { setError(conversationError(failure)) }
    finally { setBusy(false) }
  }
  async function send() {
    if (!content.trim() || busy) return
    setBusy(true); setError('')
    try {
      const { data } = await api.post('/community/conversations', { recipientId, postId, content, clientRequestId: requestId.current })
      setOpen(false); navigate(`/community/messages/${data.conversationId}`)
    } catch (failure) { setError(conversationError(failure)) }
    finally { setBusy(false) }
  }
  return <span onClick={(event) => event.stopPropagation()}><button type="button" disabled={busy} aria-label={trigger ? `Nhắn riêng với ${displayName}` : undefined} title={trigger ? `Nhắn riêng với ${displayName}` : undefined} className={trigger ? "inline-flex flex-shrink-0 rounded-2xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-duo-green disabled:opacity-50" : "rounded-xl bg-duo-green-soft px-3 py-2 text-xs font-bold text-duo-green-dark"} onClick={() => void start()}>{trigger ?? <>Nhắn riêng</>}</button>{error && !open && <span role="alert" className="ml-2 text-xs text-red-700">{error}</span>}<dialog aria-label="Gửi lời mời trò chuyện" ref={dialog} onCancel={() => setOpen(false)} className="w-[calc(100%_-_2rem)] max-w-lg rounded-3xl p-6 shadow-xl backdrop:bg-black/40"><h2 className="text-lg font-black">Gửi lời mời cho {displayName}</h2>{postTitle && <p className="mt-2 text-sm text-duo-mute">Từ bài viết: {postTitle}</p>}<p className="mt-2 text-xs text-duo-mute">Người nhận chấp nhận lời mời rồi bạn mới có thể trò chuyện tiếp. Tránh đưa thông tin riêng tư của trẻ vào lời nhắn.</p><label className="mt-4 block text-sm font-bold">Lời nhắn giới thiệu<textarea autoFocus maxLength={500} rows={4} className="input-duo mt-2" value={content} onChange={(event) => { setContent(event.target.value); requestId.current = crypto.randomUUID() }} /></label>{error && <p role="alert" className="mt-2 text-xs text-red-700">{error}</p>}<div className="mt-4 flex justify-end gap-2"><button type="button" disabled={busy} className="btn-duo-secondary" onClick={() => setOpen(false)}>Hủy</button><button type="button" disabled={busy || !content.trim()} className="btn-duo" onClick={() => void send()}>{busy ? 'Đang gửi…' : 'Gửi lời mời'}</button></div></dialog></span>
}
