import { useEffect, useState, type FormEvent } from 'react'
import { DashboardLayout } from '../layouts/DashboardLayout'
import { api } from '../lib/api'

import { DoctorManagementPanel, type ManagedDoctor } from '../components/DoctorManagementPanel'
type Invitation = { id: string; email: string; displayName: string; specialty: string; expiresAt: string }
const empty = { email: '', displayName: '', title: 'Bác sĩ', specialty: '', workplace: '', city: '', bio: '', languages: 'Tiếng Việt' }

export function AdminDoctorsPage() {
  const [doctors, setDoctors] = useState<ManagedDoctor[]>([])
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [form, setForm] = useState(empty)
  const [inviteUrl, setInviteUrl] = useState('')
  const [error, setError] = useState('')
  const load = () => api.get('/admin/doctors').then((r) => { setDoctors(r.data.doctors); setInvitations(r.data.invitations) }).catch(() => setError('Không tải được hồ sơ bác sĩ.'))
  useEffect(() => { void load() }, [])
  async function invite(e: FormEvent) {
    e.preventDefault(); setError(''); setInviteUrl('')
    try { const result = await api.post('/admin/doctors/invitations', { ...form, languages: form.languages.split(',').map((x) => x.trim()).filter(Boolean) }); setInviteUrl(`${location.origin}${result.data.invitation.acceptPath}`); setForm(empty); await load() }
    catch { setError('Không tạo được lời mời. Kiểm tra email và các trường bắt buộc.') }
  }
  async function update(id: string, path: string, data: unknown) { try { await api.patch(`/admin/doctors/${id}/${path}`, data); await load(); setError('') } catch { setError('Không cập nhật được tài khoản bác sĩ.'); throw new Error('DOCTOR_UPDATE_FAILED') } }
  return <DashboardLayout><main className="mx-auto max-w-5xl space-y-5"><h1 className="text-2xl font-black text-duo-ink">Quản lý tài khoản bác sĩ</h1><section className="card-duo p-5"><h2 className="mb-3 font-black">Mời bác sĩ</h2><form onSubmit={invite} className="grid gap-3 sm:grid-cols-2">{Object.entries(form).map(([key, value]) => <label key={key} className="text-xs font-bold capitalize text-duo-ink">{key === 'email' ? 'Email' : key === 'displayName' ? 'Họ tên hiển thị' : key === 'title' ? 'Chức danh' : key === 'specialty' ? 'Chuyên khoa' : key === 'workplace' ? 'Nơi làm việc' : key === 'city' ? 'Tỉnh/thành' : key === 'bio' ? 'Giới thiệu' : 'Ngôn ngữ (phân cách dấu phẩy)'}<input className="input-duo mt-1" value={value} required={key !== 'bio'} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))} /></label>)}<button className="btn-duo sm:col-span-2">Tạo lời mời 7 ngày</button></form>{inviteUrl && <p className="mt-3 break-all rounded-xl bg-emerald-50 p-3 text-sm">Lời mời dùng một lần, gửi trực tiếp cho bác sĩ: <a className="underline" href={inviteUrl}>{inviteUrl}</a></p>}{error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}</section><section className="card-duo p-5"><h2 className="mb-3 font-black">Lời mời còn hiệu lực</h2>{invitations.map((x) => <div key={x.id} className="flex justify-between border-t py-2 text-sm"><span>{x.displayName} · {x.email} (hết hạn {new Date(x.expiresAt).toLocaleDateString('vi-VN')})</span><button className="text-red-700" onClick={() => api.delete(`/admin/doctors/invitations/${x.id}`).then(load)}>Thu hồi</button></div>)}</section><DoctorManagementPanel doctors={doctors} update={update} /></main></DashboardLayout>
}
