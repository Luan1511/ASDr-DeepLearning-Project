import { Card } from './Card'

export function PrivacyCard() {
  return (
    <Card title="Bảo mật & quyền riêng tư">
      <div className="text-sm font-semibold leading-relaxed text-duo-ink">
        Video và dữ liệu của bạn được sử dụng để phục vụ sàng lọc tham khảo và luyện tập. Bạn có thể xoá từng lượt sàng lọc,
        từng lượt tập, từng lần trả lời bảng hỏi, hoặc xoá hồ sơ trẻ cùng toàn bộ dữ liệu (trang Hồ sơ trẻ) bất cứ lúc nào.
      </div>
      <div className="mt-3 text-xs font-bold text-duo-mute">Khuyến nghị: tránh upload video chứa thông tin nhạy cảm không cần thiết.</div>
    </Card>
  )
}
