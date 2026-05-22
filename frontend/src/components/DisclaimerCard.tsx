import { Card } from './Card'

export function DisclaimerCard() {
  return (
    <Card title="Miễn trừ trách nhiệm">
      <div className="text-sm leading-relaxed text-slate-700">
        Kết quả phân tích từ ASDr chỉ mang tính chất tham khảo, không phải là chẩn đoán y khoa. Vui lòng tham khảo ý kiến
        bác sĩ/chuyên gia để được đánh giá chính xác.
      </div>
      <div className="mt-3 text-xs text-slate-500">ASDr không lưu trữ kết luận chẩn đoán; chỉ lưu kết quả tham khảo.</div>
    </Card>
  )
}
