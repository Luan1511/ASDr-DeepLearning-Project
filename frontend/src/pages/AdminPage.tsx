import { useEffect, useState } from 'react'
import { DashboardLayout } from '../layouts/DashboardLayout'
import { Card } from '../components/Card'
import { api } from '../lib/api'
import { RiskPill } from '../components/RiskPill'

type AdminStats = {
  totals: { users: number; uploads: number }
  uploadsByStatus: { completed: number; processing: number; failed: number }
  riskCounts: { low: number; medium: number; high: number }
  recentUsers: Array<{ id: string; name: string; email: string; role: 'USER' | 'ADMIN'; createdAt: string }>
  recentScreenings: Array<{
    id: string
    status: string
    createdAt: string
    child: { fullName: string }
    user: { name: string; email: string }
    result?: { riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' } | null
  }>
}

export function AdminPage() {
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .get('/admin/stats')
      .then((res) => setStats(res.data))
      .catch(() => setError('Không tải được thống kê admin.'))
  }, [])

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <Card title="Admin – Thống kê hệ thống">
          {error && <div className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
          {!error && !stats && <div className="text-sm font-semibold text-duo-mute">Đang tải...</div>}

          {stats && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="card-duo p-4">
                <div className="text-xs font-extrabold uppercase tracking-wide text-duo-mute">Tổng users</div>
                <div className="mt-1 text-2xl font-black text-duo-ink">{stats.totals.users}</div>
              </div>
              <div className="card-duo p-4">
                <div className="text-xs font-extrabold uppercase tracking-wide text-duo-mute">Tổng uploads</div>
                <div className="mt-1 text-2xl font-black text-duo-ink">{stats.totals.uploads}</div>
              </div>
              <div className="card-duo p-4">
                <div className="text-xs font-extrabold uppercase tracking-wide text-duo-mute">Uploads đang xử lý</div>
                <div className="mt-1 text-2xl font-black text-duo-ink">{stats.uploadsByStatus.processing}</div>
              </div>
            </div>
          )}
        </Card>

        {stats && (
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_420px]">
            <Card title="Risk breakdown">
              <div className="grid grid-cols-3 gap-3">
                <div className="card-duo p-4">
                  <div className="text-xs font-extrabold uppercase tracking-wide text-duo-mute">Low</div>
                  <div className="mt-1 text-2xl font-black text-duo-ink">{stats.riskCounts.low}</div>
                </div>
                <div className="card-duo p-4">
                  <div className="text-xs font-extrabold uppercase tracking-wide text-duo-mute">Medium</div>
                  <div className="mt-1 text-2xl font-black text-duo-ink">{stats.riskCounts.medium}</div>
                </div>
                <div className="card-duo p-4">
                  <div className="text-xs font-extrabold uppercase tracking-wide text-duo-mute">High</div>
                  <div className="mt-1 text-2xl font-black text-duo-ink">{stats.riskCounts.high}</div>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-3 gap-3">
                <div className="card-duo p-4">
                  <div className="text-xs font-extrabold uppercase tracking-wide text-duo-mute">Completed</div>
                  <div className="mt-1 text-2xl font-black text-duo-ink">{stats.uploadsByStatus.completed}</div>
                </div>
                <div className="card-duo p-4">
                  <div className="text-xs font-extrabold uppercase tracking-wide text-duo-mute">Failed</div>
                  <div className="mt-1 text-2xl font-black text-duo-ink">{stats.uploadsByStatus.failed}</div>
                </div>
                <div className="card-duo p-4">
                  <div className="text-xs font-extrabold uppercase tracking-wide text-duo-mute">Processing</div>
                  <div className="mt-1 text-2xl font-black text-duo-ink">{stats.uploadsByStatus.processing}</div>
                </div>
              </div>
            </Card>

            <Card title="Recent users">
              <div className="space-y-2">
                {stats.recentUsers.map((u) => (
                  <div key={u.id} className="card-duo px-4 py-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm font-extrabold text-duo-ink">{u.name}</div>
                        <div className="text-xs font-bold text-duo-mute">{u.email} • {u.role}</div>
                      </div>
                      <div className="text-xs font-bold text-duo-mute">{new Date(u.createdAt).toLocaleDateString()}</div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        )}

        {stats && (
          <Card title="Recent screenings">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {stats.recentScreenings.map((s) => (
                <div key={s.id} className="card-duo px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-extrabold text-duo-ink">{s.child.fullName}</div>
                      <div className="text-xs font-bold text-duo-mute">
                        {new Date(s.createdAt).toLocaleString()} • {s.status} • {s.user.email}
                      </div>
                    </div>
                    {s.result?.riskLevel ? <RiskPill risk={s.result.riskLevel as any} /> : <span className="text-xs font-bold text-duo-mute">—</span>}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    </DashboardLayout>
  )
}
