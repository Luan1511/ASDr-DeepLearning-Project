import type { ReactNode } from 'react'
import { Stethoscope } from 'lucide-react'
import { formatDateTime } from '../../lib/format'
import {
  BAND_LABEL,
  FOLLOW_UP_SOURCE_LABEL,
  FOLLOW_UP_STATUS_LABEL,
  MCHAT_ITEM_COUNT,
  RESPONDENT_LABEL,
  RESPONSE_MODE_LABEL,
  RESULT_STATE_LABEL,
  formatCalendarDate,
  resultStateOf,
} from '../../lib/questionnaires'
import type { QuestionnaireResponseDto } from '../../lib/questionnaireTypes'

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,11rem)_1fr] gap-x-3 gap-y-0.5 py-1 text-sm">
      <dt className="font-extrabold text-duo-mute">{label}</dt>
      <dd className="font-bold text-duo-ink">{children}</dd>
    </div>
  )
}

function followUpLine(r: QuestionnaireResponseDto): string {
  if (r.followUpStatus === 'PENDING') {
    const f = r.followUp
    return f.itemsTotal > 0 && f.inAppStarted
      ? `Chưa hoàn tất (đã làm ${f.itemsDone}/${f.itemsTotal} mục trong ứng dụng)`
      : 'Chưa làm'
  }
  return FOLLOW_UP_STATUS_LABEL[r.followUpStatus]
}

/**
 * "Tóm tắt cho bác sĩ": numbers and versions only — never item wording or the parent's
 * individual answers. Follow-Up item scores (0/1 by item number) appear only here.
 */
export function DoctorSummary({ response: r }: { response: QuestionnaireResponseDto }) {
  const scores = [...r.followUp.itemScores].sort((a, b) => a.item - b.item)
  const stillOne = [...r.followUpFailedItems].sort((a, b) => a - b)
  const review = [...r.followUp.reviewItems].sort((a, b) => a - b)
  const versions = [
    `cấu trúc ${r.structureVersion}`,
    `cách tính điểm ${r.scoringVersion}`,
    `nội dung ${r.contentVersion ?? 'phiếu chính thức (nhập theo số câu)'}`,
  ].join(' · ')

  return (
    <section className="card-duo space-y-2 p-5 print:break-inside-avoid print:p-0 print:shadow-none" aria-labelledby="doctor-summary">
      <div className="flex items-center gap-2">
        <Stethoscope className="h-4 w-4 stroke-[2.5] text-duo-green-dark" aria-hidden="true" />
        <h2 id="doctor-summary" className="text-sm font-extrabold uppercase tracking-wide text-duo-ink">
          Tóm tắt cho bác sĩ
        </h2>
      </div>
      <dl className="divide-y divide-duo-line">
        <Row label="Công cụ">M-CHAT-R/F (sàng lọc hai giai đoạn, phụ huynh trả lời)</Row>
        <Row label="Phiên bản">{versions}</Row>
        <Row label="Cách trả lời">{RESPONSE_MODE_LABEL[r.mode]}</Row>
        <Row label="Ngày trả lời">{formatDateTime(r.completedAt)}</Row>
        <Row label="Người trả lời">{RESPONDENT_LABEL[r.respondent]}</Row>
        <Row label="Tuổi của trẻ">{r.childAgeMonths} tháng</Row>
        <Row label="Tổng điểm giai đoạn 1">
          {r.totalScore}/{MCHAT_ITEM_COUNT} ({BAND_LABEL[r.band]})
        </Row>
        {r.band === 'MODERATE' && (
          <Row label="Phần hỏi thêm (Follow-Up)">
            {followUpLine(r)}
            {r.followUpSource ? ` · ${FOLLOW_UP_SOURCE_LABEL[r.followUpSource]}` : ''}
          </Row>
        )}
        {r.followUpStatus === 'COMPLETED' && scores.length > 0 && (
          <Row label="Điểm từng mục Follow-Up">
            <span className="tabular-nums">{scores.map((s) => `Câu ${s.item}: ${s.score}`).join(' · ')}</span>
          </Row>
        )}
        {r.followUpStatus === 'COMPLETED' && (
          <Row label="Số mục còn điểm 1">
            <span className="tabular-nums">
              {r.followUpFailCount ?? stillOne.length}
              {stillOne.length > 0 && ` (câu số ${stillOne.join(', ')})`}
            </span>
          </Row>
        )}
        {review.length > 0 && <Row label="Mục cần xem lại">Câu số {review.join(', ')} (có mô tả “khác” của phụ huynh)</Row>}
        <Row label="Kết quả sàng lọc">{RESULT_STATE_LABEL[resultStateOf(r)]}</Row>
        {r.rescreenAfter && <Row label="Hẹn sàng lọc lại">Từ ngày {formatCalendarDate(r.rescreenAfter)}</Row>}
      </dl>
      <p className="text-xs font-semibold text-duo-mute">
        Bản tóm tắt không chứa nội dung câu hỏi hay từng câu trả lời của phụ huynh. Đây là kết quả sàng lọc, không phải kết luận
        chuyên môn.
      </p>
    </section>
  )
}
