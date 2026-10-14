import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Eye, Loader2, Pencil, Send } from 'lucide-react'
import { apiErrorCode } from '../../lib/api'
import {
  ANSWER_LABEL,
  DRAFT_NOTE,
  INAPP_INTRO,
  INAPP_KEYBOARD_HINT,
  MCHAT_ITEM_COUNT,
  MCHAT_ITEM_NUMBERS,
  PAPER_ENTRY_LINK,
  Q_NAV_BUTTON,
  Q_TEXT_LINK,
  RESPONDENT_LABEL,
  canTakeFollowUpInApp,
  clearInAppDraft,
  contentNoticeOf,
  fetchQuestionnaireConsentStatement,
  followUpPath,
  loadInAppDraft,
  missingItems,
  missingItemsOf,
  questionnaireApiErrorMessage,
  resultPath,
  saveInAppDraft,
  submitMchatResponse,
  type McHatAnswers,
} from '../../lib/questionnaires'
import type { McHatContentDto, Respondent } from '../../lib/questionnaireTypes'
import type { ChildProfile, ConsentStatement } from '../../lib/types'
import { AnswerButton } from './AnswerButton'
import { AnswerReview } from './AnswerReview'
import { CopyrightLine } from './CopyrightLine'
import { QuestionnaireConsent } from './QuestionnaireConsent'
import { RespondentPicker } from './RespondentPicker'
import { StepCard } from './StepCard'

type Phase = 'setup' | 'item' | 'review'
type Stage1Item = McHatContentDto['stage1'][number]

/** The 20 items in order, or null when the content does not hold exactly items 1..20. */
function orderedItems(content: McHatContentDto): Stage1Item[] | null {
  const items = MCHAT_ITEM_NUMBERS.map((n) => content.stage1.find((i) => i.number === n))
  return items.every((i): i is Stage1Item => Boolean(i && i.text.trim())) ? items : null
}

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

/** After an answer moves to another screen, taps/keys are ignored this long (double tap, bouncing key). */
const ADVANCE_LOCK_MS = 300

/**
 * In-app M-CHAT-R/F (spec §5): respondent → consent → one item per screen (verbatim
 * text from the licensed content) → review → submit as IN_APP. Draft in sessionStorage only.
 */
export function InAppQuestionnaire({
  child,
  content,
  statement,
  officialFormUrl,
  onStatementChange,
  onUsePaper,
}: {
  child: ChildProfile
  content: McHatContentDto
  statement: ConsentStatement
  officialFormUrl: string
  onStatementChange: (statement: ConsentStatement) => void
  onUsePaper: () => void
}) {
  const items = orderedItems(content)
  if (!items) {
    return (
      <div className="space-y-3 rounded-2xl bg-yellow-50 px-4 py-3 text-sm font-bold text-yellow-800">
        <p>Nội dung bảng hỏi trên máy chủ chưa đầy đủ nên chưa thể trả lời trong ứng dụng.</p>
        <button type="button" className={`btn-duo-secondary ${Q_NAV_BUTTON}`} onClick={onUsePaper}>
          {PAPER_ENTRY_LINK}
        </button>
      </div>
    )
  }
  return (
    <Flow
      child={child}
      content={content}
      items={items}
      statement={statement}
      officialFormUrl={officialFormUrl}
      onStatementChange={onStatementChange}
      onUsePaper={onUsePaper}
    />
  )
}

function Flow({
  child,
  content,
  items,
  statement,
  officialFormUrl,
  onStatementChange,
  onUsePaper,
}: {
  child: ChildProfile
  content: McHatContentDto
  items: Stage1Item[]
  statement: ConsentStatement
  officialFormUrl: string
  onStatementChange: (statement: ConsentStatement) => void
  onUsePaper: () => void
}) {
  const navigate = useNavigate()
  const [initial] = useState(() => loadInAppDraft(child.id, content.contentVersion))
  const [respondent, setRespondent] = useState<Respondent | null>(initial.respondent)
  const [answers, setAnswers] = useState<McHatAnswers>(initial.answers)
  const [index, setIndex] = useState(initial.index)
  const [phase, setPhase] = useState<Phase>('setup')
  const [consentAccepted, setConsentAccepted] = useState(false)
  const [returnToReview, setReturnToReview] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The content went away on the server while answering: offer the paper entry on the review screen.
  const [contentGone, setContentGone] = useState(false)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const lockedUntil = useRef(0)

  /** True (and nothing happens) right after an advance, so a double tap cannot answer the next screen. */
  function locked() {
    return Date.now() < lockedUntil.current
  }

  function lockAfterAdvance() {
    lockedUntil.current = Date.now() + ADVANCE_LOCK_MS
  }

  const yesLabel = content.ui.yes.trim() || ANSWER_LABEL.yes
  const noLabel = content.ui.no.trim() || ANSWER_LABEL.no
  const missing = missingItems(answers)
  const answeredCount = MCHAT_ITEM_COUNT - missing.length
  const item = items[index]
  const current = answers[item.number]

  function persist(next: { respondent?: Respondent | null; answers?: McHatAnswers; index?: number }) {
    saveInAppDraft(child.id, {
      contentVersion: content.contentVersion,
      respondent: next.respondent !== undefined ? next.respondent : respondent,
      answers: next.answers ?? answers,
      index: next.index ?? index,
    })
  }

  function goTo(nextIndex: number) {
    setIndex(nextIndex)
    setPhase('item')
    persist({ index: nextIndex })
  }

  function openReview() {
    setReturnToReview(false)
    setPhase('review')
    setError(null)
  }

  function answer(value: boolean) {
    if (submitting || locked()) return
    lockAfterAdvance()
    const next = { ...answers, [item.number]: value }
    setAnswers(next)
    const left = missingItems(next)
    if (returnToReview && left.length === 0) {
      persist({ answers: next })
      openReview()
      return
    }
    if (index < MCHAT_ITEM_COUNT - 1) {
      persist({ answers: next, index: index + 1 })
      setIndex(index + 1)
      return
    }
    // Last item: review when complete, else the first item still open.
    if (left.length === 0) {
      persist({ answers: next })
      openReview()
    } else {
      const first = left[0] - 1
      persist({ answers: next, index: first })
      setIndex(first)
    }
  }

  function back() {
    if (index === 0) {
      setPhase('setup')
      return
    }
    goTo(index - 1)
  }

  function forward() {
    if (typeof current !== 'boolean') return
    if (index < MCHAT_ITEM_COUNT - 1) goTo(index + 1)
    else if (missing.length === 0) openReview()
  }

  function start() {
    if (!respondent || !consentAccepted) return
    setError(null)
    // All answered (e.g. back from the review to re-confirm consent): straight to the review; else resume where they were.
    if (missing.length === 0) openReview()
    else goTo(index)
  }

  function restart() {
    if (!window.confirm('Xoá tất cả câu trả lời đang làm để bắt đầu lại từ câu 1.')) return
    clearInAppDraft(child.id)
    setAnswers({})
    setIndex(0)
    setReturnToReview(false)
    setPhase('setup')
    setError(null)
  }

  function updateRespondent(value: Respondent) {
    setRespondent(value)
    persist({ respondent: value })
  }

  async function submit() {
    if (!respondent || !consentAccepted || missing.length || submitting || locked()) return
    setSubmitting(true)
    setError(null)
    try {
      const full: Record<number, boolean> = {}
      for (const [k, v] of Object.entries(answers)) if (typeof v === 'boolean') full[Number(k)] = v
      const response = await submitMchatResponse(child.id, {
        respondent,
        answers: full,
        consentVersion: statement.version,
        mode: 'IN_APP',
      })
      clearInAppDraft(child.id)
      // Without the Follow-Up pages in the content file, the result page offers the assisted Follow-Up entry.
      navigate(canTakeFollowUpInApp(response) ? followUpPath(response.id) : resultPath(response.id), { replace: true })
    } catch (e) {
      const code = apiErrorCode(e)
      setError(questionnaireApiErrorMessage(e, 'Không gửi được câu trả lời. Vui lòng thử lại.'))
      if (code === 'CONSENT_VERSION_OUTDATED') {
        setConsentAccepted(false)
        setPhase('setup')
        fetchQuestionnaireConsentStatement().then(onStatementChange, () => undefined)
      } else if (code === 'INCOMPLETE_ANSWERS') {
        const serverMissing = missingItemsOf(e)
        if (serverMissing.length) goTo(serverMissing[0] - 1)
      } else if (code === 'QUESTIONNAIRE_CONTENT_UNAVAILABLE') {
        setContentGone(true)
      }
      setSubmitting(false)
    }
  }

  // Move focus to the new question so screen readers announce it.
  useEffect(() => {
    if (phase !== 'setup') headingRef.current?.focus()
  }, [phase, index])

  // Keyboard: C/1 = Có, K/2 = Không, ← previous, → next (when answered).
  useEffect(() => {
    if (phase !== 'item') return
    function onKey(event: KeyboardEvent) {
      // Held keys auto-repeat: only a fresh key press answers.
      if (event.repeat || event.altKey || event.ctrlKey || event.metaKey || isTypingTarget(event.target)) return
      const key = event.key.toLowerCase()
      if (key === 'c' || key === '1') answer(true)
      else if (key === 'k' || key === '2') answer(false)
      else if (key === 'arrowleft') back()
      else if (key === 'arrowright') forward()
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const copyright = <CopyrightLine officialFormUrl={officialFormUrl} notice={contentNoticeOf(content)} />

  if (phase === 'item') {
    return (
      <section className="card-duo space-y-5 p-6" aria-labelledby="mchat-item-heading">
        <div className="flex items-center justify-between gap-3">
          <h2
            id="mchat-item-heading"
            ref={headingRef}
            tabIndex={-1}
            aria-describedby="mchat-item-text"
            className="text-sm font-extrabold uppercase tracking-wide text-duo-mute outline-none"
          >
            Câu {item.number}/{MCHAT_ITEM_COUNT}
          </h2>
          {returnToReview && (
            <button type="button" className={`${Q_TEXT_LINK} -mr-2 text-xs font-extrabold text-duo-blue hover:underline`} onClick={openReview}>
              Về trang xem lại
            </button>
          )}
        </div>

        <div id="mchat-item-text" className="space-y-3">
          <p className="whitespace-pre-line text-lg font-bold leading-relaxed text-duo-ink">{item.text}</p>
          {item.examples.trim() && (
            <p className="whitespace-pre-line text-base font-semibold leading-relaxed text-duo-ink">{item.examples}</p>
          )}
        </div>

        <div className="flex gap-3" role="group" aria-label={`Trả lời câu ${item.number}`}>
          <AnswerButton selected={current === true} disabled={submitting} onClick={() => answer(true)} hint="C">
            {yesLabel}
          </AnswerButton>
          <AnswerButton selected={current === false} disabled={submitting} onClick={() => answer(false)} hint="K">
            {noLabel}
          </AnswerButton>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <button type="button" className={`btn-duo-ghost ${Q_NAV_BUTTON}`} onClick={back}>
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            {index === 0 ? 'Về bước chuẩn bị' : 'Câu trước'}
          </button>
          <div className="flex flex-wrap gap-2">
            {missing.length === 0 && (
              <button type="button" className={`btn-duo-secondary ${Q_NAV_BUTTON}`} onClick={openReview}>
                <Eye className="h-4 w-4" aria-hidden="true" />
                Xem lại trước khi gửi
              </button>
            )}
            {index < MCHAT_ITEM_COUNT - 1 && (
              <button
                type="button"
                className={`btn-duo-ghost ${Q_NAV_BUTTON}`}
                onClick={forward}
                disabled={typeof current !== 'boolean'}
              >
                Câu sau
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
          </div>
        </div>

        <p className="hidden text-xs font-semibold text-duo-mute sm:block">{INAPP_KEYBOARD_HINT}</p>
        {copyright}
      </section>
    )
  }

  if (phase === 'review') {
    const blockers = [!respondent && 'chọn người trả lời', !consentAccepted && 'xác nhận đồng ý'].filter(
      (b): b is string => Boolean(b),
    )
    return (
      <section className="card-duo space-y-4 p-6" aria-labelledby="mchat-review-heading">
        <h2
          id="mchat-review-heading"
          ref={headingRef}
          tabIndex={-1}
          className="text-sm font-extrabold uppercase tracking-wide text-duo-ink outline-none"
        >
          Xem lại và gửi
        </h2>
        <p className="text-sm font-semibold leading-relaxed text-duo-ink">
          Bấm vào một câu để xem lại và sửa. Sau khi gửi, câu trả lời không sửa được (bạn có thể xoá cả lần trả lời).
        </p>
        <AnswerReview
          answers={answers}
          onEdit={
            submitting
              ? undefined
              : (n) => {
                  if (locked()) return
                  setReturnToReview(true)
                  goTo(n - 1)
                }
          }
        />
        {respondent && <div className="text-sm font-bold text-duo-ink">Người trả lời: {RESPONDENT_LABEL[respondent]}</div>}
        {blockers.length > 0 && (
          <div className="rounded-2xl bg-yellow-50 px-4 py-3 text-sm font-bold text-yellow-800">
            Trước khi gửi, hãy quay lại bước chuẩn bị để {blockers.join(' và ')}.
          </div>
        )}
        {error && <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-bold text-duo-red">{error}</div>}
        {contentGone && (
          <button type="button" className={`btn-duo-secondary ${Q_NAV_BUTTON}`} disabled={submitting} onClick={onUsePaper}>
            {PAPER_ENTRY_LINK}
          </button>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={`btn-duo ${Q_NAV_BUTTON}`}
            disabled={blockers.length > 0 || missing.length > 0 || submitting}
            onClick={() => void submit()}
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
            {submitting ? 'Đang gửi...' : 'Gửi câu trả lời'}
          </button>
          <button
            type="button"
            className={`btn-duo-secondary ${Q_NAV_BUTTON}`}
            disabled={submitting}
            onClick={() => goTo(MCHAT_ITEM_COUNT - 1)}
          >
            <Pencil className="h-4 w-4" aria-hidden="true" />
            Quay lại câu {MCHAT_ITEM_COUNT}
          </button>
          {blockers.length > 0 && (
            <button type="button" className={`btn-duo-ghost ${Q_NAV_BUTTON}`} disabled={submitting} onClick={() => setPhase('setup')}>
              Về bước chuẩn bị
            </button>
          )}
        </div>
        {copyright}
      </section>
    )
  }

  const started = answeredCount > 0
  return (
    <>
      <StepCard index={1} title="Trước khi bắt đầu">
        <p className="text-sm font-semibold leading-relaxed text-duo-ink">{INAPP_INTRO}</p>
        {content.ui.stage1Instructions.trim() && (
          <p className="whitespace-pre-line rounded-2xl bg-duo-mist px-4 py-3 text-sm font-semibold leading-relaxed text-duo-ink">
            {content.ui.stage1Instructions}
          </p>
        )}
        <p className="text-xs font-bold text-duo-mute">{DRAFT_NOTE}</p>
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

      <div className="card-duo space-y-3 p-5">
        {started && (
          <p className="text-sm font-bold text-duo-ink">
            Đã trả lời {answeredCount}/{MCHAT_ITEM_COUNT} câu trên tab này.
          </p>
        )}
        {error && <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-bold text-duo-red">{error}</div>}
        {(!respondent || !consentAccepted) && (
          <p className="text-xs font-bold text-duo-mute">Chọn người trả lời và xác nhận đồng ý để bắt đầu.</p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={`btn-duo ${Q_NAV_BUTTON}`} disabled={!respondent || !consentAccepted} onClick={start}>
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
            {started ? 'Tiếp tục trả lời' : 'Bắt đầu trả lời'}
          </button>
          {started && (
            <button type="button" className={`${Q_TEXT_LINK} text-xs font-extrabold text-duo-mute hover:underline`} onClick={restart}>
              Xoá câu trả lời đang làm
            </button>
          )}
        </div>
        <button
          type="button"
          className={`${Q_TEXT_LINK} -ml-2 text-xs font-bold text-duo-mute underline-offset-2 hover:underline`}
          onClick={onUsePaper}
        >
          Đã điền phiếu giấy? Nhập theo phiếu giấy
        </button>
        {copyright}
      </div>
    </>
  )
}
