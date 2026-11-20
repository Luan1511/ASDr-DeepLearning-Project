import { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { SHARE_SCOPE_LABEL, type DoctorShareScope } from '../../lib/doctors'
import { formatDateTime } from '../../lib/format'

type Event = { id: string; type: string; occurredAt: string; doctorName: string; scopes: DoctorShareScope[]; expiresAt: string | null }
const labels: Record<string, string> = { GRANTED: 'Đã cấp quyền', REVOKED: 'Đã thu hồi quyền', EXPIRED: 'Quyền hết hạn', VIEWED: 'Bác sĩ đã mở hồ sơ' }

export function DoctorAccessHistory({ childId }: { childId: string }) {
  const [events, setEvents] = useState<Event[]>([])
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(0)
  const [reload, setReload] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    let stale = false
    setLoading(true)
    api.get(`/children/${childId}/doctor-access-events`, { params: { page } }).then(({ data }) => {
      if (!stale) { setEvents(data.events); setPages(data.totalPages); setError('') }
    }).catch(() => { if (!stale) setError('Không tải được lịch sử chia sẻ.') }).finally(() => { if (!stale) setLoading(false) })
    return () => { stale = true }
  }, [childId, page, reload])
  return <section className="rounded-2xl border border-duo-line p-4" aria-label="Lịch sử quyền và truy cập bác sĩ">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-black">Lịch sử quyền và truy cập</h3><button type="button" className="link-duo text-xs" onClick={() => setReload((value) => value + 1)}>Tải lại lịch sử</button></div>
    {loading ? <p role="status" className="mt-3 text-xs">Đang tải lịch sử…</p> : error ? <p role="alert" className="mt-3 text-xs text-red-700">{error}</p> : events.length === 0 ? <p className="mt-3 text-xs text-duo-mute">Chưa có sự kiện được ghi nhận.</p> : <ol className="mt-3 divide-y divide-duo-line">{events.map((event) => <li key={event.id} className="py-3 text-xs"><strong>{labels[event.type] ?? event.type}</strong> · {event.doctorName}<p className="mt-1 text-duo-mute">{formatDateTime(event.occurredAt)}</p>{event.type === 'GRANTED' && <p className="mt-1">{event.scopes.map((scope) => SHARE_SCOPE_LABEL[scope]).join(' · ')}<br />{event.expiresAt ? `Hạn quyền: ${formatDateTime(event.expiresAt)}` : 'Không thời hạn'}</p>}</li>)}</ol>}
    {pages > 1 && <div className="mt-3 flex items-center justify-between gap-2"><button type="button" className="btn-duo-secondary !py-1" disabled={loading || page === 1} onClick={() => setPage((value) => value - 1)}>Trước</button><span className="text-xs">Trang {page}/{pages}</span><button type="button" className="btn-duo-secondary !py-1" disabled={loading || page >= pages} onClick={() => setPage((value) => value + 1)}>Sau</button></div>}
  </section>
}
