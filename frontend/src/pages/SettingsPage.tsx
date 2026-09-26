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
      <div className="mx-auto max-w-md space-y-4">
        <h1 className="text-2xl font-black text-duo-ink">Cài đặt</h1>
        <Card title="Tài khoản">
          <div className="space-y-2 text-sm font-semibold text-duo-ink">
            <div>{user?.name}</div>
            <div className="text-duo-mute">{user?.email}</div>
            <div className="text-xs font-extrabold uppercase tracking-wide text-duo-mute">{user?.role}</div>
          </div>
          <button type="button" onClick={doLogout} disabled={busy} className="btn-duo-ghost mt-5">
            {busy ? 'Đang đăng xuất...' : 'Đăng xuất'}
          </button>
        </Card>
      </div>
    </DashboardLayout>
  )
}
