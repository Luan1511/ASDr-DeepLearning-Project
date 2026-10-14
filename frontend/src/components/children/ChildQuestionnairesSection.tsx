import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, ClipboardList } from 'lucide-react'
import { Card } from '../Card'
import { AgeGateNotice } from '../questionnaire/AgeGateNotice'
import { CopyrightLine } from '../questionnaire/CopyrightLine'
import { PendingFollowUpBanner } from '../questionnaire/PendingFollowUpBanner'
import { ResultStateBadge } from '../questionnaire/ResultStateBadge'
import { formatDateTime } from '../../lib/format'
import {
  FOLLOW_UP_IN_PROGRESS,
  MCHAT_ITEM_COUNT,
  RESPONSE_MODE_LABEL,
  OUTCOME_SHORT_LABEL,
  QUESTIONNAIRE_DASHBOARD_NOTE,
  QUESTIONNAIRE_DISABLED_MESSAGE,
  QUESTIONNAIRE_MIGRATION_MESSAGE,
  QUESTIONNAIRE_TITLE,
  RESPONDENT_LABEL,
  fetchChildQuestionnaires,
  fetchQuestionnaires,
  formatCalendarDate,
  linksOf,
  questionnaireApiErrorMessage,
  questionnaireUnavailableReason,
  type QuestionnaireLinks,
} from '../../lib/questionnaires'
import type { ChildQuestionnairesDto } from '../../lib/questionnaireTypes'

type State =
  | { status: 'loading' }
  | { status: 'hidden' }
  | { status: 'migration' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: ChildQuestionnairesDto; links: QuestionnaireLinks; enabled: boolean }

async function loadSection(childId: string): Promise<State> {
  let enabled: boolean
  let links: QuestionnaireLinks
  try {
    const q = await fetchQuestionnaires()
    enabled = q.enabled
    links = linksOf(q.instruments.find((i) => i.code === 'MCHAT_RF'))
  } catch (e) {
    // A backend without the questionnaire routes simply has no such feature.
    if (questionnaireUnavailableReason(e) === 'absent') return { status: 'hidden' }
    return { status: 'error', message: questionnaireApiErrorMessage(e, 'Không tải được thông tin bảng hỏi.') }
  }
  try {
    const data = await fetchChildQuestionnaires(childId)
    // Switched off but the backend still lists stored responses: keep them visible (and deletable), nothing new.
    if (!enabled && data.responses.length === 0) return { status: 'hidden' }
    return { status: 'ready', data, links, enabled }
  } catch (e) {
    const reason = questionnaireUnavailableReason(e)
    // MCHAT_MODE=off is the default until the authors grant permission: show nothing on the dashboard.
    if (reason === 'disabled' || reason === 'absent') return { status: 'hidden' }
    if (reason === 'migration') return { status: 'migration' }
    return { status: 'error', message: questionnaireApiErrorMessage(e, 'Không tải được các lần trả lời bảng hỏi.') }
  }
}

/** Child-dashboard card: eligibility, history and the entry point of the M-CHAT-R/F questionnaire. */
export function ChildQuestionnairesSection({
  childId,
  childName,
  dateOfBirth,
}: {
  childId: string
  childName: string
  dateOfBirth: string
}) {
  const [state, setState] = useState<State>({ status: 'loading' })

  // dateOfBirth is a dependency on purpose: editing it changes the eligibility.
  useEffect(() => {
    let stale = false
    void loadSection(childId).then((next) => {
      if (!stale) setState(next)
    })
    return () => {
      stale = true
    }
  }, [childId, dateOfBirth])

  if (state.status === 'hidden') return null

  return (
    <Card title="Bảng hỏi phụ huynh (M-CHAT-R/F)">
      {state.status === 'loading' && <div className="text-sm font-semibold text-duo-mute">Đang tải...</div>}
      {state.status === 'migration' && (
        <div className="rounded-2xl bg-yellow-50 px-4 py-3 text-sm font-bold text-yellow-800">{QUESTIONNAIRE_MIGRATION_MESSAGE}</div>
      )}
      {state.status === 'error' && <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-bold text-duo-red">{state.message}</div>}
      {state.status === 'ready' && (
        <SectionBody childId={childId} childName={childName} data={state.data} links={state.links} enabled={state.enabled} />
      )}
    </Card>
  )
}

function SectionBody({
  childId,
  childName,
  data,
  links,
  enabled,
}: {
  childId: string
  childName: string
  data: ChildQuestionnairesDto
  links: QuestionnaireLinks
  enabled: boolean
}) {
  const eligibility = data.eligibility.MCHAT_RF
  const responses = [...data.responses].sort((a, b) => b.completedAt.localeCompare(a.completedAt))
  const pending = enabled ? responses.filter((r) => r.followUpStatus === 'PENDING') : []

  return (
    <div className="space-y-4">
      <div className="text-sm font-extrabold text-duo-ink">{QUESTIONNAIRE_TITLE}</div>

      {!enabled ? (
        <div className="rounded-2xl bg-duo-mist px-4 py-3 text-sm font-semibold text-duo-ink">{QUESTIONNAIRE_DISABLED_MESSAGE}</div>
      ) : eligibility.eligible ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-duo-mist px-4 py-3">
          <p className="text-sm font-semibold text-duo-ink">
            {childName} hiện {eligibility.ageMonths} tháng tuổi, trong độ tuổi làm bảng hỏi (đến hết ngày{' '}
            {formatCalendarDate(eligibility.eligibleUntil)}).
          </p>
          <Link to={`/children/${childId}/questionnaires/mchat`} className="btn-duo">
            <ClipboardList className="h-4 w-4" aria-hidden="true" />
            {responses.length ? 'Làm lại bảng hỏi' : 'Làm bảng hỏi'}
          </Link>
        </div>
      ) : (
        <AgeGateNotice eligibility={eligibility} cdcMilestonesUrl={links.cdcMilestonesUrl} />
      )}

      {pending.map((r) => (
        <PendingFollowUpBanner key={`pending-${r.id}`} response={r} />
      ))}

      {responses.length === 0 ? (
        <div className="py-2 text-sm font-semibold text-duo-mute">Chưa có lần trả lời bảng hỏi nào cho {childName}.</div>
      ) : (
        <ul className="space-y-1" aria-label="Các lần trả lời bảng hỏi">
          {responses.map((r) => (
            <li key={r.id}>
              <Link
                to={`/questionnaire-responses/${r.id}`}
                className="flex items-center gap-3 rounded-2xl px-4 py-3 hover:bg-duo-mist"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-extrabold text-duo-ink">{formatDateTime(r.completedAt)}</div>
                      <div className="mt-0.5 break-words text-xs font-bold text-duo-mute">
                        Điểm phần đầu: {r.totalScore}/{MCHAT_ITEM_COUNT} • {OUTCOME_SHORT_LABEL[r.outcome]} • Người trả lời:{' '}
                        {RESPONDENT_LABEL[r.respondent]} • {RESPONSE_MODE_LABEL[r.mode]}
                      </div>
                    </div>
                    {/* Below the text on small screens, beside it from sm up. */}
                    <div className="flex flex-wrap gap-1.5 sm:flex-shrink-0 sm:justify-end">
                      {r.followUpStatus === 'PENDING' && r.followUp.inAppStarted && (
                        <span className="rounded-full bg-yellow-100 px-2.5 py-1 text-xs font-extrabold text-yellow-800">
                          {FOLLOW_UP_IN_PROGRESS}
                        </span>
                      )}
                      <ResultStateBadge response={r} />
                    </div>
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 flex-shrink-0 text-duo-mute" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs font-bold text-duo-mute">{QUESTIONNAIRE_DASHBOARD_NOTE} Kết quả bảng hỏi chỉ là sàng lọc tham khảo.</p>
      <CopyrightLine officialFormUrl={links.officialFormUrl} />
    </div>
  )
}
