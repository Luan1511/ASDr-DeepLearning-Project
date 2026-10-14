import { CircleAlert, CircleCheck, TriangleAlert, type LucideIcon } from 'lucide-react'
import { RESULT_STATE_LABEL, resultStateOf, type ResultState } from '../../lib/questionnaires'
import type { QuestionnaireResponseDto } from '../../lib/questionnaireTypes'

// Text + icon + colour, so the state stays readable in grayscale and when printed.
const STATE_STYLE: Record<ResultState, { icon: LucideIcon; cls: string }> = {
  PENDING: { icon: CircleAlert, cls: 'bg-yellow-100 text-yellow-800' },
  LOW: { icon: CircleCheck, cls: 'bg-duo-green-soft text-duo-green-dark' },
  LOW_AFTER_FOLLOW_UP: { icon: CircleCheck, cls: 'bg-duo-green-soft text-duo-green-dark' },
  HIGH: { icon: TriangleAlert, cls: 'bg-red-100 text-duo-red-dark' },
}

/**
 * Result state of a response (mchat_admin.md §4.2): a pending MODERATE response is never shown
 * as a final result, and a finished Follow-Up shows its outcome rather than the stage-1 band.
 */
export function ResultStateBadge({
  response,
  size = 'sm',
}: {
  response: Pick<QuestionnaireResponseDto, 'outcome' | 'followUpStatus'>
  size?: 'sm' | 'lg'
}) {
  const state = resultStateOf(response)
  const { icon: Icon, cls } = STATE_STYLE[state]
  return (
    <span
      className={[
        'inline-flex max-w-full items-center gap-1.5 rounded-full font-extrabold print:border print:border-current print:bg-white',
        size === 'lg' ? 'px-4 py-1.5 text-sm' : 'px-3 py-1 text-xs',
        cls,
      ].join(' ')}
    >
      <Icon className={size === 'lg' ? 'h-4 w-4 flex-shrink-0 stroke-[2.5]' : 'h-3.5 w-3.5 flex-shrink-0 stroke-[2.5]'} aria-hidden="true" />
      {RESULT_STATE_LABEL[state]}
    </span>
  )
}
