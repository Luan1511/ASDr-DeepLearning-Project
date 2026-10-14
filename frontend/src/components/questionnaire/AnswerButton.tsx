import type { ReactNode } from 'react'

/**
 * Answer button of the in-app questionnaire screens. Every answer looks the same
 * (neutral colour, nothing preselected) so the layout never hints at which answer
 * counts; `selected` only marks the parent's own earlier choice when going back.
 */
export function AnswerButton({
  children,
  selected = false,
  disabled,
  onClick,
  hint,
}: {
  children: ReactNode
  selected?: boolean
  disabled?: boolean
  onClick: () => void
  /** Keyboard shortcut shown in small print (e.g. "C"). */
  hint?: string
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
      className={[
        'flex min-h-14 flex-1 items-center justify-center gap-2 rounded-2xl px-5 py-3 text-base font-extrabold text-duo-ink transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-duo-blue focus-visible:ring-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-60',
        selected ? 'bg-duo-mist ring-2 ring-inset ring-duo-ink' : 'bg-white ring-1 ring-inset ring-duo-line hover:bg-duo-mist',
      ].join(' ')}
    >
      <span>{children}</span>
      {hint && (
        <kbd className="rounded-md bg-duo-mist px-1.5 py-0.5 font-sans text-[11px] font-bold text-duo-mute" aria-hidden="true">
          {hint}
        </kbd>
      )}
    </button>
  )
}
