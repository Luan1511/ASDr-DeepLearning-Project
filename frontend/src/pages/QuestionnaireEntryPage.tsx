import { useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, ExternalLink, Eye, Loader2, Pencil, Send } from 'lucide-react'
import { DashboardLayout } from '../layouts/DashboardLayout'
import { AgeGateNotice } from '../components/questionnaire/AgeGateNotice'
import { AnswerGrid } from '../components/questionnaire/AnswerGrid'
import { AnswerReview } from '../components/questionnaire/AnswerReview'
import { CopyrightLine } from '../components/questionnaire/CopyrightLine'
import { InAppQuestionnaire } from '../components/questionnaire/InAppQuestionnaire'
import { QuestionnaireConsent } from '../components/questionnaire/QuestionnaireConsent'
import { QuestionnaireDisclaimer } from '../components/questionnaire/QuestionnaireDisclaimer'
import { RespondentPicker } from '../components/questionnaire/RespondentPicker'
import { StepCard } from '../components/questionnaire/StepCard'
import { api, apiErrorCode } from '../lib/api'
import { formatAge } from '../lib/format'
import {
  CONTENT_UNAVAILABLE_NOTE,
  DRAFT_NOTE,
  ENTRY_HELP,
  ENTRY_INSTRUCTIONS,
  INAPP_LINK,
  MCHAT_ITEM_COUNT,
  PAPER_ENTRY_HINT,
  Q_TEXT_LINK,
  QUESTIONNAIRE_DISABLED_MESSAGE,
  QUESTIONNAIRE_MIGRATION_MESSAGE,
  QUESTIONNAIRE_TITLE,
  RESPONDENT_LABEL,
  clearMchatDraft,
  contentNoticeOf,
  fetchChildQuestionnaires,
  fetchMchatContent,
  fetchQuestionnaireConsentStatement,
  fetchQuestionnaires,
  linksOf,
  loadMchatDraft,
  mchatItemElementId,
  missingItems,
  missingItemsOf,
  questionnaireApiErrorMessage,
  questionnaireUnavailableReason,
  saveMchatDraft,
  submitMchatResponse,
  type McHatAnswers,
  type QuestionnaireLinks,
} from '../lib/questionnaires'
import type { EligibilityDto, McHatContentDto, Respondent } from '../lib/questionnaireTypes'
import type { ChildDetail, ChildProfile, ConsentStatement } from '../lib/types'

/** `?mode=paper` opens the official-form entry grid even when the in-app questionnaire is available. */
const PAPER_PARAM = 'paper'

type LoadState =
  | { status: 'loading' }
  | { status: 'notFound' }
  | { status: 'unavailable'; reason: 'disabled' | 'migration' }
  | { status: 'error'; message: string }
  | {
      status: 'ready'
      child: ChildProfile
      eligibility: EligibilityDto
      statement: ConsentStatement
      links: QuestionnaireLinks
      /** Licensed text when the in-app questionnaire is available (null → entry by item number only). */
      content: McHatContentDto | null
      /** The server reported in-app as available but the content could not be loaded. */
      contentFailed: boolean
    }

function failureState(error: unknown, fallback: string): LoadState {
  const code = apiErrorCode(error)
  if (code === 'CHILD_NOT_FOUND' || code === 'VALIDATION_ERROR') return { status: 'notFound' }
  const reason = questionnaireUnavailableReason(error)
  if (reason === 'disabled' || reason === 'absent') return { status: 'unavailable', reason: 'disabled' }
  if (reason === 'migration') return { status: 'unavailable', reason: 'migration' }
  return { status: 'error', message: questionnaireApiErrorMessage(error, fallback) }
}

async function loadEntry(childId: string): Promise<LoadState> {
  try {
    const q = await fetchQuestionnaires()
    if (!q.enabled) return { status: 'unavailable', reason: 'disabled' }
    const [childRes, statement, child, content] = await Promise.all([
      api.get<ChildDetail>(`/children/${childId}`),
      fetchQuestionnaireConsentStatement(),
      fetchChildQuestionnaires(childId),
      // Missing/invalid content (503) falls back to entry by item number.
      q.inApp.available ? fetchMchatContent().catch(() => null) : Promise.resolve(null),
    ])
    return {
      status: 'ready',
      child: childRes.data.child,
      eligibility: child.eligibility.MCHAT_RF,
      statement,
      links: linksOf(q.instruments.find((i) => i.code === 'MCHAT_RF')),
      content,
      contentFailed: q.inApp.available && !content,
    }
  } catch (e) {
    return failureState(e, 'Không tải được bảng hỏi. Vui lòng thử lại.')
  }
}

export function QuestionnaireEntryPage() {
  const { id = '' } = useParams()
  // Remount per child so drafts and consent never leak between profiles.
  return <Entry key={id} childId={id} />
}

function Entry({ childId }: { childId: string }) {
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [searchParams, setSearchParams] = useSearchParams()
  const paperRequested = searchParams.get('mode') === PAPER_PARAM

  function choosePaper(paper: boolean) {
    setSearchParams(paper ? { mode: PAPER_PARAM } : {}, { replace: true })
    window.scrollTo({ top: 0 })
  }

  useEffect(() => {
    let stale = false
    void loadEntry(childId).then((next) => {
      if (!stale) setState(next)
    })
    return () => {
      stale = true
    }
  }, [childId])

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-3xl space-y-6">
        <Link to={`/children/${childId}`} className="link-duo inline-flex items-center gap-1.5 text-xs">
          <ArrowLeft className="h-4 w-4" />
          {state.status === 'ready' ? state.child.fullName : 'Hồ sơ trẻ'}
        </Link>

        {state.status === 'loading' && <div className="text-sm font-semibold text-duo-mute">Đang tải...</div>}
        {state.status === 'notFound' && (
          <Notice title="Không tìm thấy hồ sơ trẻ">Hồ sơ có thể đã bị xoá hoặc không thuộc tài khoản của bạn.</Notice>
        )}
        {state.status === 'unavailable' && (
          <Notice title={QUESTIONNAIRE_TITLE}>
            {state.reason === 'disabled' ? QUESTIONNAIRE_DISABLED_MESSAGE : QUESTIONNAIRE_MIGRATION_MESSAGE}
          </Notice>
        )}
        {state.status === 'error' && (
          <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-bold text-duo-red">{state.message}</div>
        )}
        {state.status === 'ready' && (
          <EntryForm
            child={state.child}
            eligibility={state.eligibility}
            statement={state.statement}
            links={state.links}
            content={paperRequested ? null : state.content}
            inAppOffered={Boolean(state.content)}
            contentFailed={state.contentFailed}
            onChoosePaper={choosePaper}
            onStatementChange={(statement) => setState((prev) => (prev.status === 'ready' ? { ...prev, statement } : prev))}
          />
        )}
      </div>
    </DashboardLayout>
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

function focusItem(n: number) {
  const row = document.getElementById(mchatItemElementId(n))
  if (!row) return
  row.scrollIntoView({ behavior: 'smooth', block: 'center' })
  row.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true })
}

function EntryForm({
  child,
  eligibility,
  statement,
  links,
  content,
  inAppOffered,
  contentFailed,
  onChoosePaper,
  onStatementChange,
}: {
  child: ChildProfile
  eligibility: EligibilityDto
  statement: ConsentStatement
  links: QuestionnaireLinks
  /** Non-null → the in-app questionnaire is shown instead of the entry grid. */
  content: McHatContentDto | null
  inAppOffered: boolean
  contentFailed: boolean
  onChoosePaper: (paper: boolean) => void
  onStatementChange: (statement: ConsentStatement) => void
}) {
  const navigate = useNavigate()
  const [initialDraft] = useState(() => loadMchatDraft(child.id))
  const [respondent, setRespondent] = useState<Respondent | null>(initialDraft.respondent)
  const [answers, setAnswers] = useState<McHatAnswers>(initialDraft.answers)
  const [consentAccepted, setConsentAccepted] = useState(false)
  const [highlightMissing, setHighlightMissing] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const missing = missingItems(answers)

  function updateAnswer(item: number, value: boolean) {
    const next = { ...answers, [item]: value }
    setAnswers(next)
    saveMchatDraft(child.id, { respondent, answers: next })
    if (highlightMissing && missingItems(next).length === 0) setError(null)
  }

  function updateRespondent(value: Respondent) {
    setRespondent(value)
    saveMchatDraft(child.id, { respondent: value, answers })
  }

  function clearDraft() {
    if (!window.confirm('Xoá tất cả câu trả lời đang nhập trên trang này để nhập lại từ đầu.')) return
    clearMchatDraft(child.id)
    setAnswers({})
    setRespondent(null)
    setReviewing(false)
    setHighlightMissing(false)
    setError(null)
  }

  function startReview() {
    if (missing.length) {
      setHighlightMissing(true)
      setReviewing(false)
      setError(`Còn ${missing.length} câu chưa trả lời: câu ${missing.join(', ')}.`)
      focusItem(missing[0])
      return
    }
    setError(null)
    setReviewing(true)
    window.requestAnimationFrame(() =>
      document.getElementById('mchat-step-5')?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    )
  }

  function editItem(n: number) {
    setReviewing(false)
    window.requestAnimationFrame(() => focusItem(n))
  }

  async function submit() {
    if (!respondent || !consentAccepted || missing.length || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const full: Record<number, boolean> = {}
      for (const [k, v] of Object.entries(answers)) if (typeof v === 'boolean') full[Number(k)] = v
      const response = await submitMchatResponse(child.id, { respondent, answers: full, consentVersion: statement.version })
      clearMchatDraft(child.id)
      navigate(`/questionnaire-responses/${response.id}`, { replace: true })
    } catch (e) {
      const code = apiErrorCode(e)
      setError(questionnaireApiErrorMessage(e, 'Không gửi được câu trả lời. Vui lòng thử lại.'))
      if (code === 'CONSENT_VERSION_OUTDATED') {
        setConsentAccepted(false)
        fetchQuestionnaireConsentStatement().then(onStatementChange, () => undefined)
      } else if (code === 'INCOMPLETE_ANSWERS') {
        const serverMissing = missingItemsOf(e)
        setHighlightMissing(true)
        setReviewing(false)
        if (serverMissing.length) window.requestAnimationFrame(() => focusItem(serverMissing[0]))
      }
      setSubmitting(false)
    }
  }

  const header = (
    <div className="card-duo space-y-2 p-6">
      <h1 className="text-xl font-black text-duo-ink">{QUESTIONNAIRE_TITLE}</h1>
      <div className="text-sm font-bold text-duo-mute">
        {child.fullName} • {formatAge(child.dateOfBirth)}
      </div>
      <CopyrightLine officialFormUrl={links.officialFormUrl} notice={contentNoticeOf(content)} />
    </div>
  )

  if (!eligibility.eligible) {
    return (
      <>
        {header}
        <AgeGateNotice eligibility={eligibility} cdcMilestonesUrl={links.cdcMilestonesUrl} />
        <Link to={`/children/${child.id}`} className="btn-duo-secondary">
          Về hồ sơ của con
        </Link>
      </>
    )
  }

  if (content) {
    return (
      <>
        {header}
        <InAppQuestionnaire
          child={child}
          content={content}
          statement={statement}
          officialFormUrl={links.officialFormUrl}
          onStatementChange={onStatementChange}
          onUsePaper={() => onChoosePaper(true)}
        />
        <QuestionnaireDisclaimer />
      </>
    )
  }

  const blockers = [
    !respondent && 'chọn người trả lời (bước 2)',
    !consentAccepted && 'xác nhận đồng ý (bước 3)',
  ].filter((b): b is string => Boolean(b))

  return (
    <>
      {header}

      {contentFailed && (
        <div className="rounded-2xl bg-yellow-50 px-4 py-3 text-sm font-bold text-yellow-800">{CONTENT_UNAVAILABLE_NOTE}</div>
      )}
      {inAppOffered && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-duo-mist px-4 py-3">
          <p className="text-sm font-semibold text-duo-ink">{PAPER_ENTRY_HINT}</p>
          <button type="button" className="btn-duo-secondary" onClick={() => onChoosePaper(false)}>
            {INAPP_LINK}
          </button>
        </div>
      )}

      <StepCard index={1} title="Mở phiếu chính thức">
        <p className="text-sm font-semibold leading-relaxed text-duo-ink">{ENTRY_INSTRUCTIONS}</p>
        <a href={links.officialFormUrl} target="_blank" rel="noopener noreferrer" className="btn-duo-secondary">
          <ExternalLink className="h-4 w-4" aria-hidden="true" />
          Mở bản tiếng Việt trên mchatscreen.com
        </a>
        <p className="text-xs font-bold text-duo-mute">{ENTRY_HELP}</p>
      </StepCard>

      <StepCard index={2} title="Người trả lời">
        <RespondentPicker value={respondent} onChange={updateRespondent} labelledBy="mchat-step-2" />
      </StepCard>

      <StepCard index={3} title="Đồng ý lưu câu trả lời">
        <QuestionnaireConsent
          statement={statement}
          childName={child.fullName}
          accepted={consentAccepted}
          onAccept={() => setConsentAccepted(true)}
          onReview={() => setConsentAccepted(false)}
        />
      </StepCard>

      <StepCard index={4} title={`Nhập câu trả lời (${MCHAT_ITEM_COUNT} câu)`}>
        <p className="text-xs font-bold text-duo-mute">{DRAFT_NOTE}</p>
        <AnswerGrid answers={answers} onChange={updateAnswer} highlightMissing={highlightMissing} disabled={submitting} />
        {error && !reviewing && <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-bold text-duo-red">{error}</div>}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button type="button" className="btn-duo" onClick={startReview} disabled={submitting}>
            <Eye className="h-4 w-4" aria-hidden="true" />
            Xem lại trước khi gửi
          </button>
          <button
            type="button"
            className={`${Q_TEXT_LINK} text-xs font-extrabold text-duo-mute hover:underline disabled:opacity-50`}
            onClick={clearDraft}
            disabled={submitting}
          >
            Xoá câu trả lời đang nhập
          </button>
        </div>
      </StepCard>

      {reviewing && (
        <StepCard index={5} title="Xem lại và gửi">
          <p className="text-sm font-semibold leading-relaxed text-duo-ink">
            Đối chiếu từng câu với phiếu bạn đã điền. Bấm vào một câu để sửa. Sau khi gửi, câu trả lời không sửa được (bạn có thể
            xoá cả lần trả lời).
          </p>
          <AnswerReview answers={answers} onEdit={submitting ? undefined : editItem} />
          {respondent && (
            <div className="text-sm font-bold text-duo-ink">Người trả lời: {RESPONDENT_LABEL[respondent]}</div>
          )}
          {blockers.length > 0 && (
            <div className="rounded-2xl bg-yellow-50 px-4 py-3 text-sm font-bold text-yellow-800">
              Trước khi gửi, hãy {blockers.join(' và ')}.
            </div>
          )}
          {error && <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-bold text-duo-red">{error}</div>}
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-duo" disabled={blockers.length > 0 || submitting} onClick={() => void submit()}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
              {submitting ? 'Đang gửi...' : 'Gửi và xem kết quả'}
            </button>
            <button type="button" className="btn-duo-secondary" disabled={submitting} onClick={() => setReviewing(false)}>
              <Pencil className="h-4 w-4" aria-hidden="true" />
              Sửa câu trả lời
            </button>
          </div>
        </StepCard>
      )}

      <QuestionnaireDisclaimer />
    </>
  )
}
