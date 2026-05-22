import { useEffect, useMemo, useState } from 'react'
import { DashboardLayout } from '../layouts/DashboardLayout'
import { api } from '../lib/api'
import type { RiskLevel, VideoScreening } from '../lib/types'
import { RiskPill, ConfidenceGauge } from '../components/RiskPill'

function toApiRisk(risk: RiskLevel | 'ALL') {
  if (risk === 'ALL') return undefined
  return risk.toLowerCase()
}

export function HistoryPage() {
  const [screenings, setScreenings] = useState<VideoScreening[] | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [risk, setRisk] = useState<RiskLevel | 'ALL'>('ALL')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const params: any = {}
      const r = toApiRisk(risk)
      if (r) params.risk_level = r
      if (from) params.from = from
      if (to) params.to = to

      const res = await api.get('/screenings', { params })
      setScreenings(res.data.screenings)
      if (!selectedId && res.data.screenings?.[0]?.id) setSelectedId(res.data.screenings[0].id)
    } catch {
      setError('Không tải được lịch sử kết quả.')
      setScreenings([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const selected = useMemo(
    () => (screenings ?? []).find((s) => s.id === selectedId) ?? null,
    [screenings, selectedId],
  )

  return (
    <DashboardLayout>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_400px]">
        {/* ---- List panel ---- */}
        <div className="rounded-3xl bg-white shadow-card ring-1 ring-slate-100 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
            <h1 className="text-base font-bold text-slate-800">Lịch sử kết quả</h1>
            <button
              className="text-xs font-semibold text-[#6C63FF] hover:underline"
              onClick={load}
            >
              {loading ? 'Đang tải...' : 'Tải lại'}
            </button>
          </div>

          {/* Filters */}
          <div className="px-5 pt-4 pb-3 grid grid-cols-1 gap-3 md:grid-cols-3">
            <div>
              <label className="text-xs font-semibold text-slate-600">Mức nguy cơ</label>
              <select
                className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-[#6C63FF] focus:ring-2 focus:ring-indigo-100"
                value={risk}
                onChange={(e) => setRisk(e.target.value as any)}
              >
                <option value="ALL">Tất cả</option>
                <option value="LOW">Nguy cơ thấp</option>
                <option value="MEDIUM">Nguy cơ trung bình</option>
                <option value="HIGH">Nguy cơ cao</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600">Từ ngày</label>
              <input
                type="date"
                className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-[#6C63FF] focus:ring-2 focus:ring-indigo-100"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600">Đến ngày</label>
              <input
                type="date"
                className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-[#6C63FF] focus:ring-2 focus:ring-indigo-100"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
          </div>
          <div className="px-5 pb-4">
            <button
              type="button"
              onClick={load}
              className="rounded-xl px-5 py-2 text-sm font-semibold text-white transition hover:opacity-90"
              style={{ background: 'linear-gradient(135deg, #6C63FF, #4FC3F7)' }}
            >
              Áp dụng lọc
            </button>
          </div>

          {error && (
            <div className="mx-5 mb-4 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
          )}

          {/* Result list */}
          <div className="px-3 pb-4 space-y-1.5">
            {(screenings ?? []).map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSelectedId(s.id)}
                className={[
                  'w-full flex items-center gap-3 rounded-2xl px-4 py-3 text-left transition',
                  selectedId === s.id
                    ? 'ring-2 ring-[#6C63FF] bg-indigo-50'
                    : 'hover:bg-slate-50 ring-1 ring-transparent',
                ].join(' ')}
              >
                <div
                  className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-white font-bold text-sm"
                  style={{ background: 'linear-gradient(135deg, #6C63FF, #4FC3F7)' }}
                >
                  {s.child.fullName.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-slate-800 truncate">{s.child.fullName}</div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    {new Date(s.createdAt).toLocaleDateString('vi-VN')} • {s.status}
                  </div>
                </div>
                {s.result ? (
                  <RiskPill risk={s.result.riskLevel} />
                ) : (
                  <span className="text-xs text-slate-400">Chưa có kết quả</span>
                )}
              </button>
            ))}

            {screenings && screenings.length === 0 && (
              <div className="rounded-2xl bg-slate-50 px-4 py-6 text-sm text-slate-400 text-center ring-1 ring-slate-100">
                Không có dữ liệu.
              </div>
            )}
          </div>
        </div>

        {/* ---- Detail panel ---- */}
        <div className="rounded-3xl bg-white shadow-card ring-1 ring-slate-100 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="text-base font-bold text-slate-800">Chi tiết kết quả</h2>
          </div>
          <div className="p-5">
            {!selected && (
              <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                <div className="text-4xl mb-3">📋</div>
                <div className="text-sm">Chọn một kết quả để xem chi tiết.</div>
              </div>
            )}

            {selected && (
              <div className="space-y-5">
                <div className="flex items-center gap-3">
                  <div
                    className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full text-white font-bold"
                    style={{ background: 'linear-gradient(135deg, #6C63FF, #4FC3F7)' }}
                  >
                    {selected.child.fullName.charAt(0)}
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-bold text-slate-800">{selected.child.fullName}</div>
                    <div className="text-xs text-slate-400 mt-0.5">
                      {new Date(selected.createdAt).toLocaleString('vi-VN')}
                    </div>
                  </div>
                  {selected.result && <RiskPill risk={selected.result.riskLevel} />}
                </div>

                {selected.result ? (
                  <>
                    {/* Confidence Gauge — ASD vs Typical only */}
                    <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-100">
                      <div className="text-sm font-bold text-slate-700 mb-3">Kết quả phân tích AI</div>
                      <ConfidenceGauge
                        confidenceScore={selected.result.confidenceScore}
                        riskLevel={selected.result.riskLevel}
                      />
                    </div>

                    {/* Recommendation */}
                    <div>
                      <div className="text-sm font-bold text-slate-700 mb-2">Khuyến nghị tham khảo</div>
                      <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm leading-relaxed text-slate-600 ring-1 ring-slate-100">
                        {selected.result.recommendation}
                      </div>
                    </div>

                    <div className="rounded-xl bg-amber-50 px-3 py-2.5 text-xs text-amber-700 ring-1 ring-amber-100">
                      ⚠️ Lưu ý: Kết quả chỉ mang tính tham khảo, không thay thế chẩn đoán y khoa.
                    </div>
                  </>
                ) : (
                  <div className="rounded-xl bg-indigo-50 px-4 py-3 text-sm text-indigo-700">
                    Trạng thái: <strong>{selected.status}</strong>. Vui lòng chờ xử lý hoàn tất.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  )
}
