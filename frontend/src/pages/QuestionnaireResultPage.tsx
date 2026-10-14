import { useEffect, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, ClipboardList, Loader2, Printer, Trash2 } from 'lucide-react'
import { DashboardLayout } from '../layouts/DashboardLayout'
import { CopyrightLine } from '../components/questionnaire/CopyrightLine'
import { DoctorSummary } from '../components/questionnaire/DoctorSummary'
import { FollowUpEntry } from '../components/questionnaire/FollowUpEntry'
import { NextStepsCard } from '../components/questionnaire/NextStepsCard'
import { QuestionnaireDisclaimer } from '../components/questionnaire/QuestionnaireDisclaimer'
import { ReferralGuide } from '../components/questionnaire/ReferralGuide'
import { ResultStateCard } from '../components/questionnaire/ResultStateCard'
import { api, apiErrorCode } from '../lib/api'
import { formatDateTime } from '../lib/format'
import {
  ASSISTED_ANCHOR,
  FOLLOW_UP_ASSISTED,
  FOLLOW_UP_ASSISTED_LINK,
  FOLLOW_UP_DURATION,
  FOLLOW_UP_RESUME,
  FOLLOW_UP_TITLE,
  FOLLOW_UP_WHY,
  MCHAT_LINKS,
  QUESTIONNAIRE_DISABLED_MESSAGE,
  QUESTIONNAIRE_MIGRATION_MESSAGE,
  QUESTIONNAIRE_RESULT_HEADER,
  Q_NAV_BUTTON,
  canTakeFollowUpInApp,
  deleteQuestionnaireResponse,
  fetchQuestionnaireResponse,
  fetchQuestionnaires,
  followUpActionLabel,
  followUpPath,
  linksOf,
  questionnaireApiErrorMessage,
  questionnaireUnavailableReason,
  resultStateOf,
  submitFollowUp,
  type QuestionnaireLinks,
} from '../lib/questionnaires'
import type { AssistedFollowUpSource, QuestionnaireResponseDto } from '../lib/questionnaireTypes'
import type { ChildDetail } from '../lib/types'

const PRINT_AREA_ID = 'questionnaire-print-area'

// Prints only the result block (no sidebar, nav or buttons); the layout is not ours to restyle.
const PRINT_CSS = `
@media print {
  @page { margin: 16mm; }
  body * { visibility: hidden !important; }
  #${PRINT_AREA_ID}, #${PRINT_AREA_ID} * { visibility: visible !important; }
  #${PRINT_AREA_ID} { position: absolute; inset: 0 auto auto 0; width: 100%; }
}
`

type LoadState =
  | { status: 'loading' }
  | { status: 'notFound' }
  | { status: 'unavailable'; reason: 'disabled' | 'migration' }
  | { status: 'error'; message: string }
  | { status: 'ready'; response: QuestionnaireResponseDto; childName: string | null; links: QuestionnaireLinks; enabled: boolean }

async function loadResult(id: string): Promise<LoadState> {
  let response: QuestionnaireResponseDto
  try {
    response = await fetchQuestionnaireResponse(id)
  } catch (e) {
    const code = apiErrorCode(e)
    if (code === 'RESPONSE_NOT_FOUND' || code === 'VALIDATION_ERROR') return { status: 'notFound' }
    const reason = questionnaireUnavailableReason(e)
    if (reason === 'disabled' || reason === 'absent') return { status: 'unavailable', reason: 'disabled' }
    if (reason === 'migration') return { status: 'unavailable', reason: 'migration' }
    return { status: 'error', message: questionnaireApiErrorMessage(e, 'Không tải được kết quả. Vui lòng thử lại.') }
  }
  // Name and links are cosmetic: the result still shows if either request fails.
  const [child, instruments] = await Promise.allSettled([
    api.get<ChildDetail>(`/children/${response.childId}`),
    fetchQuestionnaires(),
  ])
  return {
    status: 'ready',
    response,
    childName: child.status === 'fulfilled' ? child.value.data.child.fullName : null,
    links:
      instruments.status === 'fulfilled'
        ? linksOf(instruments.value.instruments.find((i) => i.code === 'MCHAT_RF'))
        : { ...MCHAT_LINKS },
    // Follow-up entry is a write: offer it only while the feature is on (the read may still work when off).
    enabled: instruments.status === 'fulfilled' ? instruments.value.enabled : true,
  }
}

export function QuestionnaireResultPage() {
  const { id = '' } = useParams()
  return <Result key={id} id={id} />
}

function Result({ id }: { id: string }) {
  const navigate = useNavigate()
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [followUpSubmitting, setFollowUpSubmitting] = useState(false)
  const [followUpError, setFollowUpError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  useEffect(() => {
    let stale = false
    void loadResult(id).then((next) => {
      if (!stale) setState(next)
    })
    return () => {
      stale = true
    }
  }, [id])

  const backTo = state.status === 'ready' ? `/children/${state.response.childId}` : '/children'

  async function saveFollowUp(source: AssistedFollowUpSource, stillFailingItems: number[]) {
    setFollowUpSubmitting(true)
    setFollowUpError(null)
    try {
      const response = await submitFollowUp(id, { source, stillFailingItems })
      setState((prev) => (prev.status === 'ready' ? { ...prev, response } : prev))
    } catch (e) {
      setFollowUpError(questionnaireApiErrorMessage(e, 'Không lưu được kết quả phần hỏi thêm. Vui lòng thử lại.'))
      // Someone (another tab) may already have recorded it: show the stored state.
      if (apiErrorCode(e) === 'FOLLOW_UP_NOT_APPLICABLE') {
        fetchQuestionnaireResponse(id).then(
          (response) => setState((prev) => (prev.status === 'ready' ? { ...prev, response } : prev)),
          () => undefined,
        )
      }
    } finally {
      setFollowUpSubmitting(false)
    }
  }

  async function remove(response: QuestionnaireResponseDto) {
    if (
      !window.confirm(
        `Xoá vĩnh viễn lần trả lời bảng hỏi lúc ${formatDateTime(response.completedAt)}.\n\nCâu trả lời, điểm và kết quả sẽ bị xoá, không khôi phục được.`,
      )
    ) {
      return
    }
    setDeleting(true)
    setDeleteError(null)
    try {
      await deleteQuestionnaireResponse(response.id)
      navigate(`/children/${response.childId}`, { replace: true })
    } catch (e) {
      setDeleteError(questionnaireApiErrorMessage(e, 'Không xoá được lần trả lời. Vui lòng thử lại.'))
      setDeleting(false)
    }
  }

  return (
    <DashboardLayout>
      <style>{PRINT_CSS}</style>
      <div className="mx-auto max-w-3xl space-y-6">
        <Link to={backTo} className="link-duo inline-flex items-center gap-1.5 text-xs print:hidden">
          <ArrowLeft className="h-4 w-4" />
          {state.status === 'ready' && state.childName ? state.childName : 'Hồ sơ trẻ'}
        </Link>

        {state.status === 'loading' && <div className="text-sm font-semibold text-duo-mute">Đang tải...</div>}
        {state.status === 'notFound' && (
          <Notice title="Không tìm thấy kết quả">Lần trả lời có thể đã bị xoá hoặc không thuộc tài khoản của bạn.</Notice>
        )}
        {state.status === 'unavailable' && (
          <Notice title={QUESTIONNAIRE_RESULT_HEADER}>
            {state.reason === 'disabled' ? QUESTIONNAIRE_DISABLED_MESSAGE : QUESTIONNAIRE_MIGRATION_MESSAGE}
          </Notice>
        )}
        {state.status === 'error' && (
          <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-bold text-duo-red">{state.message}</div>
        )}

        {state.status === 'ready' && (
          <ResultBody
            response={state.response}
            childName={state.childName}
            links={state.links}
            enabled={state.enabled}
            followUpSubmitting={followUpSubmitting}
            followUpError={followUpError}
            onSaveFollowUp={(source, items) => void saveFollowUp(source, items)}
          />
        )}

        {state.status === 'ready' && (
          <>
            <div className="flex flex-wrap items-center gap-2 print:hidden">
              <button type="button" className="btn-duo-secondary" onClick={() => window.print()}>
                <Printer className="h-4 w-4" aria-hidden="true" />
                In / lưu PDF
              </button>
              <button
                type="button"
                className="btn-duo-secondary !text-duo-red"
                disabled={deleting}
                onClick={() => void remove(state.response)}
              >
                {deleting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Trash2 className="h-4 w-4" aria-hidden="true" />}
                {deleting ? 'Đang xoá...' : 'Xoá lần trả lời này'}
              </button>
            </div>
            <p className="text-xs font-semibold text-duo-mute print:hidden">
              Bản in gồm kết quả, điểm theo số câu, bước tiếp theo và tóm tắt cho bác sĩ; không có nội dung câu hỏi hay từng câu trả
              lời.
            </p>
            {deleteError && <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-bold text-duo-red print:hidden">{deleteError}</div>}
          </>
        )}
      </div>
    </DashboardLayout>
  )
}

function ResultBody({
  response,
  childName,
  links,
  enabled,
  followUpSubmitting,
  followUpError,
  onSaveFollowUp,
}: {
  response: QuestionnaireResponseDto
  childName: string | null
  links: QuestionnaireLinks
  enabled: boolean
  followUpSubmitting: boolean
  followUpError: string | null
  onSaveFollowUp: (source: AssistedFollowUpSource, stillFailingItems: number[]) => void
}) {
  const resultState = resultStateOf(response)
  const pendingFollowUp = enabled && response.followUpStatus === 'PENDING' && response.band === 'MODERATE'

  return (
    <div id={PRINT_AREA_ID} className="space-y-5">
      <ResultStateCard response={response} childName={childName} />
      {pendingFollowUp ? (
        <>
          <FollowUpOptions
            response={response}
            a365Url={links.a365Url}
            submitting={followUpSubmitting}
            error={followUpError}
            onSave={onSaveFollowUp}
          />
          {/* The options above are screen-only: the printout still says what to do next. */}
          <div className="hidden print:block">
            <NextStepsCard response={response} links={links} />
          </div>
        </>
      ) : (
        <NextStepsCard response={response} links={links} />
      )}
      <ReferralGuide key={resultState} defaultOpen={resultState === 'HIGH'} a365Url={links.a365Url} />
      <DoctorSummary response={response} />
      <QuestionnaireDisclaimer />
      <CopyrightLine officialFormUrl={links.officialFormUrl} />
    </div>
  )
}

/** PENDING MODERATE: the in-app Follow-Up (when available) and the assisted alternative. */
function FollowUpOptions({
  response,
  a365Url,
  submitting,
  error,
  onSave,
}: {
  response: QuestionnaireResponseDto
  a365Url: string
  submitting: boolean
  error: string | null
  onSave: (source: AssistedFollowUpSource, stillFailingItems: number[]) => void
}) {
  const { hash } = useLocation()
  const inApp = canTakeFollowUpInApp(response)
  const f = response.followUp
  const [assistedOpen, setAssistedOpen] = useState(() => !inApp || hash === `#${ASSISTED_ANCHOR}`)

  useEffect(() => {
    if (hash === `#${ASSISTED_ANCHOR}`) document.getElementById(ASSISTED_ANCHOR)?.scrollIntoView({ behavior: 'smooth' })
  }, [hash])

  return (
    <section className="card-duo space-y-4 p-5 print:hidden" aria-labelledby="follow-up-options">
      <div className="flex items-center gap-2">
        <ClipboardList className="h-4 w-4 stroke-[2.5] text-duo-green-dark" aria-hidden="true" />
        <h2 id="follow-up-options" className="text-base font-black text-duo-ink">
          {FOLLOW_UP_TITLE}
        </h2>
      </div>
      <p className="text-sm font-semibold leading-relaxed text-duo-ink">{FOLLOW_UP_WHY}</p>

      {inApp && (
        <div className="space-y-3 rounded-2xl bg-duo-mist px-4 py-3">
          <p className="text-sm font-semibold leading-relaxed text-duo-ink">
            {FOLLOW_UP_DURATION} {FOLLOW_UP_RESUME}
          </p>
          {f.inAppStarted && f.itemsTotal > 0 && (
            <p className="text-sm font-bold text-duo-ink">
              Đã làm {f.itemsDone}/{f.itemsTotal} mục.
            </p>
          )}
          <Link to={followUpPath(response.id)} className={`btn-duo ${Q_NAV_BUTTON}`}>
            {followUpActionLabel(f.inAppStarted)}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      )}

      <details
        id={ASSISTED_ANCHOR}
        className="scroll-mt-24 rounded-2xl bg-white px-4 py-3 ring-1 ring-inset ring-duo-line"
        open={assistedOpen}
        onToggle={(e) => setAssistedOpen(e.currentTarget.open)}
      >
        <summary className="cursor-pointer text-sm font-extrabold text-duo-ink">
          {inApp ? `Hoặc: ${FOLLOW_UP_ASSISTED_LINK}` : FOLLOW_UP_ASSISTED_LINK}
        </summary>
        <div className="mt-3 space-y-3">
          <p className="text-sm font-semibold leading-relaxed text-duo-ink">{FOLLOW_UP_ASSISTED}</p>
          <FollowUpEntry
            failedItems={response.failedItems}
            a365Url={a365Url}
            submitting={submitting}
            error={error}
            warning={
              f.inAppStarted
                ? 'Lưu kết quả làm cùng nhân viên y tế sẽ thay thế các câu trả lời phần hỏi thêm đang làm dở trong ứng dụng.'
                : null
            }
            onSubmit={onSave}
          />
        </div>
      </details>
    </section>
  )
}

function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="card-duo px-6 py-8 text-center">
      <div className="text-base font-black text-duo-ink">{title}</div>
      <p className="mt-1 text-sm font-semibold text-duo-mute">{children}</p>
    </div>
  )
}
