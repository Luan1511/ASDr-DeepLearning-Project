import { Link } from 'react-router-dom'
import { ArrowRight, ChevronRight, Info } from 'lucide-react'
import { formatDateTime } from '../../lib/format'
import {
  FOLLOW_UP_IN_PROGRESS,
  RESULT_STATE_LABEL,
  canTakeFollowUpInApp,
  followUpActionLabel,
  followUpPath,
  resultPath,
} from '../../lib/questionnaires'
import type { QuestionnaireResponseDto } from '../../lib/questionnaireTypes'

/**
 * A MODERATE response whose Follow-Up is still pending: resume button when the Follow-Up can be
 * taken in the app ("Đang làm dở" only once in-app answers exist), else a link to the result page
 * (assisted entry).
 */
export function PendingFollowUpBanner({ response: r, compact = false }: { response: QuestionnaireResponseDto; compact?: boolean }) {
  const date = formatDateTime(r.completedAt)
  if (!canTakeFollowUpInApp(r)) {
    return (
      <Link
        to={resultPath(r.id)}
        className="flex items-center gap-3 rounded-2xl bg-yellow-50 px-4 py-3 text-sm font-bold text-yellow-800 hover:underline"
      >
        <Info className="h-4 w-4 flex-shrink-0 stroke-[2.5]" aria-hidden="true" />
        <span className="flex-1">
          Lần trả lời ngày {date} cần làm phần hỏi thêm. Làm xong, hãy quay lại ghi kết quả.
        </span>
        <ChevronRight className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
      </Link>
    )
  }
  const f = r.followUp
  return (
    <div
      className={[
        'flex flex-wrap items-center gap-3 rounded-2xl bg-yellow-50 text-sm font-bold text-yellow-800',
        compact ? 'px-3 py-2' : 'px-4 py-3',
      ].join(' ')}
    >
      <span className="rounded-full bg-yellow-100 px-2.5 py-0.5 text-xs font-extrabold">
        {f.inAppStarted ? FOLLOW_UP_IN_PROGRESS : RESULT_STATE_LABEL.PENDING}
      </span>
      <span className="min-w-0 flex-1">
        Lần trả lời ngày {date} chưa hoàn tất: còn phần hỏi thêm
        {f.inAppStarted && f.itemsTotal > 0 ? ` (đã làm ${f.itemsDone}/${f.itemsTotal} mục)` : ''}.
      </span>
      <Link to={followUpPath(r.id)} className={compact ? 'btn-duo !px-4 !py-2 !text-xs' : 'btn-duo'}>
        {followUpActionLabel(f.inAppStarted)}
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    </div>
  )
}
