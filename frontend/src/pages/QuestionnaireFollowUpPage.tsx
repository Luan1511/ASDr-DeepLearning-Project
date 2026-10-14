import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Check, Loader2, Pause } from 'lucide-react'
import { DashboardLayout } from '../layouts/DashboardLayout'
import { CopyrightLine } from '../components/questionnaire/CopyrightLine'
import { FollowUpStepView, type StepAnswer } from '../components/questionnaire/FollowUpStepView'
import { apiErrorCode } from '../lib/api'
import {
  ASSISTED_ANCHOR,
  CONTENT_UNAVAILABLE_MESSAGE,
  FOLLOW_UP_ASSISTED,
  FOLLOW_UP_ASSISTED_LINK,
  FOLLOW_UP_DURATION,
  FOLLOW_UP_RESUME,
  FOLLOW_UP_TITLE,
  FOLLOW_UP_WHY,
  QUESTIONNAIRE_DISABLED_MESSAGE,
  QUESTIONNAIRE_MIGRATION_MESSAGE,
  Q_NAV_BUTTON,
  Q_TEXT_LINK,
  STEP_MISMATCH_MESSAGE,
  answerFollowUp,
  contentNoticeOf,
  fetchFollowUpState,
  fetchMchatContent,
  followUpBack,
  questionnaireApiErrorMessage,
  questionnaireUnavailableReason,
  resultPath,
} from '../lib/questionnaires'
import type { FollowUpStateDto, McHatContentDto } from '../lib/questionnaireTypes'

type Ready = { status: 'ready'; state: FollowUpStateDto; showIntro: boolean }
/** "Other" text typed before answering MAYBE on that row: posted with the YES resolution. */
type PendingOther = { item: number; node: string; example: string | undefined; otherText: string }
type LoadState =
  | { status: 'loading' }
  | { status: 'notFound' }
  | { status: 'unavailable'; message: string }
  | { status: 'error'; message: string }
  | { status: 'done' }
  | Ready

/** Finished (or never pending) → the result page shows the outcome. */
function isOver(state: FollowUpStateDto) {
  return state.status !== 'PENDING' || !state.current
}

function failure(error: unknown, fallback: string): LoadState {
  const code = apiErrorCode(error)
  if (code === 'RESPONSE_NOT_FOUND' || code === 'VALIDATION_ERROR') return { status: 'notFound' }
  if (code === 'FOLLOW_UP_NOT_APPLICABLE') return { status: 'done' }
  if (code === 'QUESTIONNAIRE_CONTENT_UNAVAILABLE') return { status: 'unavailable', message: CONTENT_UNAVAILABLE_MESSAGE }
  const reason = questionnaireUnavailableReason(error)
  if (reason === 'disabled' || reason === 'absent') return { status: 'unavailable', message: QUESTIONNAIRE_DISABLED_MESSAGE }
  if (reason === 'migration') return { status: 'unavailable', message: QUESTIONNAIRE_MIGRATION_MESSAGE }
  return { status: 'error', message: questionnaireApiErrorMessage(error, fallback) }
}

async function loadFollowUp(id: string): Promise<LoadState> {
  try {
    const state = await fetchFollowUpState(id)
    if (isOver(state)) return { status: 'done' }
    // Explain the Follow-Up before the first answer; a resumed one goes straight to its step.
    return { status: 'ready', state, showIntro: state.items.every((i) => i.state === 'TODO') }
  } catch (e) {
    return failure(e, 'Không tải được phần hỏi thêm. Vui lòng thử lại.')
  }
}

export function QuestionnaireFollowUpPage() {
  const { id = '' } = useParams()
  return <FollowUp key={id} id={id} />
}

function FollowUp({ id }: { id: string }) {
  const navigate = useNavigate()
  const [load, setLoad] = useState<LoadState>({ status: 'loading' })
  // Optional: verbatim Follow-Up instructions + yes/no labels; the steps work without it.
  const [content, setContent] = useState<McHatContentDto | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Synchronous guard: two taps/keys in the same tick must not both POST (render-time `busy` is stale).
  const inFlight = useRef(false)
  const pendingOther = useRef<PendingOther | null>(null)

  useEffect(() => {
    let stale = false
    void loadFollowUp(id).then((next) => {
      if (stale) return
      if (next.status === 'done') navigate(resultPath(id), { replace: true })
      else setLoad(next)
    })
    fetchMchatContent().then(
      (c) => !stale && setContent(c),
      () => undefined,
    )
    return () => {
      stale = true
    }
  }, [id, navigate])

  function apply(next: FollowUpStateDto) {
    if (isOver(next)) {
      navigate(resultPath(id), { replace: true })
      return
    }
    setLoad({ status: 'ready', state: next, showIntro: false })
  }

  async function refresh() {
    try {
      apply(await fetchFollowUpState(id))
    } catch (e) {
      const next = failure(e, 'Không tải được phần hỏi thêm. Vui lòng thử lại.')
      if (next.status === 'done') navigate(resultPath(id), { replace: true })
      else setLoad(next)
    }
  }

  async function handleError(e: unknown, fallback: string) {
    const code = apiErrorCode(e)
    if (code === 'STEP_MISMATCH') {
      // The server moved on (another tab/device): show where it is now.
      setNotice(STEP_MISMATCH_MESSAGE)
      await refresh()
      return
    }
    if (code === 'FOLLOW_UP_NOT_APPLICABLE') {
      navigate(resultPath(id), { replace: true })
      return
    }
    if (code === 'QUESTIONNAIRE_CONTENT_UNAVAILABLE' || code === 'QUESTIONNAIRE_DISABLED') {
      // Content removed or feature switched off mid-flow: leave the step for the notice with the assisted link.
      setLoad(failure(e, fallback))
      return
    }
    setError(questionnaireApiErrorMessage(e, fallback))
  }

  async function run(action: () => Promise<void>) {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await action()
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  function withPendingOther(item: number, node: string, input: StepAnswer): StepAnswer {
    if (input.value === 'MAYBE') {
      // MAYBE is not recorded: keep the description for the YES resolution of the same row.
      const { otherText, ...rest } = input
      pendingOther.current = otherText ? { item, node, example: input.example, otherText } : null
      return rest
    }
    const kept = pendingOther.current
    pendingOther.current = null
    if (input.maybe && input.value === 'YES' && kept && kept.item === item && kept.node === node && kept.example === input.example) {
      return { ...input, otherText: kept.otherText }
    }
    return input
  }

  function answer(state: FollowUpStateDto, input: StepAnswer) {
    const current = state.current
    if (!current) return
    void run(async () => {
      try {
        const body = withPendingOther(current.item, current.step.node, input)
        apply(await answerFollowUp(id, { item: current.item, node: current.step.node, ...body }))
      } catch (e) {
        await handleError(e, 'Không lưu được câu trả lời. Vui lòng thử lại.')
      }
    })
  }

  function back(state: FollowUpStateDto) {
    void run(async () => {
      pendingOther.current = null
      // A MAYBE_RESOLVE view is not recorded: going back just re-reads the yes/no question.
      if (state.current?.step.kind === 'MAYBE_RESOLVE') {
        await refresh()
        return
      }
      try {
        apply(await followUpBack(id))
      } catch (e) {
        await handleError(e, 'Không quay lại được câu trước. Vui lòng thử lại.')
      }
    })
  }

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-3xl space-y-6">
        <Link to={resultPath(id)} className={`link-duo text-xs ${Q_TEXT_LINK} -ml-2`}>
          <ArrowLeft className="h-4 w-4" />
          Kết quả bảng hỏi
        </Link>

        {(load.status === 'loading' || load.status === 'done') && (
          <div className="text-sm font-semibold text-duo-mute">Đang tải...</div>
        )}
        {load.status === 'notFound' && (
          <Notice title="Không tìm thấy lần trả lời">Lần trả lời có thể đã bị xoá hoặc không thuộc tài khoản của bạn.</Notice>
        )}
        {load.status === 'unavailable' && (
          <Notice title={FOLLOW_UP_TITLE}>
            <span className="block">{load.message}</span>
            <Link to={`${resultPath(id)}#${ASSISTED_ANCHOR}`} className={`btn-duo-secondary mt-4 ${Q_NAV_BUTTON}`}>
              {FOLLOW_UP_ASSISTED_LINK}
            </Link>
          </Notice>
        )}
        {load.status === 'error' && (
          <div className="space-y-3">
            <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-bold text-duo-red">{load.message}</div>
            <button type="button" className={`btn-duo-secondary ${Q_NAV_BUTTON}`} onClick={() => void refresh()}>
              Thử lại
            </button>
          </div>
        )}

        {load.status === 'ready' && load.showIntro && (
          <Intro
            id={id}
            state={load.state}
            onStart={() => setLoad({ ...load, showIntro: false })}
          />
        )}
        {load.status === 'ready' && !load.showIntro && (
          <StepScreen
            id={id}
            state={load.state}
            content={content}
            busy={busy}
            notice={notice}
            error={error}
            onAnswer={(input) => answer(load.state, input)}
            onBack={() => back(load.state)}
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
      <div className="mt-1 text-sm font-semibold text-duo-mute">{children}</div>
    </div>
  )
}

function Intro({
  id,
  state,
  onStart,
}: {
  id: string
  state: FollowUpStateDto
  onStart: () => void
}) {
  return (
    <section className="card-duo space-y-4 p-6" aria-labelledby="follow-up-intro">
      <h1 id="follow-up-intro" className="text-xl font-black text-duo-ink">
        {FOLLOW_UP_TITLE}
      </h1>
      <ul className="list-disc space-y-1.5 pl-5 text-sm font-semibold leading-relaxed text-duo-ink">
        <li>{FOLLOW_UP_WHY}</li>
        <li>
          Có {state.items.length} mục cần hỏi thêm. {FOLLOW_UP_DURATION}
        </li>
        <li>{FOLLOW_UP_RESUME}</li>
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={`btn-duo ${Q_NAV_BUTTON}`} onClick={onStart}>
          Bắt đầu phần hỏi thêm
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </button>
        <Link to={`${resultPath(id)}#${ASSISTED_ANCHOR}`} className={`btn-duo-secondary ${Q_NAV_BUTTON}`}>
          {FOLLOW_UP_ASSISTED_LINK}
        </Link>
      </div>
      <p className="text-xs font-semibold text-duo-mute">{FOLLOW_UP_ASSISTED}</p>
      <CopyrightLine notice={contentNoticeOf(state)} />
    </section>
  )
}

function StepScreen({
  id,
  state,
  content,
  busy,
  notice,
  error,
  onAnswer,
  onBack,
}: {
  id: string
  state: FollowUpStateDto
  content: McHatContentDto | null
  busy: boolean
  notice: string | null
  error: string | null
  onAnswer: (input: StepAnswer) => void
  onBack: () => void
}) {
  const current = state.current!
  const step = current.step
  const position = state.items.findIndex((i) => i.item === current.item)
  const itemNo = position >= 0 ? position + 1 : current.itemIndex + 1
  const itemCount = state.items.length || current.itemCount
  const stepKey = `${current.item}:${step.node}:${step.kind}:${
    step.kind === 'EXAMPLE' || step.kind === 'MAYBE_RESOLVE' ? (step.example ?? '') : ''
  }`
  const headingRef = useRef<HTMLHeadingElement>(null)
  const canGoBack = current.canGoBack || step.kind === 'MAYBE_RESOLVE'

  // New step → move focus to its heading so screen readers read the new question.
  useEffect(() => {
    headingRef.current?.focus()
  }, [stepKey])

  return (
    <div className="space-y-4">
      <nav aria-label="Tiến độ phần hỏi thêm" className="card-duo space-y-2 p-4">
        <div className="text-xs font-extrabold uppercase tracking-wide text-duo-mute">
          {FOLLOW_UP_TITLE} · Mục {itemNo}/{itemCount}
        </div>
        <ol className="flex flex-wrap gap-1.5">
          {state.items.map((i) => {
            const isCurrent = i.item === current.item
            return (
              <li
                key={i.item}
                aria-current={isCurrent ? 'step' : undefined}
                className={[
                  'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-extrabold tabular-nums',
                  isCurrent ? 'bg-duo-ink text-white' : i.state === 'DONE' ? 'bg-duo-mist text-duo-ink' : 'bg-white text-duo-mute ring-1 ring-inset ring-duo-line',
                ].join(' ')}
              >
                {i.state === 'DONE' && !isCurrent && <Check className="h-3 w-3 stroke-[3]" aria-hidden="true" />}
                Câu {i.item}
                <span className="sr-only">{i.state === 'DONE' ? ' (đã xong)' : isCurrent ? ' (đang làm)' : ' (chưa làm)'}</span>
              </li>
            )
          })}
        </ol>
      </nav>

      {notice && <div className="rounded-2xl bg-yellow-50 px-4 py-3 text-sm font-bold text-yellow-800">{notice}</div>}

      <section className="card-duo space-y-5 p-6" aria-labelledby="follow-up-step-heading">
        {current.preamble?.trim() && (
          <p className="whitespace-pre-line rounded-2xl bg-duo-mist px-4 py-3 text-base font-semibold leading-relaxed text-duo-ink">
            {current.preamble}
          </p>
        )}
        <div className="space-y-1">
          <h1
            id="follow-up-step-heading"
            ref={headingRef}
            tabIndex={-1}
            className="whitespace-pre-line text-base font-black leading-relaxed text-duo-ink outline-none"
          >
            {current.header.trim() || `Câu ${current.item}`}
          </h1>
          {current.recap.trim() && (
            <p className="whitespace-pre-line text-sm font-semibold leading-relaxed text-duo-mute">{current.recap}</p>
          )}
        </div>

        <FollowUpStepView
          key={stepKey}
          step={step}
          busy={busy}
          onAnswer={onAnswer}
          labels={content ? { yes: content.ui.yes, no: content.ui.no } : undefined}
        />

        {error && <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-bold text-duo-red">{error}</div>}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-duo-line pt-4">
          <button type="button" className={`btn-duo-ghost ${Q_NAV_BUTTON}`} disabled={!canGoBack || busy} onClick={onBack}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ArrowLeft className="h-4 w-4" aria-hidden="true" />}
            Quay lại
          </button>
          <Link to={resultPath(id)} className={`${Q_TEXT_LINK} text-xs font-extrabold text-duo-mute hover:underline`}>
            <Pause className="h-3.5 w-3.5" aria-hidden="true" />
            Tạm dừng, làm tiếp sau
          </Link>
        </div>
        <p className="hidden text-xs font-semibold text-duo-mute sm:block">Phím tắt khi có nút Có/Không: C = Có, K = Không.</p>
        <CopyrightLine notice={contentNoticeOf(state)} />
      </section>
    </div>
  )
}
