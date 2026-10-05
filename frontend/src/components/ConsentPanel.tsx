import { useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import type { ConsentScope, ConsentStatement } from '../lib/types'

/** Guardian consent form; the text comes from the backend (GET /consent/current). */
export function ConsentPanel({
  statement,
  childName,
  submitting,
  onAccept,
}: {
  statement: ConsentStatement
  childName: string
  submitting: boolean
  onAccept: (scopes: ConsentScope[]) => void
}) {
  const [agreed, setAgreed] = useState(false)
  const [optional, setOptional] = useState<ConsentScope[]>([])

  return (
    <div className="space-y-3 rounded-2xl bg-duo-mist p-4 shadow-card-inner">
      <div className="flex items-center gap-2 text-sm font-extrabold text-duo-ink">
        <ShieldCheck className="h-4 w-4 stroke-[2.5] text-duo-green-dark" />
        {statement.title} — {childName}
      </div>
      <ul className="list-disc space-y-1.5 pl-5 text-sm font-semibold leading-relaxed text-duo-ink">
        {statement.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>

      <label className="flex cursor-pointer items-start gap-2 text-sm font-bold text-duo-ink">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 accent-duo-green"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
        />
        <span>Tôi đã đọc và đồng ý với các nội dung trên.</span>
      </label>

      {statement.optionalScopes.map((o) => (
        <label key={o.scope} className="flex cursor-pointer items-start gap-2 text-sm font-semibold text-duo-ink">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 accent-duo-green"
            checked={optional.includes(o.scope)}
            onChange={(e) =>
              setOptional((prev) => (e.target.checked ? [...prev, o.scope] : prev.filter((s) => s !== o.scope)))
            }
          />
          <span>
            {o.label} <span className="text-duo-mute">(không bắt buộc)</span>
          </span>
        </label>
      ))}

      <button
        type="button"
        className="btn-duo"
        disabled={!agreed || submitting}
        onClick={() => onAccept(['VIDEO_PROCESSING', ...optional])}
      >
        {submitting ? 'Đang lưu...' : 'Xác nhận đồng ý'}
      </button>
    </div>
  )
}
