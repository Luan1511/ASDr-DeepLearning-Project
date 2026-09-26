import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import type { VideoScreening } from '../lib/types'
import { RiskPill } from './RiskPill'

function ChildAvatar({ name }: { name: string }) {
  const colors = ['bg-duo-green', 'bg-duo-blue', 'bg-duo-gold', 'bg-[#CE82FF]']
  const idx = name.charCodeAt(0) % colors.length
  return (
    <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-sm font-black text-white ${colors[idx]}`}>
      {name.charAt(0)}
    </div>
  )
}

export function RecentResultsCard() {
  const [screenings, setScreenings] = useState<VideoScreening[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .get('/screenings')
      .then((res) => setScreenings(res.data.screenings))
      .catch(() => setError('Không tải được lịch sử'))
  }, [])

  const recent = useMemo(() => (screenings ?? []).filter((s) => s.result).slice(0, 3), [screenings])

  return (
    <div className="card-duo overflow-hidden">
      <div className="divider-duo flex items-center justify-between px-4 py-3">
        <span className="text-sm font-extrabold uppercase tracking-wide text-duo-ink">Gần đây</span>
        <Link to="/history" className="link-duo text-xs">
          Tất cả
        </Link>
      </div>

      <div className="space-y-1 p-3">
        {error && <div className="px-1 text-sm font-bold text-duo-red">{error}</div>}
        {!error && screenings === null && <div className="px-1 py-2 text-sm font-semibold text-duo-mute">Đang tải...</div>}
        {!error && screenings && recent.length === 0 && (
          <div className="px-1 py-2 text-sm font-semibold text-duo-mute">Chưa có kết quả.</div>
        )}

        {recent.map((s) => (
          <Link to="/history" key={s.id} className="flex items-center gap-3 rounded-2xl px-3 py-2.5 hover:bg-duo-mist">
            <ChildAvatar name={s.child.fullName} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-extrabold text-duo-ink">{s.child.fullName}</div>
              <div className="mt-0.5 text-xs font-bold text-duo-mute">{new Date(s.createdAt).toLocaleDateString('vi-VN')}</div>
            </div>
            {s.result && <RiskPill risk={s.result.riskLevel} />}
          </Link>
        ))}
      </div>
    </div>
  )
}
