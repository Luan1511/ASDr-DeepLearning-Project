import { useState, type FormEvent } from 'react'
import { useParams } from 'react-router-dom'
import { api } from '../lib/api'

export function DoctorInvitationPage() {
  const { token = '' } = useParams()
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(e: FormEvent) { e.preventDefault(); setBusy(true); setMessage(''); try { await api.post('/auth/doctor-invitations/accept', { token, password }); setMessage('Đã tạo tài khoản. Hồ sơ đang chờ quản trị viên xác minh trước khi xuất hiện trong danh bạ.') } catch { setMessage('Lời mời không hợp lệ, đã hết hạn hoặc đã được sử dụng.') } finally { setBusy(false) } }
  return <main className="mx-auto mt-16 max-w-md rounded-3xl bg-white p-6 shadow"><h1 className="text-xl font-black">Nhận lời mời bác sĩ AIMBRACE</h1><form onSubmit={submit} className="mt-4 space-y-3"><label className="block text-sm font-bold">Tạo mật khẩu (tối thiểu 10 ký tự)<input className="input-duo mt-1" type="password" autoComplete="new-password" minLength={10} required value={password} onChange={(e) => setPassword(e.target.value)} /></label><button className="btn-duo w-full" disabled={busy}>{busy ? 'Đang tạo…' : 'Tạo tài khoản'}</button></form>{message && <p role="status" className="mt-4 text-sm font-semibold">{message}</p>}</main>
}
