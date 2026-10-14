import { ShieldCheck } from 'lucide-react'
import { ConsentPanel } from '../ConsentPanel'
import { Q_TEXT_LINK } from '../../lib/questionnaires'
import type { ConsentStatement } from '../../lib/types'

/**
 * Per-submission consent (spec D6): nothing is stored when the parent ticks it;
 * the page sends `consentAccepted: true` + the statement version with the answers,
 * and the backend snapshots the statement on the response row.
 */
export function QuestionnaireConsent({
  statement,
  childName,
  accepted,
  onAccept,
  onReview,
}: {
  statement: ConsentStatement
  childName: string
  accepted: boolean
  onAccept: () => void
  onReview: () => void
}) {
  if (accepted) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-duo-green-soft px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-extrabold text-duo-green-dark">
          <ShieldCheck className="h-4 w-4 stroke-[2.5]" aria-hidden="true" />
          Đã đồng ý: {statement.title}
        </div>
        <button type="button" className={`${Q_TEXT_LINK} -mr-2 text-xs font-extrabold text-duo-blue hover:underline`} onClick={onReview}>
          Đọc lại nội dung
        </button>
      </div>
    )
  }
  return (
    <div className="space-y-2">
      <ConsentPanel statement={statement} childName={childName} submitting={false} requiredScopes={[]} onAccept={() => onAccept()} />
      <p className="text-xs font-semibold text-duo-mute">
        Đồng ý này đi kèm lần trả lời bạn sắp gửi; câu trả lời chỉ được lưu khi bạn bấm gửi.
      </p>
    </div>
  )
}
