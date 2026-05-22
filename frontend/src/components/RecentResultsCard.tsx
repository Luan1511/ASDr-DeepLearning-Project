import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import type { VideoScreening } from '../lib/types'
import { RiskPill } from './RiskPill'

// Child avatar placeholder
function ChildAvatar({ name }: { name: string }) {
  const colors = [
    'from-violet-400 to-purple-500',
    'from-sky-400 to-blue-500',
    'from-emerald-400 to-teal-500',
    'from-rose-400 to-pink-500',
  ]
  const idx = name.charCodeAt(0) % colors.length
  return (
    <div
      className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br ${colors[idx]} text-sm font-bold text-white`}
    >
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

  const recent = useMemo(
    () => (screenings ?? []).filter((s) => s.result).slice(0, 3),
    [screenings],
  )

  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-card ring-1 ring-slate-100">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
        <span className="text-sm font-bold text-slate-800">Kết quả gần đây</span>
        <Link
          to="/history"
          className="text-xs font-semibold text-[#6C63FF] hover:underline"
        >
          Xem tất cả
        </Link>
      </div>

      <div className="p-3 space-y-1.5">
        {error && <div className="text-sm text-rose-600 px-1">{error}</div>}
        {!error && screenings === null && (
          <div className="text-sm text-slate-400 px-1 py-2">Đang tải...</div>
        )}
        {!error && screenings && recent.length === 0 && (
          <div className="text-sm text-slate-400 px-1 py-2">Chưa có kết quả nào.</div>
        )}

        {recent.map((s) => (
          <Link
            to="/history"
            key={s.id}
            className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-slate-50 transition"
          >
            <ChildAvatar name={s.child.fullName} />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-slate-800 truncate">{s.child.fullName}</div>
              <div className="flex items-center gap-1 text-xs text-slate-400 mt-0.5">
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3">
                  <path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd" />
                </svg>
                {new Date(s.createdAt).toLocaleDateString('vi-VN')}
              </div>
            </div>
            {s.result && <RiskPill risk={s.result.riskLevel} />}
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-slate-300 flex-shrink-0">
              <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
            </svg>
          </Link>
        ))}
      </div>

      {/* Knowledge ASD card */}
      <div
        className="mx-3 mb-3 rounded-2xl p-4 text-white"
        style={{ background: 'linear-gradient(135deg, #00BCD4 0%, #26C6DA 100%)' }}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1">
            <div className="text-sm font-bold leading-snug">Kiến thức ASD hôm nay</div>
            <div className="mt-1.5 text-xs leading-relaxed opacity-90">
              Phát hiện sớm và can thiệp kịp thời có thể giúp trẻ cải thiện kỹ năng giao tiếp, học tập và hòa nhập cộng đồng tốt hơn.
            </div>
          </div>
          <div className="text-3xl flex-shrink-0">🧠</div>
        </div>
        <Link
          to="/knowledge"
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-white/20 px-3 py-1.5 text-xs font-semibold hover:bg-white/30 transition"
        >
          Đọc thêm bài viết →
        </Link>
      </div>
    </div>
  )
}
