import { useEffect, useState } from 'react'
import { ArrowRight, Loader2 } from 'lucide-react'
import { ANSWER_LABEL, OTHER_TEXT_PRIVACY_NOTE, Q_NAV_BUTTON } from '../../lib/questionnaires'
import type { FollowUpAnswerInput, FollowUpStepView as StepView } from '../../lib/questionnaireTypes'
import { AnswerButton } from './AnswerButton'

/** What the page adds to `{ item, node }` when posting the answer. */
export type StepAnswer = Omit<FollowUpAnswerInput, 'item' | 'node'>

const OTHER_TEXT_MAX = 200

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

/** C/1 = Có, K/2 = Không while a yes/no answer is on screen (not while typing; held keys ignored). */
function useYesNoKeys(active: boolean, onYes: () => void, onNo: () => void) {
  useEffect(() => {
    if (!active) return
    function onKey(event: KeyboardEvent) {
      if (event.repeat || event.altKey || event.ctrlKey || event.metaKey || isTypingTarget(event.target)) return
      const key = event.key.toLowerCase()
      if (key === 'c' || key === '1') onYes()
      else if (key === 'k' || key === '2') onNo()
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
}

function Text({ children, size = 'lg' }: { children: string; size?: 'lg' | 'base' | 'sm' }) {
  if (!children.trim()) return null
  const cls =
    size === 'lg'
      ? 'text-lg font-bold text-duo-ink'
      : size === 'base'
        ? 'text-base font-semibold text-duo-ink'
        : 'text-sm font-semibold text-duo-mute'
  return <p className={`whitespace-pre-line leading-relaxed ${cls}`}>{children}</p>
}

function ContinueButton({ disabled, busy, onClick }: { disabled?: boolean; busy: boolean; onClick: () => void }) {
  return (
    <button type="button" className={`btn-duo ${Q_NAV_BUTTON}`} disabled={disabled || busy} onClick={onClick}>
      {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ArrowRight className="h-4 w-4" aria-hidden="true" />}
      Tiếp tục
    </button>
  )
}

/**
 * One Follow-Up step (spec §5), rendered verbatim from the server's StepView. The page
 * keys this component by step so local choices (radio, "other" text) reset per step.
 */
export function FollowUpStepView({
  step,
  busy,
  onAnswer,
  labels,
}: {
  step: StepView
  busy: boolean
  onAnswer: (answer: StepAnswer) => void
  /** Yes/no labels of the licensed content (falls back to Có/Không). */
  labels?: { yes: string; no: string }
}) {
  const [choice, setChoice] = useState<string | null>(null)
  const [otherText, setOtherText] = useState('')
  const yesNo = step.kind === 'YES_NO' || step.kind === 'MAYBE_RESOLVE' || step.kind === 'EXAMPLE'

  function answerYesNo(value: 'YES' | 'NO' | 'MAYBE') {
    if (busy) return
    if (step.kind === 'MAYBE_RESOLVE') {
      if (value === 'MAYBE') return
      // Same (opaque) example id as the row that was answered "maybe", when it was a checklist row.
      return onAnswer({ value, maybe: true, ...(step.example ? { example: step.example } : {}) })
    }
    if (step.kind === 'EXAMPLE') {
      const text = otherText.trim()
      // For MAYBE the page keeps the "other" text until the resolution answer (it is not posted with MAYBE).
      return onAnswer({
        example: step.example,
        value,
        ...(step.isOther && value !== 'NO' && text ? { otherText: text.slice(0, OTHER_TEXT_MAX) } : {}),
      })
    }
    onAnswer({ value })
  }

  useYesNoKeys(yesNo && !busy, () => answerYesNo('YES'), () => answerYesNo('NO'))

  const yesNoButtons = (
    <div className="flex flex-wrap gap-3" role="group" aria-label="Câu trả lời">
      <AnswerButton disabled={busy} onClick={() => answerYesNo('YES')} hint="C">
        {labels?.yes.trim() || ANSWER_LABEL.yes}
      </AnswerButton>
      <AnswerButton disabled={busy} onClick={() => answerYesNo('NO')} hint="K">
        {labels?.no.trim() || ANSWER_LABEL.no}
      </AnswerButton>
    </div>
  )

  const maybeButton = (maybeLabel: string) => (
    <div className="flex">
      <AnswerButton disabled={busy} onClick={() => answerYesNo('MAYBE')}>
        {maybeLabel.trim() || 'Không chắc'}
      </AnswerButton>
    </div>
  )

  switch (step.kind) {
    case 'PROMPT':
      return (
        <div className="space-y-4">
          <Text>{step.text}</Text>
          {/* Note: step.note contains instructions for clinical interviewers; hidden in parent self-administered flow */}
          <ContinueButton busy={busy} onClick={() => onAnswer({ value: 'ACK' })} />
        </div>
      )

    case 'YES_NO':
      return (
        <div className="space-y-4">
          <Text>{step.text}</Text>
          {yesNoButtons}
          {step.allowMaybe && maybeButton(step.maybeLabel)}
        </div>
      )

    case 'MAYBE_RESOLVE':
      return (
        <div className="space-y-4">
          <Text>{step.text}</Text>
          {yesNoButtons}
        </div>
      )

    case 'EXAMPLE':
      return (
        <div className="space-y-4">
          <Text size="base">{step.stem}</Text>
          <div className="space-y-2 rounded-2xl bg-duo-mist px-4 py-3">
            {step.count > 1 && (
              <div className="text-xs font-extrabold uppercase tracking-wide text-duo-mute">
                Ví dụ {Math.min(step.index + 1, step.count)}/{step.count}
              </div>
            )}
            <Text>{step.text}</Text>
          </div>
          {step.isOther && (
            <label className="block space-y-1">
              <span className="text-xs font-extrabold text-duo-mute">Mô tả thêm (không bắt buộc, tối đa {OTHER_TEXT_MAX} ký tự)</span>
              <textarea
                className="input-duo min-h-20 w-full"
                maxLength={OTHER_TEXT_MAX}
                value={otherText}
                placeholder={step.otherPlaceholder ?? undefined}
                disabled={busy}
                onChange={(e) => setOtherText(e.target.value)}
                aria-describedby="follow-up-other-privacy"
              />
              <span id="follow-up-other-privacy" className="block text-xs font-semibold text-duo-mute">
                {OTHER_TEXT_PRIVACY_NOTE}
              </span>
            </label>
          )}
          {yesNoButtons}
          {step.allowMaybe && maybeButton(step.maybeLabel)}
        </div>
      )

    case 'MOST_OFTEN':
    case 'CHOICE': {
      const options =
        step.kind === 'MOST_OFTEN'
          ? step.options.map((o) => ({ id: o.example, text: o.text }))
          : step.options.map((o) => ({ id: o.option, text: o.text }))
      const name = `follow-up-${step.node}`
      return (
        <div className="space-y-4">
          <Text>{step.text}</Text>
          <div role="radiogroup" aria-label="Chọn một" className="space-y-2">
            {options.map((o) => (
              <label
                key={o.id}
                className={[
                  'flex min-h-12 cursor-pointer items-start gap-3 rounded-2xl px-4 py-3 text-base font-semibold text-duo-ink',
                  choice === o.id ? 'bg-duo-mist ring-2 ring-inset ring-duo-ink' : 'bg-white ring-1 ring-inset ring-duo-line hover:bg-duo-mist',
                ].join(' ')}
              >
                <input
                  type="radio"
                  name={name}
                  className="mt-1 h-4 w-4 flex-shrink-0 accent-duo-ink"
                  checked={choice === o.id}
                  disabled={busy}
                  onChange={() => setChoice(o.id)}
                />
                <span className="whitespace-pre-line leading-relaxed">{o.text}</span>
              </label>
            ))}
          </div>
          <ContinueButton disabled={!choice} busy={busy} onClick={() => choice && onAnswer({ value: choice })} />
        </div>
      )
    }
  }
}
