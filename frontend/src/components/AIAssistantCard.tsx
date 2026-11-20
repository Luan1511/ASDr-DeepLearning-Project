import { useState, useRef, useEffect, useId } from 'react'
import { Link } from 'react-router-dom'
import { useChatHistory } from '../lib/useChatHistory'
import { useAuth } from '../state/useAuth'
import { Bot, Send, History, Plus, Maximize2, BookOpen, ChevronDown, X } from 'lucide-react'
import { ChatMessageContent } from './ChatMessageContent'

const quick = ['ASD là gì?', 'Dấu hiệu sớm?', 'Cách sàng lọc?']
type Variant = 'card' | 'page'

export function AIAssistantCard({ variant = 'card' }: { variant?: Variant }) {
  const { user } = useAuth()
  return user ? <ChatCard key={user.id} userId={user.id} variant={variant} /> : null
}

function ChatCard({ userId, variant }: { userId: string; variant: Variant }) {
  const chat = useChatHistory(userId)
  const { messages, busy, error } = chat
  const [input, setInput] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const historyId = useId()
  const scrollRef = useRef<HTMLDivElement>(null)
  const lastRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const loading = busy !== null
  const sending = busy === 'send'
  const page = variant === 'page'
  const lastMessageId = messages[messages.length - 1]?.id
  const lastRole = messages[messages.length - 1]?.role

  useEffect(() => {
    const viewport = scrollRef.current
    const last = lastRef.current
    if (!viewport || !last) return
    // New answers open at their beginning, rather than at the source list.
    viewport.scrollTop = lastRole === 'assistant'
      ? viewport.scrollTop + last.getBoundingClientRect().top - viewport.getBoundingClientRect().top - 16
      : viewport.scrollHeight
  }, [lastMessageId, lastRole, sending])

  useEffect(() => {
    if (!showHistory) return
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setShowHistory(false) }
    document.addEventListener('keydown', close)
    return () => document.removeEventListener('keydown', close)
  }, [showHistory])

  async function send(text: string) {
    if (!text.trim() || loading) return
    setInput('')
    const saved = await chat.send(text)
    if (!saved) setInput(text)
    inputRef.current?.focus()
  }

  return (
    <section aria-label="Trợ lý AI" className={`card-duo relative flex min-h-0 flex-col overflow-hidden ${page ? 'h-full' : 'h-[620px]'}`}>
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-duo-line px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-duo-green-soft text-duo-green-dark"><Bot className="h-5 w-5" /></div>
          <div className="min-w-0">
            <h1 className="text-base font-extrabold text-duo-ink">Trợ lý AI</h1>
            <p className="text-xs text-duo-mute">Tìm hiểu ASD và chăm sóc trẻ</p>
          </div>
        </div>
        {!page && <Link to="/assistant" aria-label="Mở hội thoại đầy đủ" title="Mở hội thoại đầy đủ" className="rounded-lg p-2 text-duo-green-dark hover:bg-duo-green-soft"><Maximize2 className="h-4 w-4" /></Link>}
      </header>

      <div className="flex shrink-0 items-center gap-2 border-b border-duo-line px-3 py-2">
        <button type="button" onClick={() => setShowHistory((value) => !value)} aria-expanded={showHistory} aria-controls={historyId} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-2 text-sm font-bold text-duo-green-dark hover:bg-duo-mist"><History className="h-4 w-4" /><span>Lịch sử chat</span></button>
        <span className="min-w-0 flex-1 truncate text-xs text-duo-mute" title={chat.current?.title}>{page ? chat.current?.title : ''}</span>
        <button type="button" disabled={loading} onClick={() => { chat.newChat(); setInput(''); setShowHistory(false) }} className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-2 text-sm font-bold text-duo-green-dark hover:bg-duo-mist disabled:opacity-50"><Plus className="h-4 w-4" />Chat mới</button>
      </div>

      {showHistory && <>
        <button type="button" aria-label="Đóng lịch sử" onClick={() => setShowHistory(false)} className="absolute inset-0 z-20 bg-black/10" />
        <div id={historyId} className="absolute inset-x-3 top-16 z-30 max-h-[70%] overflow-y-auto rounded-2xl border border-duo-line bg-white p-3 shadow-card md:right-auto md:w-80">
          <div className="mb-2 flex items-center justify-between"><p className="text-sm font-extrabold">Lịch sử trò chuyện</p><button type="button" aria-label="Đóng bảng lịch sử" onClick={() => setShowHistory(false)} className="rounded-lg p-2 hover:bg-duo-mist"><X className="h-4 w-4" /></button></div>
          {!chat.conversations.length && <p className="px-2 py-3 text-sm text-duo-mute">{busy === 'initial' ? 'Đang tải lịch sử…' : 'Chưa có cuộc trò chuyện nào được lưu.'}</p>}
          {chat.conversations.map((conversation) => <button key={conversation.id} type="button" disabled={loading} aria-pressed={conversation.id === chat.current?.id}
            onClick={() => { void chat.openChat(conversation.id); setInput(''); setShowHistory(false) }}
            className={`mb-1 block w-full rounded-xl px-3 py-2.5 text-left hover:bg-duo-mist disabled:opacity-50 ${conversation.id === chat.current?.id ? 'bg-duo-green-soft' : ''}`}>
            <span className="block truncate text-sm font-bold">{conversation.title}</span>
            <span className="mt-1 block text-xs text-duo-mute">{new Date(conversation.updatedAt).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
          </button>)}
          {chat.nextCursor && <button type="button" disabled={loading} onClick={() => void chat.moreConversations()} className="mt-2 px-2 py-2 text-sm font-bold text-duo-green-dark">{busy === 'list' ? 'Đang tải…' : 'Xem thêm cuộc trò chuyện'}</button>}
        </div>
      </>}

      <div ref={scrollRef} data-chat-scroll className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-duo-mist/50 px-4 py-5">
        <div className={`mx-auto space-y-5 ${page ? 'max-w-3xl' : ''}`}>
          {(busy === 'initial' || busy === 'open') && <p role="status" className="text-sm text-duo-mute">Đang tải cuộc trò chuyện…</p>}
          {!messages.length && !loading && <div className={`text-center ${page ? 'py-12 md:py-20' : 'py-8'}`}>
            <Bot className="mx-auto mb-4 h-10 w-10 text-duo-green" />
            <h2 className="mb-2 text-lg font-extrabold text-duo-ink">Mình có thể hỗ trợ gì cho bạn?</h2>
            <p className="mx-auto max-w-md text-sm leading-6 text-duo-mute">Bạn có thể hỏi về tự kỷ, các dấu hiệu sớm hoặc cách hỗ trợ trẻ trong sinh hoạt hằng ngày.</p>
          </div>}
          {chat.nextBefore !== null && <button type="button" disabled={loading} onClick={() => void chat.olderMessages()} className="w-full py-2 text-sm font-bold text-duo-green-dark">{busy === 'older' ? 'Đang tải…' : 'Xem tin nhắn cũ hơn'}</button>}
          {messages.map((message, index) => <div key={message.id} ref={index === messages.length - 1 ? lastRef : undefined}>
            <p className={`mb-1.5 text-xs font-bold text-duo-mute ${message.role === 'user' ? 'text-right' : ''}`}>{message.role === 'user' ? 'Bạn' : 'AIMBRACE'}</p>
            <div className={message.role === 'user'
              ? 'ml-auto w-fit max-w-[90%] whitespace-pre-wrap break-words rounded-2xl rounded-tr-sm bg-duo-green-soft px-4 py-3 text-[15px] leading-7 text-duo-green-dark'
              : 'min-w-0 rounded-2xl rounded-tl-sm border border-duo-line/70 bg-white px-4 py-4 text-duo-ink'}>
              {message.role === 'assistant' ? <ChatMessageContent content={message.content} /> : message.content}
              {message.role === 'assistant' && !message.sources?.length && /\[\d+\]/.test(message.content) && <p className="mt-3 border-t pt-3 text-xs leading-5 text-duo-mute">Câu trả lời này chưa có thông tin nguồn để kiểm chứng. Bạn hãy hỏi lại để trợ lý tra cứu nguồn.</p>}
              {!!message.sources?.length && <details className="group mt-4 border-t border-duo-line pt-3">
                <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg py-1 text-sm font-bold text-duo-green-dark [&::-webkit-details-marker]:hidden"><BookOpen className="h-4 w-4 shrink-0" /><span>Tài liệu tham khảo · {message.sources.length} nguồn</span><ChevronDown className="ml-auto h-4 w-4 shrink-0 transition-transform group-open:rotate-180" /></summary>
                <div className="mt-3 space-y-3">
                  {message.sources.map((source, sourceIndex) => <div key={sourceIndex} className="rounded-xl bg-duo-mist p-3 text-sm leading-6">
                    {source.url && /^https?:\/\//i.test(source.url)
                      ? <a className="break-words font-bold text-duo-green-dark underline decoration-duo-green/30 underline-offset-4" href={source.url} target="_blank" rel="noopener noreferrer">[{source.citation_id ?? sourceIndex + 1}] {source.title}</a>
                      : <span className="font-bold">[{source.citation_id ?? sourceIndex + 1}] {source.title}</span>}
                    {!!source.quotes.length && <details className="mt-2"><summary className="cursor-pointer text-xs font-bold text-duo-mute">Xem đoạn tài liệu tham khảo</summary><div className="mt-2 max-h-52 space-y-3 overflow-y-auto border-l-2 border-duo-green/30 pl-3">{source.quotes.map((quote, i) => <p key={i} className="whitespace-pre-wrap break-words text-sm leading-6">{quote}</p>)}</div></details>}
                  </div>)}
                </div>
              </details>}
            </div>
          </div>)}
          {sending && <div role="status" className="flex items-center gap-2 text-sm text-duo-mute"><span className="h-2 w-2 animate-pulse rounded-full bg-duo-green" />Đang tìm hiểu câu hỏi của bạn…</div>}
        </div>
      </div>

      <footer className="shrink-0 border-t border-duo-line bg-white p-3 md:p-4">
        <div className={page ? 'mx-auto max-w-3xl' : ''}>
          {error && <div role="alert" className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm leading-6 text-red-700"><p>{error}</p><button type="button" disabled={loading} onClick={chat.reload} className="font-bold underline">Tải lại hội thoại</button></div>}
          <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1">
            {quick.map((q) => <button key={q} type="button" onClick={() => void send(q)} disabled={loading} className="shrink-0 rounded-full border border-duo-line px-2.5 py-1.5 text-xs font-bold text-duo-green-dark transition-colors hover:border-duo-green hover:bg-duo-green-soft disabled:opacity-50">{q}</button>)}
          </div>
          <div className="flex items-end gap-2 rounded-2xl border border-duo-line bg-white p-2 focus-within:border-duo-green focus-within:ring-2 focus-within:ring-duo-green/10">
            <textarea ref={inputRef} aria-label="Câu hỏi cho trợ lý AI" value={input} maxLength={2000} disabled={loading} rows={2} onChange={(event) => setInput(event.target.value)} placeholder="Hỏi gì đó..."
              className="min-w-0 flex-1 resize-none bg-transparent px-2 py-1 text-[15px] leading-6 text-duo-ink outline-none placeholder:text-duo-mute disabled:opacity-60"
              onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(input) } }} />
            <button type="button" aria-label="Gửi" onClick={() => void send(input)} disabled={loading || !input.trim()} className="flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-duo-green px-3 text-sm font-extrabold text-white transition-colors hover:bg-duo-green-dark disabled:opacity-40"><Send className="h-4 w-4" />{page && <span className="hidden sm:inline">Gửi</span>}</button>
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-1 text-[11px] leading-5 text-duo-mute"><span>Thông tin tham khảo, không thay thế chẩn đoán.</span>{page && <span className="hidden sm:inline">Enter để gửi · Shift + Enter để xuống dòng</span>}</div>
          {page && <details className="mt-1 text-xs leading-5 text-duo-mute"><summary className="cursor-pointer">Lưu ý khi sử dụng</summary><p className="pt-2">Kết quả phân tích từ AIMBRACE chỉ mang tính chất tham khảo, không phải là chẩn đoán y khoa. Vui lòng tham khảo ý kiến bác sĩ/chuyên gia để được đánh giá chính xác.</p><p>AIMBRACE không lưu trữ kết luận chẩn đoán; chỉ lưu kết quả tham khảo.</p></details>}
        </div>
      </footer>
    </section>
  )
}
