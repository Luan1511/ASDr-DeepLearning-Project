import { useState } from 'react'
import { DashboardLayout } from '../layouts/DashboardLayout'
import { Card } from '../components/Card'
import { useAuth } from '../state/auth'

export function SettingsPage() {
  const { user, logout } = useAuth()
  const [busy, setBusy] = useState(false)

  async function doLogout() {
    setBusy(true)
    try {
      await logout()
    } finally {
      setBusy(false)
    }
  }

  return (
    <DashboardLayout>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_420px]">
        <Card title="Tài khoản">
          <div className="space-y-2 text-sm text-slate-700">
            <div>
              <span className="font-semibold">Tên:</span> {user?.name}
            </div>
            <div>
              <span className="font-semibold">Email:</span> {user?.email}
            </div>
            <div>
              <span className="font-semibold">Vai trò:</span> {user?.role}
            </div>
          </div>

          <button
            type="button"
            onClick={doLogout}
            disabled={busy}
            className="mt-5 rounded-xl bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-50"
          >
            {busy ? 'Đang đăng xuất...' : 'Đăng xuất'}
          </button>
        </Card>

        <Card title="Ghi chú">
          <div className="text-sm leading-relaxed text-slate-600">
            Đây là bản demo local. Bạn có thể dùng tài khoản seed để trải nghiệm nhanh.
          </div>
        </Card>
      </div>
    </DashboardLayout>
  )
}
