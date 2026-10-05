import { useEffect, useState } from 'react'
import { CheckCircle2, XCircle } from 'lucide-react'
import { DashboardLayout } from '../layouts/DashboardLayout'
import { Card } from '../components/Card'
import { api } from '../lib/api'
import { RiskPill } from '../components/RiskPill'
import type { RiskLevel, ScreeningStatus } from '../lib/types'
import { JOB_STATUS_LABEL, SCREENING_STATUS_LABEL } from '../lib/format'

type AdminStats = {
  totals: { users: number; uploads: number }
  uploadsByStatus: { completed: number; processing: number; failed: number }
  riskCounts: { low: number; medium: number; high: number }
  queue: { queued: number; running: number; failed: number }
  recentUsers: Array<{ id: string; name: string; email: string; role: 'USER' | 'ADMIN'; createdAt: string }>
  recentScreenings: Array<{
    id: string
    status: ScreeningStatus
    createdAt: string
    errorMessage?: string | null
    jobLastError?: string | null
    child: { fullName: string }
    user: { name: string; email: string }
    job?: { status: keyof typeof JOB_STATUS_LABEL; attempts: number; maxAttempts: number } | null
    result?: { riskLevel: RiskLevel; modelVersion?: string | null; calibrated?: boolean | null } | null
  }>
}

type MlHealth = {
  reachable: boolean
  latencyMs: number
  legacy?: boolean
  error?: string
  health?: {
    version?: string
    model_loaded?: boolean
    model_device?: string | null
    calibrated?: boolean
    video_retention?: string
    auth_required?: boolean
    openpose_available?: boolean
    cuda_available?: boolean
  } | null
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="card-duo p-4">
      <div className="text-xs font-extrabold uppercase tracking-wide text-duo-mute">{label}</div>
      <div className="mt-1 text-2xl font-black text-duo-ink">{value}</div>
    </div>
  )
}

function Flag({ ok, label }: { ok: boolean | undefined; label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm font-bold text-duo-ink">
      {ok ? <CheckCircle2 className="h-4 w-4 text-duo-green" /> : <XCircle className="h-4 w-4 text-duo-red" />}
      {label}
    </div>
  )
}

export function AdminPage() {
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [ml, setMl] = useState<MlHealth | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .get('/admin/stats')
      .then((res) => setStats(res.data))
      .catch(() => setError('Không tải được thống kê admin.'))
    api
      .get('/admin/ml-health')
      .then((res) => setMl(res.data))
      .catch(() => setMl({ reachable: false, latencyMs: 0, error: 'Không gọi được /admin/ml-health' }))
  }, [])

  const h = ml?.health

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <Card title="Admin – Thống kê hệ thống">
          {error && <div className="rounded-2xl bg-red-50 px-3 py-2 text-sm font-bold text-duo-red">{error}</div>}
          {!error && !stats && <div className="text-sm font-semibold text-duo-mute">Đang tải...</div>}

          {stats && (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <Stat label="Người dùng" value={stats.totals.users} />
              <Stat label="Lượt tải video" value={stats.totals.uploads} />
              <Stat label="Hoàn tất" value={stats.uploadsByStatus.completed} />
              <Stat label="Thất bại" value={stats.uploadsByStatus.failed} />
            </div>
          )}
        </Card>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <Card title="Máy chủ phân tích (OpenPose + ST-GCN)">
            {!ml && <div className="text-sm font-semibold text-duo-mute">Đang kiểm tra...</div>}
            {ml && !ml.reachable && (
              <div className="space-y-1 rounded-2xl bg-red-50 px-4 py-3 text-sm font-bold text-duo-red">
                <div>Không kết nối được máy chủ phân tích.</div>
                {ml.error && <div className="break-words text-xs font-semibold">{ml.error}</div>}
              </div>
            )}
            {ml?.reachable && ml.legacy && (
              <div className="rounded-2xl bg-yellow-50 px-4 py-3 text-sm font-bold text-yellow-900">
                Đang chạy phiên bản cũ (không có /health): chưa làm mờ mặt, chưa có API key, chưa nạp calibration. Cần triển khai
                lại API/server_openpose.py.
              </div>
            )}
            {ml?.reachable && h && (
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                <Flag ok={h.model_loaded} label={`Model đã nạp${h.model_device ? ` (${h.model_device})` : ''}`} />
                <Flag ok={h.cuda_available} label="PyTorch thấy GPU (CUDA)" />
                <Flag ok={h.openpose_available} label="Có OpenPose binary + models" />
                <Flag ok={h.calibrated} label="Ngưỡng đã hiệu chỉnh (calibration.json)" />
                <Flag ok={h.auth_required} label="Yêu cầu API key" />
                <Flag ok={h.video_retention !== 'raw'} label={`Lưu video: ${h.video_retention ?? '?'}`} />
                <div className="text-xs font-bold text-duo-mute md:col-span-2">
                  Phiên bản {h.version ?? '?'} • phản hồi {ml.latencyMs} ms
                </div>
              </div>
            )}
          </Card>

          {stats && (
            <Card title="Hàng đợi & mức sàng lọc">
              <div className="grid grid-cols-3 gap-3">
                <Stat label="Đang chờ" value={stats.queue.queued} />
                <Stat label="Đang chạy" value={stats.queue.running} />
                <Stat label="Job lỗi" value={stats.queue.failed} />
              </div>
              <div className="mt-4 grid grid-cols-3 gap-3">
                <Stat label="Mức thấp" value={stats.riskCounts.low} />
                <Stat label="Trung bình" value={stats.riskCounts.medium} />
                <Stat label="Mức cao" value={stats.riskCounts.high} />
              </div>
            </Card>
          )}
        </div>

        {stats && (
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_420px]">
            <Card title="Lượt sàng lọc gần đây">
              <div className="space-y-3">
                {stats.recentScreenings.map((s) => (
                  <div key={s.id} className="card-duo px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-extrabold text-duo-ink">{s.child.fullName}</div>
                        <div className="text-xs font-bold text-duo-mute">
                          {new Date(s.createdAt).toLocaleString('vi-VN')} • {SCREENING_STATUS_LABEL[s.status]} • {s.user.email}
                          {s.job && ` • job ${JOB_STATUS_LABEL[s.job.status]} (${s.job.attempts}/${s.job.maxAttempts})`}
                        </div>
                        {s.result?.modelVersion && (
                          <div className="text-xs font-bold text-duo-mute">
                            Model {s.result.modelVersion}
                            {s.result.calibrated === false ? ' • chưa calibrate' : ''}
                          </div>
                        )}
                      </div>
                      {s.result?.riskLevel ? <RiskPill risk={s.result.riskLevel} /> : <span className="text-xs font-bold text-duo-mute">—</span>}
                    </div>
                    {s.jobLastError && s.status !== 'COMPLETED' && (
                      <pre className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-duo-mist px-3 py-2 text-[11px] font-semibold text-duo-red">
                        {s.jobLastError}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            </Card>

            <Card title="Người dùng mới">
              <div className="space-y-2">
                {stats.recentUsers.map((u) => (
                  <div key={u.id} className="card-duo px-4 py-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm font-extrabold text-duo-ink">{u.name}</div>
                        <div className="text-xs font-bold text-duo-mute">
                          {u.email} • {u.role === 'ADMIN' ? 'Admin' : 'Phụ huynh'}
                        </div>
                      </div>
                      <div className="text-xs font-bold text-duo-mute">{new Date(u.createdAt).toLocaleDateString('vi-VN')}</div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        )}
      </div>
    </DashboardLayout>
  )
}
