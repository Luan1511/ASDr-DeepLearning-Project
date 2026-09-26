import { useMemo, useState, useRef, useEffect } from 'react'
import { api } from '../lib/api'
import { Bot, Send } from 'lucide-react'

type Msg = { role: 'user' | 'assistant'; content: string }

const quick = ['ASD là gì?', 'Dấu hiệu sớm?', 'Cách sàng lọc?']

export function AIAssistantCard() {
  const [messages, setMessages] = useState<Msg[]>([
    { role: 'assistant', content: 'Xin chào! Tôi là trợ lý AI của ASDr. Bạn muốn hỏi gì về ASD?' },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [models, setModels] = useState<string[]>([])
  const [selectedModel, setSelectedModel] = useState<string>('')
  const scrollRef = useRef<HTMLDivElement>(null)

  const disclaimer = useMemo(() => 'Trợ lý chỉ giải thích kiến thức, không chẩn đoán.', [])

  useEffect(() => {
    async function fetchModels() {
      try {
        const res = await api.get('/chat/models')
        if (res.data && res.data.models) {
          setModels(res.data.models)
          if (res.data.models.length > 0) setSelectedModel(res.data.models[0])
        }
      } catch {
        // ignore
      }
    }
    fetchModels()
  }, [])

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
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
      setMessages((m) => [...m, { role: 'assistant', content: 'Xin lỗi, hiện chưa thể trả lời. Thử lại sau nhé.' }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="card-duo overflow-hidden">
      <div className="divider-duo flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-duo-green-soft text-duo-green-dark">
            <Bot className="h-4 w-4 stroke-[2.5]" />
          </div>
          <div className="text-sm font-extrabold uppercase tracking-wide text-duo-ink">Trợ lý AI</div>
        </div>
        {models.length > 0 && (
          <select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            className="rounded-xl bg-white px-2 py-1 text-xs font-bold text-duo-ink shadow-chip outline-none transition-shadow focus:shadow-input-focus"
          >
            {models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="space-y-3 p-4">
        <div className="rounded-2xl rounded-tl-md bg-duo-mist px-3 py-2 text-sm font-semibold text-duo-ink">
          {messages[0].content}
        </div>

        <div className="flex flex-wrap gap-2">
          {quick.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => send(q)}
              className="rounded-full bg-white px-3 py-1 text-xs font-extrabold text-duo-blue shadow-chip transition-all hover:-translate-y-px hover:bg-duo-mist hover:shadow-card"
            >
              {q}
            </button>
          ))}
        </div>

        {messages.length > 1 && (
          <div ref={scrollRef} className="max-h-48 space-y-2 overflow-auto">
            {messages.slice(1).map((m, idx) => (
              <div
                key={idx}
                className={
                  m.role === 'user'
                    ? 'ml-auto w-fit max-w-[85%] rounded-2xl rounded-tr-md bg-duo-green px-3 py-2 text-xs font-bold text-white'
                    : 'mr-auto w-fit max-w-[85%] rounded-2xl rounded-tl-md bg-duo-mist px-3 py-2 text-xs font-semibold text-duo-ink'
                }
              >
                {m.content}
              </div>
            ))}
            {loading && <div className="px-1 text-xs font-bold text-duo-mute">Đang trả lời...</div>}
          </div>
        )}

        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Hỏi gì đó..."
            className="input-duo !py-2"
            onKeyDown={(e) => {
              if (e.key === 'Enter') send(input)
            }}
          />
          <button type="button" onClick={() => send(input)} className="btn-duo !px-4 gap-1.5" disabled={loading}>
            <Send className="h-3.5 w-3.5 stroke-[2.5]" />
            <span>Gửi</span>
          </button>
        </div>
        <div className="text-xs font-bold text-duo-mute">{disclaimer}</div>
      </div>
    </div>
  )
}
