import { DashboardLayout } from '../layouts/DashboardLayout'
import { Card } from '../components/Card'

const RECORDING_STEPS = [
  'Cho trẻ đi thẳng tự nhiên 6–10 giây (khoảng 6–10 bước) trên nền phẳng, đủ sáng.',
  'Ưu tiên quay ngang: đặt máy cố định ngang hông trẻ, vuông góc với hướng đi, cách 3–4 m để thấy trọn người từ đầu đến bàn chân.',
  'Chỉ để một mình trẻ trong khung hình; người lớn đứng ngoài khung.',
  'Giữ máy yên (dùng giá đỡ nếu có), không zoom hay lia máy trong lúc quay.',
  'Mặc quần áo gọn, không che chân; trẻ có thể đi chân trần hoặc giày bệt.',
  'Tải video ở mục Sàng lọc và chờ xử lý (thường vài phút). Kết quả xem lại ở mục Lịch sử.',
]

export function GuidePage() {
  return (
    <DashboardLayout>
      <div className="mx-auto max-w-2xl space-y-4">
        <h1 className="text-2xl font-black text-duo-ink">Hướng dẫn</h1>
        <Card title="Cách quay video dáng đi">
          <ol className="space-y-3">
            {RECORDING_STEPS.map((s, i) => (
              <li key={s} className="flex gap-3 text-sm font-semibold leading-relaxed text-duo-ink">
                <span className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-full bg-duo-green text-xs font-black text-white">
                  {i + 1}
                </span>
                {s}
              </li>
            ))}
          </ol>
        </Card>
        <Card title="Kết quả nói gì">
          <div className="space-y-2 text-sm font-semibold leading-relaxed text-duo-ink">
            <div>
              • Mô hình chỉ phân tích chuyển động cơ thể (khung xương) khi trẻ đi. Kết quả là mức cần theo dõi mang tính tham khảo,
              không phải chẩn đoán.
            </div>
            <div>• Nếu hệ thống báo chất lượng video thấp, hãy quay lại theo hướng dẫn rồi sàng lọc lại.</div>
            <div>• Mọi lo lắng về sự phát triển của trẻ nên được trao đổi với bác sĩ nhi hoặc chuyên gia phát triển.</div>
          </div>
        </Card>
        <Card title="Quyền riêng tư">
          <div className="space-y-2 text-sm font-semibold leading-relaxed text-duo-ink">
            <div>• Trước lần tải đầu tiên cho mỗi trẻ, bạn cần xác nhận đồng ý; có thể thu hồi bất cứ lúc nào.</div>
            <div>• Video gốc được xoá khỏi máy chủ ứng dụng sau khi phân tích xong; hệ thống giữ lại dữ liệu khung xương và kết quả.</div>
            <div>• Chỉ tải video bạn có quyền chia sẻ và tránh quay kèm thông tin nhạy cảm (tên, địa chỉ, người khác).</div>
          </div>
        </Card>
      </div>
    </DashboardLayout>
  )
}
