import { Card } from './Card'

export function PrivacyCard() {
  return (
    <Card title="Bảo mật & quyền riêng tư">
      <div className="text-sm leading-relaxed text-slate-700">
        Video và dữ liệu của bạn được sử dụng để phục vụ sàng lọc tham khảo. Bạn có thể xoá lịch sử theo nhu cầu (tính
        năng sẽ được cập nhật).
      </div>
      <div className="mt-3 text-xs text-slate-500">Khuyến nghị: tránh upload video chứa thông tin nhạy cảm không cần thiết.</div>
    </Card>
  )
}
