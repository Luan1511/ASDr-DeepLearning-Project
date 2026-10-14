import { CircleCheck } from 'lucide-react'
import { ANSWER_LABEL, MCHAT_ITEM_COUNT, MCHAT_ITEM_NUMBERS, mchatItemElementId, type McHatAnswers } from '../../lib/questionnaires'

function Choice({
  name,
  checked,
  label,
  disabled,
  onSelect,
}: {
  name: string
  checked: boolean
  label: string
  disabled?: boolean
  onSelect: () => void
}) {
  return (
    <label className="relative flex-1 cursor-pointer has-[:disabled]:cursor-not-allowed">
      <input type="radio" name={name} className="peer sr-only" checked={checked} disabled={disabled} onChange={onSelect} />
      <span
        className={[
          'flex min-h-12 min-w-[4.5rem] items-center justify-center rounded-xl px-4 text-sm font-extrabold transition-colors',
          'peer-focus-visible:ring-2 peer-focus-visible:ring-duo-blue peer-focus-visible:ring-offset-2',
          checked ? 'bg-duo-green text-white shadow-chip' : 'bg-white text-duo-ink ring-1 ring-inset ring-duo-line hover:bg-duo-green-soft',
        ].join(' ')}
      >
        {label}
      </span>
    </label>
  )
}

/**
 * Có/Không entry by item NUMBER only ("Câu 1".."Câu 20"); the parent reads the
 * items on the official form. Native radios give each row arrow-key navigation.
 */
export function AnswerGrid({
  answers,
  onChange,
  highlightMissing,
  disabled,
}: {
  answers: McHatAnswers
  onChange: (item: number, value: boolean) => void
  highlightMissing: boolean
  disabled?: boolean
}) {
  const answered = MCHAT_ITEM_NUMBERS.filter((n) => typeof answers[n] === 'boolean').length
  const complete = answered === MCHAT_ITEM_COUNT

  return (
    <div>
      <div className="sticky top-0 z-[5] -mx-1 mb-3 bg-white/95 px-1 py-2 backdrop-blur" aria-live="polite">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-extrabold text-duo-ink">
            Đã trả lời <span className="tabular-nums">{answered}/{MCHAT_ITEM_COUNT}</span>
          </span>
          {complete && (
            <span className="inline-flex items-center gap-1 text-xs font-extrabold text-duo-green-dark">
              <CircleCheck className="h-4 w-4 stroke-[2.5]" aria-hidden="true" />
              Đủ {MCHAT_ITEM_COUNT} câu
            </span>
          )}
        </div>
        <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-duo-mist">
          <div className="h-2 rounded-full bg-duo-green transition-all" style={{ width: `${(answered / MCHAT_ITEM_COUNT) * 100}%` }} />
        </div>
      </div>

      <div className="grid gap-2 lg:grid-flow-col lg:grid-rows-10 lg:gap-x-6">
        {MCHAT_ITEM_NUMBERS.map((n) => {
          const value = answers[n]
          const missing = highlightMissing && typeof value !== 'boolean'
          const labelId = `${mchatItemElementId(n)}-label`
          return (
            <div
              key={n}
              id={mchatItemElementId(n)}
              role="radiogroup"
              aria-labelledby={labelId}
              aria-invalid={missing || undefined}
              className={[
                'flex scroll-mt-24 items-center gap-3 rounded-2xl px-3 py-2',
                missing ? 'bg-red-50 ring-2 ring-duo-red' : 'bg-duo-mist',
              ].join(' ')}
            >
              <div className="w-20 flex-shrink-0">
                <div id={labelId} className="text-sm font-black text-duo-ink">
                  Câu {n}
                </div>
                {missing && <div className="text-[11px] font-extrabold text-duo-red">Chưa trả lời</div>}
              </div>
              <div className="flex flex-1 gap-1.5 rounded-2xl bg-white p-1 shadow-card-inner">
                <Choice
                  name={`mchat-${n}`}
                  label={ANSWER_LABEL.yes}
                  checked={value === true}
                  disabled={disabled}
                  onSelect={() => onChange(n, true)}
                />
                <Choice
                  name={`mchat-${n}`}
                  label={ANSWER_LABEL.no}
                  checked={value === false}
                  disabled={disabled}
                  onSelect={() => onChange(n, false)}
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
