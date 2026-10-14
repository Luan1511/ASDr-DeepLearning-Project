import { ANSWER_LABEL, MCHAT_ITEM_NUMBERS, type McHatAnswers } from '../../lib/questionnaires'

/** Compact read-back of all answers (by item number) so the parent can check them before sending; tap to edit. */
export function AnswerReview({ answers, onEdit }: { answers: McHatAnswers; onEdit?: (item: number) => void }) {
  const yes = MCHAT_ITEM_NUMBERS.filter((n) => answers[n] === true)
  const no = MCHAT_ITEM_NUMBERS.filter((n) => answers[n] === false)
  return (
    <div className="space-y-3">
      <ul className="grid grid-cols-4 gap-1.5 sm:grid-cols-5 lg:grid-cols-10" aria-label="Câu trả lời theo số thứ tự câu">
        {MCHAT_ITEM_NUMBERS.map((n) => {
          const value = answers[n]
          const text = value === true ? ANSWER_LABEL.yes : value === false ? ANSWER_LABEL.no : '—'
          return (
            <li key={n}>
              <button
                type="button"
                disabled={!onEdit}
                onClick={() => onEdit?.(n)}
                title={onEdit ? `Sửa câu ${n}` : undefined}
                className={[
                  'flex min-h-12 w-full flex-col items-center justify-center rounded-xl px-1 py-1 text-center transition-colors enabled:hover:ring-2 enabled:hover:ring-duo-blue',
                  // Same colour for Có and Không: the review must not hint at which answer counts.
                  typeof value === 'boolean' ? 'bg-duo-mist text-duo-ink' : 'bg-red-50 text-duo-red',
                ].join(' ')}
              >
                <span className="text-[11px] font-bold text-duo-mute">Câu {n}</span>
                <span className="text-sm font-black">{text}</span>
              </button>
            </li>
          )
        })}
      </ul>
      <dl className="space-y-1 text-sm font-semibold text-duo-ink">
        <div>
          <dt className="inline font-extrabold">Có ({yes.length} câu): </dt>
          <dd className="inline tabular-nums">{yes.length ? yes.join(', ') : '—'}</dd>
        </div>
        <div>
          <dt className="inline font-extrabold">Không ({no.length} câu): </dt>
          <dd className="inline tabular-nums">{no.length ? no.join(', ') : '—'}</dd>
        </div>
      </dl>
    </div>
  )
}
