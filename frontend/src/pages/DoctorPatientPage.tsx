import { useEffect, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, EyeOff, Loader2 } from 'lucide-react'
import { DashboardLayout } from '../layouts/DashboardLayout'
import { Card } from '../components/Card'
import { ChildAvatar } from '../components/ChildAvatar'
import { GaitFeaturesCard } from '../components/GaitFeaturesCard'
import { ModelScoreBar, RiskPill } from '../components/RiskPill'
import { ExerciseProgressChart } from '../components/exercise/ExerciseProgressChart'
import { LikelihoodBadge } from '../components/questionnaire/LikelihoodBadge'
import {
  DOCTOR_VIEW_DISCLAIMER,
  SHARE_SCOPE_LABEL,
  doctorApiErrorMessage,
  fetchPatientRecord,
  type DoctorShareScope,
  type PatientRecordDto,
} from '../lib/doctors'
import { BODY_FOCUS_LABEL, EXERCISE_DISCLAIMER } from '../lib/exercises'
import { GENDER_LABEL, QUALITY_LABEL, SCREENING_STATUS_LABEL, formatAge, formatBirthDate, formatDate, formatDateTime } from '../lib/format'
import { COMMUNICATION_LABEL, SENSORY_LABEL } from '../lib/personalization'
import { FOLLOW_UP_STATUS_LABEL, OUTCOME_SHORT_LABEL, RESPONDENT_LABEL } from '../lib/questionnaires'
import { apiErrorCode } from '../lib/api'

const ALL_SCOPES: DoctorShareScope[] = ['PROFILE', 'PERSONALIZATION', 'SCREENING', 'QUESTIONNAIRE', 'EXERCISE']

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl bg-duo-mist px-4 py-3">
      <div className="text-xs font-extrabold uppercase tracking-wide text-duo-mute">{label}</div>
      <div className="mt-1 text-sm font-bold leading-relaxed text-duo-ink">{children}</div>
    </div>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-2xl bg-duo-mist px-4 py-5 text-center text-sm font-semibold text-duo-mute">{children}</div>
}

/** Doctor side: one shared record, read-only, limited to what the parent granted. */
export function DoctorPatientPage() {
  const { linkId = '' } = useParams()
  const [record, setRecord] = useState<PatientRecordDto | null>(null)
  const [error, setError] = useState<{ gone: boolean; message: string } | null>(null)
  const [exerciseId, setExerciseId] = useState<string | null>(null)

  useEffect(() => {
    let stale = false
    fetchPatientRecord(linkId).then(
      (data) => !stale && setRecord(data),
      (e: unknown) =>
        !stale &&
        setError({
          gone: apiErrorCode(e) === 'PATIENT_NOT_FOUND',
          message: doctorApiErrorMessage(e, 'Không tải được hồ sơ.'),
        }),
    )
    return () => {
      stale = true
    }
  }, [linkId])

  const back = (
    <Link to="/doctor" className="link-duo inline-flex items-center gap-1.5 text-xs">
      <ArrowLeft className="h-4 w-4" />
      Hồ sơ được chia sẻ
    </Link>
  )

  if (error) {
    return (
      <DashboardLayout>
        <div className="space-y-6">
          {back}
          <div className="flex items-start gap-3 rounded-2xl bg-duo-mist px-5 py-6">
            <EyeOff className="mt-0.5 h-5 w-5 flex-shrink-0 text-duo-mute" />
            <div>
              <div className="text-base font-black text-duo-ink">
                {error.gone ? 'Hồ sơ này không còn được chia sẻ' : 'Không mở được hồ sơ'}
              </div>
              <p className="mt-1 text-sm font-semibold leading-relaxed text-duo-mute">{error.message}</p>
            </div>
          </div>
        </div>
      </DashboardLayout>
    )
  }

  if (!record) {
    return (
      <DashboardLayout>
        <div className="space-y-6">
          {back}
          <div className="flex items-center gap-2 text-sm font-semibold text-duo-mute">
            <Loader2 className="h-4 w-4 animate-spin" />
            Đang tải hồ sơ...
          </div>
        </div>
      </DashboardLayout>
    )
  }

  const { patient, personalization: p, screenings, questionnaires, exercises } = record
  const notShared = ALL_SCOPES.filter((scope) => !patient.scopes.includes(scope))
  const practised = (exercises ?? []).filter((e) => e.attempts > 0)
  // Like the parent's dashboard: start with an exercise that already has a trend to read.
  const selectedExercise =
    practised.find((e) => e.exercise.id === exerciseId) ?? practised.find((e) => e.scoredAttempts >= 2) ?? practised[0] ?? null

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {back}

        <div className="card-duo p-6">
          <div className="flex flex-wrap items-center gap-4">
            <ChildAvatar name={patient.child.fullName} size="lg" />
            <div className="min-w-0 flex-1">
              <h1 className="text-2xl font-black text-duo-ink">{patient.child.fullName}</h1>
              <div className="text-sm font-bold text-duo-mute">
                {formatAge(patient.child.dateOfBirth)} • sinh ngày {formatBirthDate(patient.child.dateOfBirth)} •{' '}
                {GENDER_LABEL[patient.child.gender]}
              </div>
              <div className="text-xs font-bold text-duo-mute">
                Phụ huynh: {patient.parent.name} • chia sẻ từ {formatDate(patient.grantedAt)}
              </div>
            </div>
            <span className="rounded-full bg-duo-mist px-3 py-1 text-xs font-extrabold text-duo-mute">Chỉ xem</span>
          </div>
          {patient.child.note && (
            <div className="mt-4 rounded-2xl bg-duo-mist px-4 py-3 text-sm font-semibold text-duo-ink">
              <span className="font-extrabold">Ghi chú của phụ huynh: </span>
              {patient.child.note}
            </div>
          )}
          {patient.message && (
            <div className="mt-3 rounded-2xl bg-duo-green-soft px-4 py-3 text-sm font-semibold text-duo-green-dark">
              <span className="font-extrabold">Lời nhắn gửi bác sĩ: </span>“{patient.message}”
            </div>
          )}
          <p className="mt-4 text-xs font-semibold leading-relaxed text-duo-mute">{DOCTOR_VIEW_DISCLAIMER}</p>
        </div>

        {p && (
          <Card title="Hồ sơ cá nhân hoá (do phụ huynh cung cấp)">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Item label="Tên gọi ở nhà">{p.nickname ?? '—'}</Item>
              <Item label="Cách giao tiếp">{p.communication ? COMMUNICATION_LABEL[p.communication] : '—'}</Item>
              <Item label="Trẻ thích">{p.interests.length ? p.interests.join(', ') : '—'}</Item>
              <Item label="Trẻ dễ khó chịu với">{p.sensory.length ? p.sensory.map((tag) => SENSORY_LABEL[tag]).join(', ') : '—'}</Item>
              <Item label="Giúp trẻ bình tĩnh">{p.calming ?? '—'}</Item>
              <Item label="Mong muốn của phụ huynh">{p.goals ?? '—'}</Item>
              <Item label="Ưu tiên luyện tập">
                {p.focusAreas.length ? p.focusAreas.map((area) => BODY_FOCUS_LABEL[area]).join(', ') : '—'}
              </Item>
              <Item label="Mục tiêu mỗi tuần">{p.weeklyGoal ? `${p.weeklyGoal} ngày tập` : '—'}</Item>
            </div>
          </Card>
        )}

        {screenings && (
          <Card title="Sàng lọc dáng đi (tham khảo, không phải chẩn đoán)">
            {screenings.length === 0 ? (
              <Empty>Chưa có lần sàng lọc nào.</Empty>
            ) : (
              <div className="space-y-4">
                {screenings.map((s, i) => (
                  <div key={s.id} className="rounded-2xl bg-white p-4 shadow-card-inner">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-sm font-black text-duo-ink">
                        Lần {screenings.length - i} • {formatDateTime(s.createdAt)}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-extrabold text-duo-mute">{SCREENING_STATUS_LABEL[s.status]}</span>
                        {s.result && <RiskPill risk={s.result.riskLevel} />}
                      </div>
                    </div>
                    {s.result && (
                      <div className="mt-3 space-y-3">
                        {typeof s.result.asdProbability === 'number' && (
                          <ModelScoreBar
                            asdProbability={s.result.asdProbability}
                            riskLevel={s.result.riskLevel}
                            threshold={s.result.decisionThreshold}
                            highRiskThreshold={s.result.highRiskThreshold}
                          />
                        )}
                        <div className="text-xs font-bold text-duo-mute">
                          {s.result.calibrated === false && 'Ngưỡng chưa được hiệu chỉnh. '}
                          {s.result.modelVersion ? `Mô hình: ${s.result.modelVersion}. ` : ''}
                          {s.result.provider === 'mock' ? 'Kết quả mô phỏng (không phải từ mô hình thật). ' : ''}
                          {s.result.gaitFeatures ? `Chất lượng video: ${QUALITY_LABEL[s.result.gaitFeatures.quality.level]}.` : ''}
                        </div>
                        {s.result.gaitFeatures && s.result.gaitFeatures.quality.warnings.length > 0 && (
                          <ul className="list-disc space-y-0.5 pl-5 text-xs font-semibold text-yellow-900">
                            {s.result.gaitFeatures.quality.warnings.map((w) => (
                              <li key={w}>{w}</li>
                            ))}
                          </ul>
                        )}
                        {s.result.gaitFeatures && <GaitFeaturesCard features={s.result.gaitFeatures} />}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}

        {questionnaires && (
          <Card title="Bảng hỏi phụ huynh M-CHAT-R/F (tham khảo)">
            {questionnaires.length === 0 ? (
              <Empty>Phụ huynh chưa trả lời bảng hỏi nào.</Empty>
            ) : (
              <div className="overflow-x-auto rounded-2xl bg-white shadow-card-inner">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="divider-duo text-xs font-extrabold uppercase tracking-wide text-duo-mute">
                      <th className="px-3 py-2">Ngày</th>
                      <th className="px-3 py-2">Người trả lời</th>
                      <th className="px-3 py-2">Tuổi (tháng)</th>
                      <th className="px-3 py-2 text-right">Điểm</th>
                      <th className="px-3 py-2">Mức</th>
                      <th className="px-3 py-2">Hỏi thêm (Follow-Up)</th>
                      <th className="px-3 py-2">Kết quả</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-duo-line/70 font-bold text-duo-ink">
                    {questionnaires.map((q) => (
                      <tr key={q.id}>
                        <td className="px-3 py-2 tabular-nums">{formatDate(q.completedAt)}</td>
                        <td className="px-3 py-2">{RESPONDENT_LABEL[q.respondent]}</td>
                        <td className="px-3 py-2 tabular-nums">{q.childAgeMonths}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{q.totalScore}/20</td>
                        <td className="px-3 py-2">
                          <LikelihoodBadge band={q.band} />
                        </td>
                        <td className="px-3 py-2">
                          {FOLLOW_UP_STATUS_LABEL[q.followUpStatus]}
                          {q.followUpStatus === 'COMPLETED' && q.followUpFailCount !== null && (
                            <span className="text-duo-mute"> • còn {q.followUpFailCount} mục</span>
                          )}
                          {q.failedItems.length > 0 && <div className="text-xs text-duo-mute">Mục cần hỏi thêm: {q.failedItems.join(', ')}</div>}
                          {q.followUp.itemScores.length > 0 && (
                            <div className="text-xs text-duo-mute">
                              Điểm từng mục: {q.followUp.itemScores.map((s) => `${s.item}: ${s.score}`).join(' • ')}
                            </div>
                          )}
                          {q.followUp.needsReview && (
                            <div className="text-xs text-yellow-900">Mục cần xem lại: {q.followUp.reviewItems.join(', ')}</div>
                          )}
                        </td>
                        <td className="px-3 py-2">{OUTCOME_SHORT_LABEL[q.outcome]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {questionnaires[0] && (
              <p className="mt-3 text-xs font-semibold leading-relaxed text-duo-mute">
                {questionnaires[0].disclaimer} {questionnaires[0].copyright}
              </p>
            )}
          </Card>
        )}

        {exercises && (
          <Card title="Luyện tập bắt chước (thử nghiệm)">
            {practised.length === 0 ? (
              <Empty>Trẻ chưa tập bài nào.</Empty>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-wrap gap-2" role="group" aria-label="Chọn bài tập">
                  {practised.map((e) => {
                    const active = selectedExercise?.exercise.id === e.exercise.id
                    return (
                      <button
                        key={e.exercise.id}
                        type="button"
                        aria-pressed={active}
                        onClick={() => setExerciseId(e.exercise.id)}
                        className={[
                          'rounded-full px-3 py-1.5 text-xs font-extrabold transition-all',
                          active ? 'bg-duo-green-soft text-duo-green-dark shadow-ring-green' : 'bg-duo-mist text-duo-mute hover:text-duo-ink',
                        ].join(' ')}
                      >
                        {e.exercise.title}
                        <span className="ml-1 font-bold opacity-70">({e.attempts})</span>
                      </button>
                    )
                  })}
                </div>
                {selectedExercise && (
                  <ExerciseProgressChart key={selectedExercise.exercise.id} progress={selectedExercise} showDisclaimer={false} sessionLinks={false} />
                )}
                <p className="text-xs font-semibold leading-relaxed text-duo-mute">{EXERCISE_DISCLAIMER}</p>
              </div>
            )}
          </Card>
        )}

        {notShared.length > 0 && (
          <div className="rounded-2xl bg-duo-mist px-4 py-3 text-sm font-semibold text-duo-mute">
            Phụ huynh không chia sẻ: {notShared.map((scope) => SHARE_SCOPE_LABEL[scope].toLowerCase()).join(', ')}.
          </div>
        )}
      </div>
    </DashboardLayout>
  )
}
