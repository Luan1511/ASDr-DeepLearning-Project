export type QuickQuestionKey = 'asd' | 'signs' | 'process' | 'age'

const DISCLAIMER =
  'Lưu ý: Thông tin chỉ mang tính tham khảo và không thay thế tư vấn/chẩn đoán của bác sĩ hoặc chuyên gia.'

export function answerAsdQuestion(message: string): string {
  const normalized = message.trim().toLowerCase()

  if (/(asd|tự kỷ|tu ky|autism)/.test(normalized)) {
    return (
      'ASD (Rối loạn phổ tự kỷ) là một nhóm các khác biệt về phát triển thần kinh, thường liên quan đến giao tiếp xã hội và các hành vi/sở thích lặp lại. ' +
      DISCLAIMER
    )
  }

  if (/(dấu hiệu|dau hieu|nhận biết|nhan biet|sớm|som)/.test(normalized)) {
    return (
      'Một số dấu hiệu sớm có thể gồm: ít giao tiếp mắt, ít đáp ứng khi gọi tên, ít chia sẻ niềm vui, chậm ngôn ngữ, hành vi lặp lại. Nếu bạn lo lắng, hãy gặp chuyên gia để được đánh giá trực tiếp. ' +
      DISCLAIMER
    )
  }

  if (/(quy trình|quy trinh|sàng lọc|sang loc|process)/.test(normalized)) {
    return (
      'Quy trình tham khảo: quay video tương tác tự nhiên (chơi, gọi tên, yêu cầu đơn giản) → tải lên hệ thống → hệ thống phân tích tham khảo → bạn xem kết quả và khuyến nghị. ' +
      DISCLAIMER
    )
  }

  if (/(mấy tuổi|may tuoi|tuổi nào|tuoi nao|bao nhieu tuoi|age)/.test(normalized)) {
    return (
      'Bạn có thể theo dõi và sàng lọc tham khảo khi có lo ngại, đặc biệt giai đoạn 18–36 tháng là lúc nhiều dấu hiệu có thể rõ hơn. Nếu nghi ngờ, nên gặp chuyên gia càng sớm càng tốt. ' +
      DISCLAIMER
    )
  }

  return 'Mình có thể giúp bạn với các câu hỏi về ASD, dấu hiệu sớm, quy trình sàng lọc và thời điểm nên gặp chuyên gia. ' + DISCLAIMER
}
