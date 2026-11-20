import { Link } from 'react-router-dom'
import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import type { KinectResult } from '../lib/kinect'

const MEMBER_LABELS: Record<string, string> = {
  srm_zscore: 'SRM · Z-score',
  stgcn_zscore: 'ST-GCN · Z-score',
  stgcn_bbox_velocity: 'ST-GCN · BBox + Velocity',
}

/** Parent-facing result of one Kinect walk; `technical` adds the per-model votes and raw JSON. */
export function KinectResultView({ result, technical = false }: { result: KinectResult; technical?: boolean }) {
  const flagged = result.prediction === 'ASD'
  const votes = flagged ? result.asdVotes : result.typicalVotes
  const total = result.members.length || 3
  return (
    <section className="space-y-4" aria-label="Kết quả sàng lọc Kinect">
      <div className={['flex items-start gap-3 rounded-2xl p-4', flagged ? 'bg-amber-50' : 'bg-duo-green-soft'].join(' ')}>
        {flagged ? (
          <AlertTriangle className="mt-0.5 h-6 w-6 flex-shrink-0 text-amber-600" />
        ) : (
          <CheckCircle2 className="mt-0.5 h-6 w-6 flex-shrink-0 text-duo-green-dark" />
        )}
        <div>
          <h2 className="text-lg font-black text-duo-ink">
            {flagged ? 'Dáng đi có điểm nên theo dõi thêm' : 'Chưa thấy khác biệt đáng chú ý trong dáng đi'}
          </h2>
          <p className="mt-1 text-sm font-semibold text-duo-mute">
            {votes}/{total} mô hình phân tích cho cùng nhận định này.
          </p>
        </div>
      </div>

      <div className="space-y-2 text-sm text-duo-ink">
        {flagged ? (
          <p>
            Đây <strong>không phải chẩn đoán</strong>. Một lượt đi có thể bị ảnh hưởng bởi tâm trạng, giày dép hay cách đi lúc ghi. Bạn
            nên ghi thêm một lượt vào ngày khác, làm bảng hỏi sàng lọc và trao đổi với bác sĩ chuyên khoa nhi hoặc tâm lý nếu bạn có
            điều băn khoăn về sự phát triển của trẻ.
          </p>
        ) : (
          <p>
            Đây <strong>không phải chẩn đoán</strong> và không loại trừ được tự kỷ. Nếu bạn vẫn lo lắng về giao tiếp, hành vi hay sự
            phát triển của trẻ, hãy làm bảng hỏi sàng lọc và hỏi ý kiến bác sĩ.
          </p>
        )}
        <div className="flex flex-wrap gap-3 pt-1">
          <Link to="/questionnaires" className="link-duo text-sm">
            Làm bảng hỏi sàng lọc
          </Link>
          <Link to="/doctors" className="link-duo text-sm">
            Chia sẻ với bác sĩ
          </Link>
        </div>
      </div>

      {technical && (
        <details className="rounded-2xl bg-duo-mist p-4 text-xs text-duo-mute">
          <summary className="cursor-pointer font-extrabold text-duo-ink">Chi tiết kỹ thuật (quản trị)</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {result.members.map((m) => (
              <div key={m.id} className="rounded-xl bg-white p-3">
                <h3 className="text-xs font-extrabold text-duo-ink">{MEMBER_LABELS[m.id] ?? m.id}</h3>
                <p className="mt-1">
                  {m.prediction} · {m.prediction === 'ASD' ? m.asdVotes : m.typicalVotes}/{m.checkpoints?.length || 5} seed
                </p>
              </div>
            ))}
          </div>
          <p className="mt-3">Phiếu và điểm của các model không phải xác suất ASD đã hiệu chuẩn.</p>
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap">{JSON.stringify(result, null, 2)}</pre>
        </details>
      )}
    </section>
  )
}
