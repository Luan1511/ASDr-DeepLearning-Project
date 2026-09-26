import { DashboardLayout } from '../layouts/DashboardLayout'
import { Card } from '../components/Card'

export function GuidePage() {
  const steps = [
    'Quay video 3–10 phút, đủ sáng, hành vi tự nhiên (chơi, gọi tên, tương tác).',
    'Tránh che mặt trẻ; giữ âm thanh vừa đủ.',
    'Tải video ở mục Sàng lọc và chờ xử lý.',
    'Xem kết quả ở Lịch sử. Kết quả chỉ tham khảo, không thay thế chẩn đoán.',
  ]

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-2xl space-y-4">
        <h1 className="text-2xl font-black text-duo-ink">Hướng dẫn</h1>
        <Card title="Cách quay & tải video">
          <ol className="space-y-3">
            {steps.map((s, i) => (
              <li key={i} className="flex gap-3 text-sm font-semibold leading-relaxed text-duo-ink">
                <span className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-full bg-duo-green text-xs font-black text-white">
                  {i + 1}
                </span>
                {s}
              </li>
            ))}
          </ol>
        </Card>
        <Card title="Bảo mật">
          <div className="space-y-2 text-sm font-semibold leading-relaxed text-duo-ink">
            <div>• Chỉ tải video bạn có quyền chia sẻ.</div>
            <div>• Không tải thông tin nhạy cảm không cần thiết.</div>
          </div>
        </Card>
      </div>
    </DashboardLayout>
  )
}
