import { Info } from 'lucide-react'
import {
  MCHAT_ITEM_COUNT,
  NEEDS_REVIEW_NOTE,
  QUESTIONNAIRE_RESULT_HEADER,
  REFER_ON_CONCERN,
  RESULT_STATE_TEXT,
  rescreenLine,
  resultStateOf,
} from '../../lib/questionnaires'
import type { FollowUpSource, QuestionnaireResponseDto } from '../../lib/questionnaireTypes'
import { ResultStateBadge } from './ResultStateBadge'

const FOLLOW_UP_DONE_WITH: Record<FollowUpSource, string> = {
  HEALTH_WORKER: 'cùng nhân viên y tế',
  A365: 'trên ứng dụng a365',
  OTHER: 'theo cách khác',
  IN_APP: 'trong ứng dụng AIMBRACE',
}

/** Result headline per mchat_admin.md §4.2: state label, what it means, review flag, refer-on-concern. */
export function ResultStateCard({ response, childName }: { response: QuestionnaireResponseDto; childName: string | null }) {
  const state = resultStateOf(response)
  const review = response.followUp.needsReview
  const reviewItems = [...response.followUp.reviewItems].sort((a, b) => a - b)
  return (
    <div className="card-duo space-y-4 p-6 print:p-0 print:shadow-none">
      <div>
        <h1 className="text-xl font-black text-duo-ink">{QUESTIONNAIRE_RESULT_HEADER}</h1>
        {childName && <div className="mt-1 text-sm font-bold text-duo-mute">{childName}</div>}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <ResultStateBadge response={response} size="lg" />
        <span className="text-sm font-black tabular-nums text-duo-ink">
          Điểm phần đầu: {response.totalScore}/{MCHAT_ITEM_COUNT}
        </span>
      </div>
      <p className="text-sm font-semibold leading-relaxed text-duo-ink">{RESULT_STATE_TEXT[state]}</p>
      {response.followUpStatus === 'COMPLETED' && (
        <p className="text-xs font-bold text-duo-mute">
          Đã hoàn tất phần hỏi thêm (Follow-Up)
          {response.followUpSource ? ` ${FOLLOW_UP_DONE_WITH[response.followUpSource]}` : ''}. Điểm phần đầu ở trên chỉ là bước
          sàng lọc thứ nhất.
        </p>
      )}
      {response.rescreenAfter && (
        <p className="text-sm font-bold text-duo-ink">{rescreenLine(response.rescreenAfter)}</p>
      )}
      {review && (
        <div className="rounded-2xl bg-yellow-50 px-4 py-3 text-sm font-bold text-yellow-800" role="note">
          {NEEDS_REVIEW_NOTE}
          {reviewItems.length > 0 && ` (mục số ${reviewItems.join(', ')})`}
        </div>
      )}
      <div className="flex gap-2.5 rounded-2xl bg-duo-mist px-4 py-3 text-sm font-semibold leading-relaxed text-duo-ink print:bg-white print:px-0">
        <Info className="mt-0.5 h-4 w-4 flex-shrink-0 stroke-[2.5] text-duo-mute" aria-hidden="true" />
        <p>{REFER_ON_CONCERN}</p>
      </div>
    </div>
  )
}
