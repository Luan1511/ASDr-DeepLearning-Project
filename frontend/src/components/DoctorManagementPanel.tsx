import { useState } from 'react'
import { api } from '../lib/api'

export type ManagedDoctor = { id: string; displayName: string; email: string; specialty: string; verificationStatus: string; isActive: boolean; verifiedAt: string | null; verifiedBy: string | null; title: string; workplace: string; city: string; bio: string; languages: string[] }
type Audit = { id: string; adminName: string; action: string; previous: string; next: string; occurredAt: string }
const statuses: Record<string, string> = { PENDING: 'Chờ xác minh', VERIFIED: 'Đã xác minh', REJECTED: 'Từ chối' }
const valueLabel = (value: string) => statuses[value] ?? (value === 'true' ? 'Hoạt động' : value === 'false' ? 'Tạm khóa' : value)

function DoctorRow({ doctor, update }: { doctor: ManagedDoctor; update: (id: string, path: string, data: unknown) => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [history, setHistory] = useState<Audit[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function loadHistory() {
    try { const { data } = await api.get(`/admin/doctors/${doctor.id}/history`); setHistory(data.events); setError('') }
    catch { setError('Không tải được lịch sử quản lý.') }
  }
  async function change(path: string, data: unknown, message: string) {
    if (!window.confirm(message)) return
    setBusy(true)
    try { await update(doctor.id, path, data); if (open) await loadHistory() }
    catch { setError('Thao tác chưa được lưu. Vui lòng thử lại.') }
    finally { setBusy(false) }
  }
  return <article className="rounded-2xl border border-duo-line p-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-black">{doctor.title} {doctor.displayName}</h3><p className="mt-1 text-xs text-duo-mute">{doctor.email} · {doctor.specialty}</p><p className="mt-1 text-xs font-bold">{statuses[doctor.verificationStatus]} · {doctor.isActive ? 'Hoạt động' : 'Tạm khóa'}</p></div><button className="btn-duo-secondary" type="button" aria-expanded={open} onClick={() => { setOpen(!open); if (!open) void loadHistory() }}>Chi tiết và lịch sử</button></div>
    <div className="mt-3 flex flex-wrap gap-2"><select disabled={busy} aria-label={`Xác minh ${doctor.displayName}`} className="input-duo !w-auto" value={doctor.verificationStatus} onChange={(event) => void change('verification', { status: event.target.value }, event.target.value === 'VERIFIED' ? `Xác nhận đã kiểm tra chuyên môn và danh tính của ${doctor.displayName} bên ngoài hệ thống?` : `Đổi trạng thái xác minh của ${doctor.displayName}?`)}>{Object.entries(statuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><button type="button" disabled={busy || (!doctor.isActive && doctor.verificationStatus !== 'VERIFIED')} className="btn-duo-secondary" onClick={() => void change('active', { active: !doctor.isActive }, `${doctor.isActive ? 'Tạm khóa' : 'Kích hoạt'} hồ sơ ${doctor.displayName}?`)}>{doctor.isActive ? 'Tạm khóa' : 'Kích hoạt'}</button></div>
    {!doctor.isActive && doctor.verificationStatus !== 'VERIFIED' && <p className="mt-2 text-xs text-duo-mute">Cần xác minh trước khi kích hoạt.</p>}
    {open && <div className="mt-4 space-y-3 border-t border-duo-line pt-3 text-sm"><p><b>Nơi làm việc:</b> {doctor.workplace}, {doctor.city}</p><p><b>Giới thiệu:</b> {doctor.bio || 'Chưa cập nhật'}</p><p><b>Ngôn ngữ:</b> {doctor.languages.join(', ') || 'Chưa cập nhật'}</p><p><b>Xác minh gần nhất:</b> {doctor.verifiedAt ? `${new Date(doctor.verifiedAt).toLocaleString('vi-VN')} · ${doctor.verifiedBy ?? 'Quản trị viên'}` : 'Chưa có xác minh hiện hành'}</p><div className="flex justify-between"><h4 className="font-bold">Lịch sử quản lý</h4><button type="button" className="link-duo text-xs" onClick={() => void loadHistory()}>Tải lại</button></div>{error && <p role="alert" className="text-red-700">{error}</p>}{!error && history.length === 0 && <p className="text-xs text-duo-mute">Chưa có sự kiện quản lý được ghi nhận.</p>}<ol className="divide-y divide-duo-line">{history.map((event) => <li key={event.id} className="py-2 text-xs">{event.action === 'VERIFICATION' ? 'Xác minh' : 'Trạng thái tài khoản'}: {valueLabel(event.previous)} → {valueLabel(event.next)}<p className="mt-1 text-duo-mute">{event.adminName} · {new Date(event.occurredAt).toLocaleString('vi-VN')}</p></li>)}</ol></div>}
  </article>
}

export function DoctorManagementPanel({ doctors, update }: { doctors: ManagedDoctor[]; update: (id: string, path: string, data: unknown) => Promise<void> }) {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('ALL')
  const [active, setActive] = useState('ALL')
  const visible = doctors.filter((doctor) => `${doctor.displayName} ${doctor.email} ${doctor.specialty} ${doctor.workplace} ${doctor.city}`.toLocaleLowerCase('vi').includes(query.trim().toLocaleLowerCase('vi')) && (status === 'ALL' || doctor.verificationStatus === status) && (active === 'ALL' || String(doctor.isActive) === active))
  return <section className="card-duo space-y-4 p-5"><h2 className="font-black">Hồ sơ bác sĩ</h2><div className="flex flex-wrap gap-2"><input className="input-duo flex-1" aria-label="Tìm bác sĩ trong quản trị" placeholder="Tên, email, chuyên khoa, nơi làm việc…" value={query} onChange={(event) => setQuery(event.target.value)} /><select className="input-duo !w-auto" aria-label="Lọc xác minh" value={status} onChange={(event) => setStatus(event.target.value)}><option value="ALL">Mọi trạng thái xác minh</option>{Object.entries(statuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><select className="input-duo !w-auto" aria-label="Lọc trạng thái hoạt động" value={active} onChange={(event) => setActive(event.target.value)}><option value="ALL">Mọi tài khoản</option><option value="true">Hoạt động</option><option value="false">Tạm khóa</option></select></div><p role="status" className="text-xs text-duo-mute">{visible.length}/{doctors.length} hồ sơ</p>{visible.map((doctor) => <DoctorRow key={doctor.id} doctor={doctor} update={update} />)}{visible.length === 0 && <p className="text-sm">Không có bác sĩ phù hợp.</p>}</section>
}
