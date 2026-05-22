import { useMemo, useState, useRef, useEffect } from 'react'
import { api } from '../lib/api'

type Msg = { role: 'user' | 'assistant'; content: string }

const quick = [
  'ASD là gì?',
  'Các dấu hiệu nhận biết sớm ở trẻ?',
  'Quy trình sàng lọc hoạt động thế nào?',
  'Trẻ mấy tuổi thì nên sàng lọc?',
]

export function AIAssistantCard() {
  const [messages, setMessages] = useState<Msg[]>([
    { role: 'assistant', content: 'Xin chào! Tôi là trợ lý AI của ASDr. Tôi có thể giúp gì cho bạn về ASD?' },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  
  const [models, setModels] = useState<string[]>([])
  const [selectedModel, setSelectedModel] = useState<string>('')
  
  const scrollRef = useRef<HTMLDivElement>(null)

  const disclaimer = useMemo(
    () => 'Lưu ý: Trợ lý AI luôn sẵn sàng giải đáp thắc mắc của bạn.',
    [],
  )

  useEffect(() => {
    async function fetchModels() {
      try {
        const res = await api.get('/chat/models')
        if (res.data && res.data.models) {
          setModels(res.data.models)
          if (res.data.models.length > 0) {
            setSelectedModel(res.data.models[0])
          }
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('Failed to fetch models', err)
      }
    }
    fetchModels()
  }, [])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, loading])

  async function send(text: string) {
    const trimmed = text.trim()
    if (!trimmed) return

    setMessages((m) => [...m, { role: 'user', content: trimmed }])
    setInput('')
    setLoading(true)
    try {
      const res = await api.post('/chat', { message: trimmed, modelName: selectedModel })
      setMessages((m) => [...m, { role: 'assistant', content: res.data.reply }])
    } catch {
      setMessages((m) => [
        ...m,
        { role: 'assistant', content: 'Xin lỗi, hiện chưa thể trả lời. Vui lòng thử lại sau.' },
      ])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-card ring-1 ring-slate-100">
      {/* Header gradient */}
      <div
        className="flex items-center justify-between px-4 py-3"
        style={{ background: 'linear-gradient(135deg, #6C63FF 0%, #00BCD4 100%)' }}
      >
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/20 text-lg">🤖</div>
          <div className="text-sm font-bold text-white">Trợ lý AI</div>
          <span className="rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-semibold text-white">BETA</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-sm shadow-emerald-300" />
          <span className="text-xs text-white/90">Đang hoạt động</span>
        </div>
      </div>

      <div className="p-4 space-y-3">
        {/* Model Selection */}
        {models.length > 0 && (
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-semibold text-slate-500">Mô hình AI:</div>
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="text-xs font-medium bg-slate-50 border border-slate-200 text-slate-700 rounded-lg px-2 py-1 outline-none focus:border-[#6C63FF] focus:ring-1 focus:ring-[#6C63FF] transition-all cursor-pointer"
            >
              {models.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
        )}

        {/* First assistant message */}
        <div className="flex items-start gap-2">
          <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-sm">🤖</div>
          <div className="rounded-2xl rounded-tl-none bg-slate-50 px-3 py-2 text-sm text-slate-700 ring-1 ring-slate-100 max-w-[90%]">
            {messages[0].content}
          </div>
        </div>

        {/* Quick questions */}
        <div className="space-y-1.5">
          {quick.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => send(q)}
              className="flex w-full items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600 ring-1 ring-slate-100 hover:bg-indigo-50 hover:text-[#6C63FF] hover:ring-indigo-200 transition text-left"
            >
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5 text-[#6C63FF] flex-shrink-0">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-3a1 1 0 00-.867.5 1 1 0 11-1.731-1A3 3 0 0113 8a3.001 3.001 0 01-2 2.83V11a1 1 0 11-2 0v-1a1 1 0 011-1 1 1 0 100-2zm0 8a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
              </svg>
              {q}
            </button>
          ))}
        </div>

        {/* Chat messages (if any beyond initial) */}
        {messages.length > 1 && (
          <div
            ref={scrollRef}
            className="max-h-48 overflow-auto rounded-xl bg-slate-50 p-2 space-y-2 ring-1 ring-slate-100"
          >
            {messages.slice(1).map((m, idx) => (
              <div
                key={idx}
                className={
                  m.role === 'user'
                    ? 'ml-auto w-fit max-w-[85%] rounded-2xl rounded-tr-none px-3 py-2 text-xs text-white'
                    : 'mr-auto w-fit max-w-[85%] rounded-2xl rounded-tl-none bg-white px-3 py-2 text-xs text-slate-700 ring-1 ring-slate-100'
                }
                style={m.role === 'user' ? { background: 'linear-gradient(135deg, #6C63FF, #818CF8)' } : {}}
              >
                {m.content}
              </div>
            ))}
            {loading && (
              <div className="text-xs text-slate-400 italic px-1">Đang trả lời...</div>
            )}
          </div>
        )}

        {/* Input */}
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Nhập câu hỏi của bạn..."
            className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-[#6C63FF] focus:ring-2 focus:ring-indigo-100"
            onKeyDown={(e) => {
              if (e.key === 'Enter') send(input)
            }}
          />
          <button
            type="button"
            onClick={() => send(input)}
            className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-xl text-white transition hover:opacity-90 disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, #6C63FF, #4FC3F7)' }}
            disabled={loading}
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 rotate-90">
              <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
            </svg>
          </button>
        </div>

        <div className="text-xs text-slate-400 leading-relaxed">{disclaimer}</div>
      </div>
    </div>
  )
}
