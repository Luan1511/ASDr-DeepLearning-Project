import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, ClipboardList, Info } from 'lucide-react'
import { DashboardLayout } from '../layouts/DashboardLayout'
import { Card } from '../components/Card'
import { ChildAvatar } from '../components/ChildAvatar'
import { CopyrightLine } from '../components/questionnaire/CopyrightLine'
import { PendingFollowUpBanner } from '../components/questionnaire/PendingFollowUpBanner'
import { QuestionnaireDisclaimer } from '../components/questionnaire/QuestionnaireDisclaimer'
import { ResultStateBadge } from '../components/questionnaire/ResultStateBadge'
import { api } from '../lib/api'
import { formatAge, formatDate } from '../lib/format'
import {
  OUTCOME_SHORT_LABEL,
  QUESTIONNAIRE_DASHBOARD_NOTE,
  QUESTIONNAIRE_DISABLED_MESSAGE,
  fetchChildQuestionnaires,
  fetchQuestionnaires,
  formatCalendarDate,
  linksOf,
  questionnaireApiErrorMessage,
} from '../lib/questionnaires'
import type { ChildQuestionnairesDto, QuestionnairesDto } from '../lib/questionnaireTypes'
import type { ChildProfile } from '../lib/types'

type Row = { child: ChildProfile; data: ChildQuestionnairesDto | null; error: string | null }

function EligibilityLine({ data }: { data: ChildQuestionnairesDto }) {
  const e = data.eligibility.MCHAT_RF
  if (e.eligible) {
    return <span className="text-duo-green-dark">Trong độ tuổi làm M-CHAT-R/F ({e.ageMonths} tháng)</span>
  }
  if (e.reason === 'TOO_YOUNG') {
    return <span className="text-duo-mute">Chưa tới tuổi — có thể làm từ {formatCalendarDate(e.eligibleFrom)}</span>
  }
  return <span className="text-duo-mute">Ngoài độ tuổi của M-CHAT-R/F (16–30 tháng)</span>
}

function ChildRow({ row, enabled }: { row: Row; enabled: boolean }) {
  const { child, data, error } = row
  const latest = data?.responses[0] ?? null
  const pending = data?.responses.filter((r) => r.followUpStatus === 'PENDING') ?? []
  const eligible = Boolean(data?.eligibility.MCHAT_RF.eligible)
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl px-4 py-3 hover:bg-duo-mist">
      <ChildAvatar name={child.fullName} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-extrabold text-duo-ink">{child.fullName}</div>
        <div className="mt-0.5 text-xs font-bold">
          <span className="text-duo-mute">{formatAge(child.dateOfBirth)} • </span>
          {data ? <EligibilityLine data={data} /> : <span className="text-duo-red">{error ?? 'Đang tải...'}</span>}
        </div>
        {latest && (
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs font-bold text-duo-mute">
            <Link to={`/questionnaire-responses/${latest.id}`} className="inline-flex flex-wrap items-center gap-2 hover:underline">
              <ResultStateBadge response={latest} />
              <span>
                {formatDate(latest.completedAt)} • {OUTCOME_SHORT_LABEL[latest.outcome]}
              </span>
            </Link>
          </div>
        )}
        {enabled &&
          pending.map((r) => (
            <div key={r.id} className="mt-2">
              <PendingFollowUpBanner response={r} compact />
            </div>
          ))}
      </div>
      <div className="flex flex-shrink-0 items-center gap-2">
        {eligible && (
          <Link to={`/children/${child.id}/questionnaires/mchat`} className="btn-duo !px-4 !py-2 !text-xs">
            <ClipboardList className="h-4 w-4" />
            {latest ? 'Làm lại' : 'Làm bảng hỏi'}
          </Link>
        )}
        <Link to={`/children/${child.id}`} className="link-duo inline-flex items-center gap-1 text-xs">
          Hồ sơ <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  )
}

/** Entry point for parent questionnaires: which child can take which questionnaire, and past results. */
export function QuestionnairesPage() {
  const [info, setInfo] = useState<QuestionnairesDto | null>(null)
  const [rows, setRows] = useState<Row[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let stale = false
    fetchQuestionnaires().then(
      (q) => !stale && setInfo(q),
      (e) => !stale && setError(questionnaireApiErrorMessage(e, 'Không tải được thông tin bảng hỏi.')),
    )
    api.get('/children').then(
      async (res) => {
        const children: ChildProfile[] = res.data.children ?? []
        const loaded = await Promise.all(
          children.map(async (child): Promise<Row> => {
            try {
              return { child, data: await fetchChildQuestionnaires(child.id), error: null }
            } catch (e) {
              return { child, data: null, error: questionnaireApiErrorMessage(e, 'Không tải được.') }
            }
          }),
        )
        if (!stale) setRows(loaded)
      },
      (e) => !stale && setError(questionnaireApiErrorMessage(e, 'Không tải được danh sách hồ sơ trẻ.')),
    )
    return () => {
      stale = true
    }
  }, [])

  const instrument = info?.instruments[0] ?? null

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-black text-duo-ink">Bảng hỏi phụ huynh</h1>
          <p className="mt-1 text-sm font-semibold text-duo-mute">
            Một cách đánh giá bổ sung bên cạnh sàng lọc bằng video: phụ huynh trả lời bảng hỏi về hành vi hằng ngày của con.
          </p>
        </div>

        {error && <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-bold text-duo-red">{error}</div>}
        {info && !info.enabled && (
          <div className="rounded-2xl bg-yellow-50 px-4 py-3 text-sm font-bold text-yellow-900">{QUESTIONNAIRE_DISABLED_MESSAGE}</div>
        )}

        <Card title="M-CHAT-R/F (16–30 tháng tuổi)">
          <div className="space-y-2 text-sm font-semibold leading-relaxed text-duo-ink">
            <p>
              M-CHAT-R/F là bảng hỏi sàng lọc được dùng rộng rãi (và trong bộ công cụ của Bộ Y tế) cho trẻ 16–30 tháng tuổi: 20 câu
              Có/Không, tự tính điểm; nếu kết quả ở mức trung bình thì làm thêm phần hỏi thêm (Follow-Up).
            </p>
            {info?.inApp.available && (
              <p>
                Bạn có thể trả lời cả 20 câu{info.inApp.followUpAvailable ? ' và phần hỏi thêm' : ''} trực tiếp trong ứng dụng, hoặc
                nhập theo phiếu giấy chính thức.
              </p>
            )}
            <p className="flex items-start gap-2 text-xs font-bold text-duo-mute">
              <Info className="mt-0.5 h-4 w-4 flex-shrink-0" />
              {QUESTIONNAIRE_DASHBOARD_NOTE}
            </p>
          </div>
        </Card>

        <Card title="Chọn hồ sơ trẻ">
          {rows === null && !error && <div className="py-4 text-sm font-semibold text-duo-mute">Đang tải...</div>}
          {rows && rows.length === 0 && (
            <div className="py-4 text-sm font-semibold text-duo-mute">
              Chưa có hồ sơ trẻ.{' '}
              <Link to="/children" className="link-duo">
                Tạo hồ sơ
              </Link>
            </div>
          )}
          {rows && rows.length > 0 && (
            <div className="space-y-1">
              {rows.map((row) => (
                <ChildRow key={row.child.id} row={row} enabled={info?.enabled ?? false} />
              ))}
            </div>
          )}
        </Card>

        <QuestionnaireDisclaimer />
        <CopyrightLine officialFormUrl={linksOf(instrument).officialFormUrl} />
      </div>
    </DashboardLayout>
  )
}
