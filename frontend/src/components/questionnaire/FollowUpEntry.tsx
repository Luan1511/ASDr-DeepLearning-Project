import { useState } from 'react'
import { ClipboardCheck, ExternalLink, Loader2 } from 'lucide-react'
import { FOLLOW_UP_SOURCES, FOLLOW_UP_SOURCE_LABEL, MCHAT_LINKS } from '../../lib/questionnaires'
import type { AssistedFollowUpSource } from '../../lib/questionnaireTypes'

/**
 * Records the outcome of an assisted Follow-Up (health worker / a365): which of the listed
 * item numbers are still marked for attention. Numbers only, never wording; neutral labels
 * (no pass/fail words for the parent).
 */
export function FollowUpEntry({
  failedItems,
  a365Url = MCHAT_LINKS.a365Url,
  submitting,
  error,
  onSubmit,
  warning,
}: {
  failedItems: number[]
  a365Url?: string
  submitting: boolean
  error: string | null
  onSubmit: (source: AssistedFollowUpSource, stillFailingItems: number[]) => void
  /** Shown above the save button (e.g. that partial in-app answers will be replaced). */
  warning?: string | null
}) {
  const [source, setSource] = useState<AssistedFollowUpSource | null>(null)
  const [stillFailing, setStillFailing] = useState<number[]>([])
  const [done, setDone] = useState(false)
  const items = [...failedItems].sort((a, b) => a - b)

  function toggle(n: number, on: boolean) {
    setStillFailing((prev) => (on ? [...prev.filter((x) => x !== n), n].sort((a, b) => a - b) : prev.filter((x) => x !== n)))
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm font-extrabold text-duo-ink">
        <ClipboardCheck className="h-4 w-4 stroke-[2.5] text-duo-green-dark" aria-hidden="true" />
        Ghi kết quả phần hỏi thêm (Follow-Up)
      </div>
      <p className="text-sm font-semibold leading-relaxed text-duo-ink">
        Nếu đã làm phần hỏi thêm cùng nhân viên y tế hoặc trên{' '}
        <a href={a365Url} target="_blank" rel="noopener noreferrer" className="link-duo inline-flex items-center gap-0.5">
          a365
          <ExternalLink className="h-3 w-3" aria-hidden="true" />
        </a>
        , ghi kết quả tại đây: chọn bên dưới những câu số được ghi là vẫn cần lưu ý sau phần hỏi thêm; nếu không còn câu nào, để
        trống tất cả.
      </p>

      <fieldset>
        <legend className="mb-2 text-xs font-extrabold uppercase tracking-wide text-duo-mute">Phần hỏi thêm được làm</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {FOLLOW_UP_SOURCES.map((s) => (
            <label
              key={s}
              className={[
                'flex min-h-12 cursor-pointer items-center gap-2 rounded-2xl px-3 py-2 text-sm font-bold',
                source === s ? 'bg-duo-green-soft text-duo-green-dark ring-2 ring-duo-green' : 'bg-duo-mist text-duo-ink',
              ].join(' ')}
            >
              <input type="radio" name="follow-up-source" className="h-4 w-4 accent-duo-green" checked={source === s} onChange={() => setSource(s)} />
              {FOLLOW_UP_SOURCE_LABEL[s]}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-xs font-extrabold uppercase tracking-wide text-duo-mute">
          Câu vẫn cần lưu ý sau phần hỏi thêm
        </legend>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {items.map((n) => {
            const on = stillFailing.includes(n)
            return (
              <label
                key={n}
                className={[
                  'flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-2xl px-3 text-sm font-black',
                  on ? 'bg-yellow-100 text-yellow-800 ring-2 ring-yellow-500' : 'bg-duo-mist text-duo-ink',
                ].join(' ')}
              >
                <input type="checkbox" className="h-4 w-4 accent-duo-green" checked={on} onChange={(e) => toggle(n, e.target.checked)} />
                Câu {n}
              </label>
            )
          })}
        </div>
        <p className="mt-2 text-xs font-bold text-duo-mute">
          Đã chọn {stillFailing.length}/{items.length} câu.
        </p>
      </fieldset>

      <label className="flex cursor-pointer items-start gap-2 text-sm font-bold text-duo-ink">
        <input type="checkbox" className="mt-0.5 h-4 w-4 accent-duo-green" checked={done} onChange={(e) => setDone(e.target.checked)} />
        <span>Tôi đã làm xong phần hỏi thêm cho các câu số trên. Kết quả này không sửa được sau khi lưu.</span>
      </label>

      {warning && <div className="rounded-2xl bg-yellow-50 px-4 py-3 text-sm font-bold text-yellow-800">{warning}</div>}

      {error && <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-bold text-duo-red">{error}</div>}

      <button
        type="button"
        className="btn-duo"
        disabled={!source || !done || submitting}
        onClick={() => source && onSubmit(source, stillFailing)}
      >
        {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
        {submitting ? 'Đang lưu...' : 'Lưu kết quả phần hỏi thêm'}
      </button>
    </div>
  )
}
