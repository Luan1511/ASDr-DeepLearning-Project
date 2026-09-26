import { Card } from './Card'

export function PrivacyCard() {
  return (
    <Card title="Bảo mật & quyền riêng tư">
      <div className="text-sm font-semibold leading-relaxed text-duo-ink">
        Video và dữ liệu của bạn được sử dụng để phục vụ sàng lọc tham khảo. Bạn có thể xoá lịch sử theo nhu cầu (tính
        năng sẽ được cập nhật).
      </div>
      <div className="mt-3 text-xs font-bold text-duo-mute">Khuyến nghị: tránh upload video chứa thông tin nhạy cảm không cần thiết.</div>
    </Card>
  )
}
