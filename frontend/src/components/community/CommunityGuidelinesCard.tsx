import { ShieldCheck, HeartHandshake, AlertCircle } from 'lucide-react'

export function CommunityGuidelinesCard() {
  return (
    <div className="card-duo p-5 space-y-4">
      <div className="flex items-center gap-2 text-sm font-black uppercase tracking-wide text-duo-ink">
        <ShieldCheck className="h-5 w-5 text-duo-green" />
        <span>Văn hóa Cộng đồng</span>
      </div>

      <div className="space-y-3 text-xs font-semibold leading-relaxed text-duo-ink/80">
        <div className="flex items-start gap-2.5">
          <HeartHandshake className="h-4 w-4 text-rose-500 mt-0.5 flex-shrink-0" />
          <p>
            <strong className="text-duo-ink">Thấu cảm & Tôn trọng:</strong> Mỗi đứa trẻ là một thế giới riêng. Lắng nghe và khích lệ lẫn nhau thay vì so sánh hay phán xét.
          </p>
        </div>

        <div className="flex items-start gap-2.5">
          <span className="text-sm flex-shrink-0">🔒</span>
          <p>
            <strong className="text-duo-ink">Bảo vệ quyền riêng tư:</strong> Không đăng tải họ tên đầy đủ, địa chỉ trường lớp hoặc hình ảnh nhạy cảm của trẻ.
          </p>
        </div>

        <div className="flex items-start gap-2.5">
          <span className="text-sm flex-shrink-0">🌱</span>
          <p>
            <strong className="text-duo-ink">Nói không với phản khoa học:</strong> Không quảng cáo thuốc, thực phẩm chức năng hay các liệu pháp can thiệp chưa được kiểm chứng.
          </p>
        </div>
      </div>

      <div className="rounded-2xl bg-amber-50 p-3.5 border border-amber-200/80">
        <div className="flex items-start gap-2">
          <AlertCircle className="h-4 w-4 text-amber-700 mt-0.5 flex-shrink-0" />
          <p className="text-[11px] font-semibold leading-normal text-amber-900">
            <strong>Lưu ý y tế:</strong> Mọi chia sẻ trên diễn đàn chỉ mang tính chất tham khảo kinh nghiệm phụ huynh, không thay thế chẩn đoán hoặc chỉ định điều trị của bác sĩ chuyên môn.
          </p>
        </div>
      </div>
    </div>
  )
}
