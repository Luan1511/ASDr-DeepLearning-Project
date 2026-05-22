import { DashboardLayout } from '../layouts/DashboardLayout'
import { Card } from '../components/Card'

export function GuidePage() {
  return (
    <DashboardLayout>
      <div className="space-y-6">
        <Card title="Hướng dẫn quay & tải video">
          <div className="space-y-3 text-sm leading-relaxed text-slate-700">
            <div>
              1) Quay video 3–10 phút trong môi trường đủ sáng, ghi lại hành vi tự nhiên (chơi, gọi tên, tương tác).
            </div>
            <div>2) Tránh che mặt trẻ; giữ âm thanh vừa đủ để nghe phản ứng.</div>
            <div>3) Tải video lên mục “Sàng lọc ASD” và chờ hệ thống xử lý.</div>
            <div>
              4) Xem kết quả tại “Lịch sử kết quả”. Kết quả chỉ mang tính tham khảo, không thay thế chẩn đoán y khoa.
            </div>
          </div>
        </Card>

        <Card title="Lưu ý bảo mật">
          <div className="space-y-2 text-sm leading-relaxed text-slate-700">
            <div>• Chỉ tải những video bạn có quyền chia sẻ.</div>
            <div>• Không tải thông tin nhạy cảm không cần thiết.</div>
            <div>• Có thể yêu cầu xóa dữ liệu theo chính sách dự án.</div>
          </div>
        </Card>
      </div>
    </DashboardLayout>
  )
}
