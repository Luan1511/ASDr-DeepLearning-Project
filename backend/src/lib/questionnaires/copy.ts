/**
 * Vietnamese copy for the questionnaire feature (spec §6.2). Results are a
 * screening aid, never a diagnosis: outside DISCLAIMER (which states exactly
 * that) the strings avoid diagnostic wording and percentages, enforced by
 * test/questionnaireCopy.test.ts. No instrument item wording belongs here.
 */
import type { McHatEligibility } from './age'
import { MCHAT_RF, type FollowUpSource, type McHatBand, type McHatOutcome, type Respondent } from './mchatRf'

export const QUESTIONNAIRE_TITLE = 'Bảng hỏi sàng lọc M-CHAT-R/F (16–30 tháng tuổi)'
export const RESULT_HEADER = 'Kết quả sàng lọc bằng bảng hỏi'

export const ENTRY_INSTRUCTIONS =
  'Mở bản M-CHAT-R/F tiếng Việt chính thức trên mchatscreen.com, đọc từng câu và chọn Có/Không trên phiếu. Sau đó nhập đúng câu trả lời theo số thứ tự câu bên dưới để hệ thống tính điểm. AIMBRACE không hiển thị nội dung câu hỏi.'
export const ENTRY_HELP = 'Ứng dụng tự tính điểm — bạn không cần biết câu nào được tính điểm.'

export const COPYRIGHT_NOTICE = `${MCHAT_RF.copyright}. Tải bản tiếng Việt chính thức tại mchatscreen.com.`

/** The only string allowed to name diagnosis, and only to say this is not one. */
export const DISCLAIMER =
  'Đây là kết quả sàng lọc bằng bảng hỏi, không phải chẩn đoán. Chỉ bác sĩ hoặc chuyên gia được đào tạo (nhi khoa phát triển, tâm bệnh nhi, phục hồi chức năng) mới có thể đánh giá và kết luận. Bảng hỏi được thiết kế để hạn chế bỏ sót, nên nhiều trẻ có kết quả cần theo dõi thêm nhưng sau đó không được chẩn đoán; kết quả khả năng thấp cũng không loại trừ hoàn toàn — nếu bạn còn lo lắng, hãy trao đổi với bác sĩ.'

export const BAND_LABEL: Readonly<Record<McHatBand, string>> = Object.freeze({
  LOW: 'Khả năng thấp',
  MODERATE: 'Khả năng trung bình',
  HIGH: 'Khả năng cao',
})

export const RESPONDENT_LABEL: Readonly<Record<Respondent, string>> = Object.freeze({
  MOTHER: 'Mẹ',
  FATHER: 'Bố',
  GUARDIAN: 'Người giám hộ',
  OTHER_CAREGIVER: 'Người chăm sóc khác',
})

export const FOLLOW_UP_SOURCE_LABEL: Readonly<Record<FollowUpSource, string>> = Object.freeze({
  HEALTH_WORKER: 'Cùng nhân viên y tế',
  A365: 'Trên ứng dụng a365',
  OTHER: 'Cách khác',
})

/** Label of a Follow-Up the parent completed in the app (followUpSource IN_APP). */
export const FOLLOW_UP_IN_APP_LABEL = 'Phụ huynh tự làm trên ứng dụng'

export const DISABLED_MESSAGE =
  'Bảng hỏi M-CHAT-R/F đang chờ tác giả cho phép sử dụng trong ứng dụng nên chưa mở.'
export const CONTENT_UNAVAILABLE_MESSAGE =
  'Bảng hỏi trên ứng dụng chưa sẵn sàng. Bạn vẫn có thể nhập câu trả lời theo phiếu chính thức, hoặc làm phần hỏi thêm cùng nhân viên y tế.'
export const DASHBOARD_NOTE =
  'Kết quả bảng hỏi và kết quả sàng lọc video là hai nguồn thông tin riêng, không gộp thành một điểm.'

export function scoreLine(total: number): string {
  return `Điểm: ${total}/${MCHAT_RF.itemCount}`
}

export function respondentLine(respondent: Respondent): string {
  return `Người trả lời: ${RESPONDENT_LABEL[respondent]}`
}

/** dd/mm/yyyy from a UTC-midnight Date or a YYYY-MM-DD string. */
export function formatVnDate(value: Date | string): string {
  const iso = typeof value === 'string' ? value : value.toISOString()
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!match) throw new RangeError(`Not a calendar date: ${iso}`)
  return `${match[3]}/${match[2]}/${match[1]}`
}

export function tooYoungMessage(ageMonths: number, eligibleFrom: string): string {
  return `M-CHAT-R/F dành cho trẻ từ ${MCHAT_RF.ageMonths.min} đến ${MCHAT_RF.ageMonths.max} tháng tuổi. Con hiện ${Math.max(0, ageMonths)} tháng — bạn có thể làm từ ngày ${formatVnDate(eligibleFrom)}. Trong lúc chờ, hãy theo dõi các mốc phát triển của con (bảng kiểm của CDC có bản tiếng Việt) và hỏi bác sĩ nhi nếu có băn khoăn.`
}

export function tooOldMessage(ageMonths: number): string {
  return `Con đã ${ageMonths} tháng, ngoài độ tuổi của M-CHAT-R/F (${MCHAT_RF.ageMonths.min}–${MCHAT_RF.ageMonths.max} tháng). Hiện AIMBRACE chưa có bảng hỏi được cấp phép cho độ tuổi này. Bạn có thể theo dõi các mốc phát triển của con và trao đổi với bác sĩ nếu có điều lo lắng.`
}

/** Notice for an out-of-range age; null when the child is eligible. */
export function ageGateMessage(eligibility: McHatEligibility): string | null {
  if (eligibility.reason === 'TOO_YOUNG') return tooYoungMessage(eligibility.ageMonths, eligibility.eligibleFrom)
  if (eligibility.reason === 'TOO_OLD') return tooOldMessage(eligibility.ageMonths)
  return null
}

export type OutcomeCopyContext = {
  /** True once a Follow-Up has been recorded (followUpStatus COMPLETED). */
  afterFollowUp: boolean
  /** Set only for a LOW or Follow-Up negative result before 24 months. */
  rescreenAfter: Date | null
  /** Item numbers to go through in the Follow-Up (MODERATE, pending). */
  followUpItems: number[]
  /** The automated in-app Follow-Up can be taken (MCHAT_MODE=inapp with ready content). */
  inAppAvailable?: boolean
}

/** Next-step card for a result: title plus one paragraph per array entry. */
export function outcomeCopy(outcome: McHatOutcome, ctx: OutcomeCopyContext): { title: string; body: string[] } {
  switch (outcome) {
    case 'SCREEN_NEGATIVE':
      if (ctx.afterFollowUp) {
        return {
          title: 'Sau phần hỏi thêm: khả năng thấp',
          body: [
            'Tiếp tục theo dõi các mốc phát triển và làm lại bảng hỏi ở các lần khám định kỳ; nếu có lo lắng, hãy trao đổi với bác sĩ.',
            ...(ctx.rescreenAfter
              ? [`Hãy làm lại bảng hỏi sau sinh nhật 2 tuổi của con (từ ngày ${formatVnDate(ctx.rescreenAfter)}).`]
              : []),
          ],
        }
      }
      return {
        title: BAND_LABEL.LOW,
        body: [
          'Tiếp tục theo dõi các mốc phát triển của con.',
          ...(ctx.rescreenAfter
            ? [`Hãy làm lại bảng hỏi sau sinh nhật 2 tuổi của con (từ ngày ${formatVnDate(ctx.rescreenAfter)}).`]
            : []),
          'Nếu con mất kỹ năng đã có hoặc bạn thấy điều gì lo lắng, hãy đưa con đi khám — không cần chờ.',
        ],
      }
    case 'FOLLOW_UP_NEEDED':
      // In the app the Follow-Up page walks the items itself, so no item numbers
      // are listed (they would show which answers counted); the assisted entry
      // needs them to know which items to ask about.
      if (ctx.inAppAvailable) {
        return {
          title: `${BAND_LABEL.MODERATE} — cần làm phần hỏi thêm`,
          body: [
            'Bước tiếp theo là phần hỏi thêm (Follow-Up) cho một số câu. Bạn có thể làm ngay trên ứng dụng (khoảng 5–10 phút, có thể dừng và làm tiếp sau), hoặc làm cùng nhân viên y tế (trạm y tế, bác sĩ nhi) rồi ghi lại kết quả tại đây.',
            'Kết quả chưa hoàn tất cho tới khi làm xong phần hỏi thêm.',
          ],
        }
      }
      return {
        title: `${BAND_LABEL.MODERATE} — cần làm phần hỏi thêm`,
        body: [
          `Bước tiếp theo là phần hỏi thêm (Follow-Up) cho các câu số ${ctx.followUpItems.join(', ')}, tốt nhất cùng nhân viên y tế (trạm y tế, bác sĩ nhi) hoặc trên ứng dụng a365.`,
          'Làm xong, hãy quay lại đây để ghi các câu vẫn được tính điểm sau phần hỏi thêm.',
        ],
      }
    case 'REFER':
      return {
        title: BAND_LABEL.HIGH,
        body: [
          'Bạn nên sớm đưa con tới cơ sở y tế có chuyên khoa Nhi phát triển, Tâm bệnh nhi hoặc Phục hồi chức năng để được đánh giá.',
          'Đừng chờ đợi: con có thể được hỗ trợ, can thiệp sớm ngay cả trước khi có kết luận.',
          'Đi đánh giá là một bước tích cực và không ràng buộc bạn điều gì.',
        ],
      }
  }
}
