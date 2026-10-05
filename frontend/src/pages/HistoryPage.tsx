import { useEffect, useMemo, useState } from 'react'
import { Loader2, RotateCcw } from 'lucide-react'
import { DashboardLayout } from '../layouts/DashboardLayout'
import { api, apiErrorCode } from '../lib/api'
import type { RiskLevel, VideoScreening } from '../lib/types'
import { RiskPill } from '../components/RiskPill'
import { ScreeningResultView } from '../components/ScreeningResultView'
import { SCREENING_STATUS_LABEL } from '../lib/format'

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
  const [retrying, setRetrying] = useState(false)

  function fetchScreenings() {
    const params: Record<string, string> = {}
    const r = toApiRisk(risk)
    if (r) params.risk_level = r
    if (from) params.from = from
    if (to) params.to = to
    return api.get('/screenings', { params }).then((res) => res.data.screenings as VideoScreening[])
  }

  function applyScreenings(list: VideoScreening[]) {
    setScreenings(list)
    setSelectedId((current) => current ?? list[0]?.id ?? null)
  }

  function showLoadError() {
    setError('Không tải được lịch sử kết quả.')
    setScreenings([])
  }

  async function load() {
    setLoading(true)
    setError(null)
    try {
      applyScreenings(await fetchScreenings())
    } catch {
      showLoadError()
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchScreenings().then(applyScreenings, showLoadError)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const selected = useMemo(() => (screenings ?? []).find((s) => s.id === selectedId) ?? null, [screenings, selectedId])

  async function retry(id: string) {
    setRetrying(true)
    setError(null)
    try {
      await api.post(`/screenings/${id}/process`)
      await load()
    } catch (e) {
      setError(
        apiErrorCode(e) === 'CONSENT_REQUIRED'
          ? 'Cần xác nhận đồng ý của phụ huynh (ở trang Sàng lọc) trước khi phân tích lại.'
          : 'Không gửi lại được yêu cầu phân tích.',
      )
    } finally {
      setRetrying(false)
    }
  }

  return (
    <DashboardLayout>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_420px]">
        <div className="card-duo overflow-hidden">
          <div className="divider-duo flex items-center justify-between px-5 py-4">
            <h1 className="text-sm font-extrabold uppercase tracking-wide text-duo-ink">Lịch sử</h1>
            <button className="link-duo text-xs" onClick={load}>
              {loading ? 'Đang tải...' : 'Tải lại'}
            </button>
          </div>

          <div className="grid grid-cols-1 gap-3 px-5 pt-4 md:grid-cols-3">
            <select className="input-duo" value={risk} onChange={(e) => setRisk(e.target.value as RiskLevel | 'ALL')}>
              <option value="ALL">Tất cả mức</option>
              <option value="LOW">Thấp</option>
              <option value="MEDIUM">Trung bình</option>
              <option value="HIGH">Cao</option>
            </select>
            <input className="input-duo" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            <input className="input-duo" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="px-5 py-3">
            <button type="button" onClick={load} className="btn-duo">
              Lọc
            </button>
          </div>

          {error && <div className="mx-5 mb-4 rounded-2xl bg-red-50 px-3 py-2 text-sm font-bold text-duo-red">{error}</div>}

          <div className="space-y-2 px-3 pb-4">
            {(screenings ?? []).map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSelectedId(s.id)}
                className={[
                  'flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left transition-all',
                  selectedId === s.id ? 'bg-duo-green-soft shadow-ring-green' : 'hover:bg-duo-mist',
                ].join(' ')}
              >
                <div className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-full bg-duo-blue text-sm font-black text-white">
                  {s.child.fullName.charAt(0)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-extrabold text-duo-ink">{s.child.fullName}</div>
                  <div className="mt-0.5 text-xs font-bold text-duo-mute">
                    {new Date(s.createdAt).toLocaleDateString('vi-VN')} • {SCREENING_STATUS_LABEL[s.status]}
                  </div>
                </div>
                {s.result ? <RiskPill risk={s.result.riskLevel} /> : <span className="text-xs font-bold text-duo-mute">—</span>}
              </button>
            ))}

            {screenings && screenings.length === 0 && (
              <div className="rounded-2xl bg-duo-mist px-4 py-8 text-center text-sm font-semibold text-duo-mute">Không có dữ liệu.</div>
            )}
          </div>
        </div>

        <div className="card-duo overflow-hidden">
          <div className="divider-duo px-5 py-4">
            <h2 className="text-sm font-extrabold uppercase tracking-wide text-duo-ink">Chi tiết</h2>
          </div>
          <div className="p-5">
            {!selected && <div className="py-12 text-center text-sm font-semibold text-duo-mute">Chọn một kết quả để xem.</div>}
            {selected && (
              <div className="space-y-5">
                <div>
                  <div className="text-sm font-extrabold text-duo-ink">{selected.child.fullName}</div>
                  <div className="mt-0.5 text-xs font-bold text-duo-mute">{new Date(selected.createdAt).toLocaleString('vi-VN')}</div>
                </div>

                {selected.result && <ScreeningResultView result={selected.result} showGaitByDefault />}

                {!selected.result && selected.status === 'PROCESSING' && (
                  <div className="flex items-center gap-2 rounded-2xl bg-duo-green-soft px-4 py-3 text-sm font-bold text-duo-green-dark">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {selected.job?.status === 'QUEUED' ? 'Đang chờ đến lượt phân tích.' : 'Đang phân tích...'}
                  </div>
                )}

                {!selected.result && selected.status === 'FAILED' && (
                  <div className="space-y-3">
                    <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-semibold text-duo-red">
                      {selected.errorMessage ?? 'Phân tích thất bại.'}
                    </div>
                    {!selected.rawVideoDeleted && (
                      <button type="button" className="btn-duo-secondary" disabled={retrying} onClick={() => retry(selected.id)}>
                        <RotateCcw className="h-4 w-4" />
                        {retrying ? 'Đang gửi...' : 'Thử phân tích lại'}
                      </button>
                    )}
                  </div>
                )}

                {!selected.result && selected.status === 'UPLOADED' && (
                  <div className="space-y-3">
                    <div className="rounded-2xl bg-duo-mist px-4 py-3 text-sm font-semibold text-duo-ink">
                      Video đã tải lên nhưng chưa được gửi phân tích.
                    </div>
                    <button type="button" className="btn-duo-secondary" disabled={retrying} onClick={() => retry(selected.id)}>
                      {retrying ? 'Đang gửi...' : 'Gửi phân tích'}
                    </button>
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
