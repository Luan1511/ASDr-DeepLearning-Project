import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { DashboardLayout } from '../layouts/DashboardLayout'
import { api } from '../lib/api'
import { conversationError, type Conversation, type DirectMessage } from '../lib/conversations'
import { useChatPolling } from '../lib/useChatPolling'
import { useAuth } from '../state/useAuth'
import { BlockedMembersPanel } from '../components/community/BlockedMembersPanel'
import { BlockMemberAction } from '../components/community/BlockMemberAction'

const statusLabels: Record<string, string> = { PENDING: 'Chờ chấp nhận', ACCEPTED: 'Đang trò chuyện', DECLINED: 'Đã từ chối', CANCELLED: 'Đã hủy' }
function mergeMessages(old: DirectMessage[], incoming: DirectMessage[]) { return [...new Map([...old, ...incoming].map((message) => [message.id, message])).values()].sort((a,b) => a.seq - b.seq) }
export function CommunityMessagesPage() {
  const { id = '' } = useParams()
  return <DashboardLayout><MessagesScreen key={id} id={id} /></DashboardLayout>
}
function MessagesScreen({ id }: { id: string }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [tab, setTab] = useState<'chats' | 'requests'>('chats')
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(0)
  const [rows, setRows] = useState<Conversation[]>([])
  const [conversation, setConversation] = useState<Conversation | null>(null)
  const [messages, setMessages] = useState<DirectMessage[]>([])
  const [cursor, setCursor] = useState<number | null>(null)
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [detailError, setDetailError] = useState('')
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState<{ content: string; clientRequestId: string } | null>(null)
  const [report, setReport] = useState<DirectMessage | null>(null)
  const [reason, setReason] = useState('HARASSMENT')
  const [details, setDetails] = useState('')
  const reportDialog = useRef<HTMLDialogElement>(null)
  const alive = useRef(true)
  const firstLoad = useRef(true)
  const lastReceivedSeq = useRef<number | null>(null)
  const bottom = useRef<HTMLDivElement>(null)
  const scrollArea = useRef<HTMLDivElement>(null)
  const readSeq = useRef(0)
  const listRequest = useRef(0)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => { if (report) reportDialog.current?.showModal(); else reportDialog.current?.close() }, [report])
  const loadList = useCallback(async () => {
    const request = ++listRequest.current
    try { const { data } = await api.get('/community/conversations', { params: { tab, page } }); if (alive.current && request === listRequest.current) { setRows(data.conversations); setPages(data.totalPages); setLoaded(true); setError('') } }
    catch (failure) { if (alive.current && request === listRequest.current) { setError(conversationError(failure)); setLoaded(true) }; throw failure }
  }, [tab, page])
  const loadMessages = useCallback(async () => {
    if (!id) return
    try {
      const [summary, result] = await Promise.all([api.get(`/community/conversations/${id}`), api.get(`/community/conversations/${id}/messages`)])
      if (!alive.current) return
      // Catch up after a long hidden/offline interval, even when more than one page arrived.
      let caughtUp: DirectMessage[] = []
      let after = lastReceivedSeq.current
      while (after !== null && alive.current) {
        const { data } = await api.get(`/community/conversations/${id}/messages`, { params: { after } })
        caughtUp = [...caughtUp, ...data.messages]
        after = data.nextAfter
      }
      if (!alive.current) return
      setConversation(summary.data.conversation)
      setMessages((old) => mergeMessages(old, [...result.data.messages, ...caughtUp]))
      const newest: DirectMessage | undefined = caughtUp.at(-1) ?? result.data.messages.at(-1)
      if (newest) lastReceivedSeq.current = newest.seq
      if (firstLoad.current) { setCursor(result.data.nextCursor); firstLoad.current = false; setTimeout(() => bottom.current?.scrollIntoView({ block: 'nearest' }), 50) }
      setDetailError('')
    } catch (failure) { if (alive.current) setDetailError(conversationError(failure)); throw failure }
  }, [id])
  useChatPolling(loadList, 15000)
  useChatPolling(loadMessages, 3000)
  useEffect(() => {
    const refresh = () => { void loadMessages().catch(() => undefined); void loadList().catch(() => undefined) }
    window.addEventListener('community-blocks-changed', refresh)
    return () => window.removeEventListener('community-blocks-changed', refresh)
  }, [loadMessages, loadList])
  useEffect(() => {
    const root = scrollArea.current
    if (!root || !id) return
    let timer: ReturnType<typeof setTimeout>
    const markVisible = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        if (document.hidden) return
        const bounds = root.getBoundingClientRect()
        const visible = messages.filter((message) => {
          const node = root.querySelector(`[data-message-id="${message.id}"]`)
          if (!node) return false
          const rect = node.getBoundingClientRect()
          return rect.bottom > Math.max(bounds.top, 0) && rect.top < Math.min(bounds.bottom, window.innerHeight)
        }).at(-1)
        if (!visible || visible.seq <= readSeq.current) return
        void api.patch(`/community/conversations/${id}/read`, { messageId: visible.id }).then(() => { readSeq.current = Math.max(readSeq.current, visible.seq) }).catch(() => undefined)
      }, 200)
    }
    root.addEventListener('scroll', markVisible)
    document.addEventListener('visibilitychange', markVisible)
    markVisible()
    return () => { clearTimeout(timer); root.removeEventListener('scroll', markVisible); document.removeEventListener('visibilitychange', markVisible) }
  }, [messages, id])
  async function older() {
    if (!cursor || busy) return
    setBusy(true)
    try { const { data } = await api.get(`/community/conversations/${id}/messages`, { params: { before: cursor } }); if (alive.current) { setMessages((old) => mergeMessages(old, data.messages)); setCursor(data.nextCursor) } }
    catch (failure) { setDetailError(conversationError(failure)) }
    finally { setBusy(false) }
  }
  async function send(retry = false) {
    if (busy || (!retry && !text.trim())) return
    const input = retry && failed ? failed : { content: text.trim(), clientRequestId: crypto.randomUUID() }
    setBusy(true); setDetailError('')
    try {
      const { data } = await api.post(`/community/conversations/${id}/messages`, input)
      if (!alive.current) return
      setMessages((old) => mergeMessages(old, [data.message])); setText(''); setFailed(null)
      await loadList().catch(() => undefined); setTimeout(() => bottom.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 50)
    } catch (failure) { if (alive.current) { setFailed(input); setDetailError(conversationError(failure)) } }
    finally { if (alive.current) setBusy(false) }
  }
  async function act(action: string) {
    setBusy(true)
    try { await api.post(`/community/conversations/${id}/action`, { action }); await loadMessages(); await loadList() }
    catch (failure) { setDetailError(conversationError(failure)) }
    finally { setBusy(false) }
  }
  async function submitReport() {
    if (!report) return
    setBusy(true)
    try { await api.post(`/community/conversations/${id}/messages/${report.id}/report`, { reason, details }); setReport(null); setDetailError('Đã gửi báo cáo tới quản trị viên.') }
    catch (failure) { setDetailError(conversationError(failure)) }
    finally { setBusy(false) }
  }
  return <div className="space-y-4"><div className="flex items-center justify-between gap-3"><h1 className="text-2xl font-black text-duo-ink">Tin nhắn Cộng đồng</h1><Link to="/community" className="link-duo text-xs">Về Cộng đồng</Link></div>
    <BlockedMembersPanel />
    <div className="grid min-h-[65vh] gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
      <aside className={`card-duo space-y-3 p-4 ${id ? 'hidden lg:block' : ''}`} aria-label="Danh sách hội thoại">
        <div className="flex gap-2">{(['chats','requests'] as const).map((value) => <button type="button" key={value} aria-pressed={tab === value} className={tab === value ? 'btn-duo !px-3 !py-2 text-xs' : 'btn-duo-secondary !px-3 !py-2 text-xs'} onClick={() => { setTab(value); setPage(1) }}>{value === 'chats' ? 'Trò chuyện' : 'Lời mời'}</button>)}</div>
        {error && <p role="alert" className="text-xs text-red-700">{error}<button className="ml-2 underline" onClick={() => void loadList().catch(() => undefined)}>Thử lại</button></p>}
        {!loaded && <p role="status" className="text-sm">Đang tải…</p>}
        {loaded && !error && rows.length === 0 && <p className="py-6 text-sm text-duo-mute">{tab === 'chats' ? 'Chưa có cuộc trò chuyện. Bạn có thể gửi lời mời từ một bài viết phù hợp.' : 'Chưa có lời mời.'}</p>}
        {rows.map((row) => <Link key={row.id} to={`/community/messages/${row.id}`} className={`block rounded-xl p-3 ${row.id === id ? 'bg-duo-green-soft' : 'bg-duo-mist'}`}><span className="flex justify-between gap-2 text-sm font-bold">{row.peer.displayName}{row.unread > 0 && <span aria-label={`${row.unread} tin chưa đọc`} className="rounded-full bg-duo-green px-2 text-white">{row.unread}</span>}</span><p className="mt-1 truncate text-xs text-duo-mute">{row.lastMessage?.hidden ? 'Tin nhắn đã được ẩn' : row.lastMessage?.content}</p><p className="mt-1 text-[11px] text-duo-mute">{statusLabels[row.status]} · {new Date(row.updatedAt).toLocaleDateString('vi-VN')}</p></Link>)}
        {pages > 1 && <div className="flex justify-between text-xs"><button disabled={page === 1} onClick={() => setPage((value) => value - 1)}>Trước</button><span>{page}/{pages}</span><button disabled={page >= pages} onClick={() => setPage((value) => value + 1)}>Sau</button></div>}
      </aside>
      <section className={`card-duo flex min-w-0 flex-col p-4 ${!id ? 'hidden lg:flex' : ''}`} aria-label="Cuộc trò chuyện">
        {!id && <p className="m-auto text-sm text-duo-mute">Chọn một cuộc trò chuyện để bắt đầu.</p>}
        {id && <button type="button" className="mb-3 text-left text-xs font-bold text-duo-green-dark lg:hidden" onClick={() => navigate('/community/messages')}>← Hộp thư</button>}
        {detailError && <p role="status" className="mb-3 rounded-xl bg-amber-50 p-3 text-xs text-amber-900">{detailError}</p>}
        {id && !conversation && !detailError && <p role="status">Đang tải cuộc trò chuyện…</p>}
        {conversation && <><span className="sr-only" aria-live="polite">{messages.length} tin nhắn đã tải.</span><header className="flex items-center justify-between gap-2 border-b border-duo-line pb-3"><div><h2 className="font-black">{conversation.peer.displayName}</h2><p className="text-xs text-duo-mute">{statusLabels[conversation.status]}</p></div><BlockMemberAction memberId={conversation.peer.id} displayName={conversation.peer.displayName} blocked={conversation.blockedByMe} onChanged={(blocked) => setConversation((current) => current ? { ...current, blockedByMe: blocked, unavailable: blocked || current.unavailable } : current)} /></header>
          {conversation.sourcePost && <Link to={`/community/post/${conversation.sourcePost.id}`} className="mt-2 rounded-xl bg-duo-mist p-2 text-xs">Từ bài viết: {conversation.sourcePost.title}</Link>}
          <div ref={scrollArea} className="my-3 flex max-h-[52vh] min-h-48 flex-1 flex-col gap-3 overflow-y-auto p-1" aria-label="Lịch sử tin nhắn">
            {cursor && <button type="button" disabled={busy} onClick={() => void older()} className="self-center text-xs font-bold text-duo-green-dark">Tải tin cũ hơn</button>}
            {messages.map((message) => <div key={message.id} data-message-id={message.id} className={`max-w-[85%] rounded-2xl p-3 ${message.senderId === user?.id ? 'self-end bg-duo-green-soft' : 'self-start bg-duo-mist'}`}><p className="whitespace-pre-wrap break-words text-sm">{message.hidden ? 'Tin nhắn đã được quản trị viên ẩn' : message.content}</p><p className="mt-1 text-[10px] text-duo-mute">{new Date(message.createdAt).toLocaleString('vi-VN')}</p>{message.senderId !== user?.id && !message.hidden && <button className="mt-1 text-[10px] font-bold text-duo-mute" onClick={() => { setReason('HARASSMENT'); setDetails(''); setDetailError(''); setReport(message) }}>Báo cáo</button>}</div>)}<div ref={bottom} />
          </div>
          {conversation.unavailable ? <p className="rounded-xl bg-duo-mist p-3 text-xs">Hiện không thể gửi tin trong cuộc trò chuyện này.</p> : conversation.status === 'PENDING' ? <div className="rounded-xl bg-duo-mist p-3"><p className="mb-2 text-sm">{conversation.isInviter ? 'Chờ người nhận chấp nhận lời mời.' : 'Bạn muốn trò chuyện với thành viên này?'}</p><div className="flex gap-2">{conversation.isInviter ? <button className="btn-duo-secondary" disabled={busy} onClick={() => void act('CANCEL')}>Hủy lời mời</button> : <><button className="btn-duo" disabled={busy} onClick={() => void act('ACCEPT')}>Chấp nhận</button><button className="btn-duo-secondary" disabled={busy} onClick={() => void act('DECLINE')}>Từ chối</button></>}</div></div> : conversation.status !== 'ACCEPTED' ? <p className="text-xs text-duo-mute">Lời mời đã đóng. Người nhận lời mời có thể chủ động kết nối lại từ hồ sơ thành viên.</p> : <form onSubmit={(event) => { event.preventDefault(); void send() }} className="space-y-2"><label className="sr-only" htmlFor="direct-message">Tin nhắn</label><textarea id="direct-message" className="input-duo" rows={3} maxLength={2000} placeholder="Nhập tin nhắn…" value={text} disabled={busy || Boolean(failed)} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); if (!failed) void send() } }} /><div className="flex items-center justify-between"><span className="text-xs text-duo-mute">{busy ? 'Đang gửi…' : `${text.length}/2.000`}</span>{failed ? <div className="flex gap-2"><button type="button" className="btn-duo-secondary" disabled={busy} onClick={() => setFailed(null)}>Chỉnh sửa</button><button type="button" className="btn-duo" disabled={busy} onClick={() => void send(true)}>Gửi lại</button></div> : <button className="btn-duo" disabled={busy || !text.trim()}>Gửi</button>}</div></form>}
          <Link to={`/community/member/${conversation.peer.id}`} className="mt-3 text-xs font-bold text-duo-green-dark">Hồ sơ thành viên</Link>
        </>}
      </section>
    </div>
    <dialog aria-label="Báo cáo tin nhắn" ref={reportDialog} onCancel={() => setReport(null)} className="w-[calc(100%_-_2rem)] max-w-lg rounded-3xl p-6 backdrop:bg-black/40"><h2 className="font-black">Báo cáo tin nhắn</h2><p className="mt-2 text-sm">Quản trị viên sẽ nhận bản sao tin nhắn này và lý do bạn báo cáo.</p><blockquote className="my-3 whitespace-pre-wrap break-words rounded-xl bg-duo-mist p-3 text-sm">{report?.content}</blockquote><label className="block text-sm">Lý do<select className="input-duo mt-1" value={reason} onChange={(event) => setReason(event.target.value)}><option value="HARASSMENT">Quấy rối</option><option value="PRIVACY">Vi phạm riêng tư</option><option value="MISINFORMATION">Thông tin sai lệch</option><option value="SPAM">Spam</option><option value="OTHER">Khác</option></select></label><label className="mt-3 block text-sm">Mô tả thêm<textarea className="input-duo mt-1" maxLength={500} value={details} onChange={(event) => setDetails(event.target.value)} /></label>{detailError && <p role="alert" className="mt-2 text-xs text-red-700">{detailError}</p>}<div className="mt-4 flex justify-end gap-2"><button className="btn-duo-secondary" disabled={busy} onClick={() => setReport(null)}>Hủy</button><button className="btn-duo" disabled={busy} onClick={() => void submitReport()}>Gửi báo cáo</button></div></dialog>
  </div>
}
