import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../state/auth'

export function RegisterPage() {
  const { register } = useAuth()
  const nav = useNavigate()

  const [name, setName] = useState('Người dùng mới')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await register(name, email, password)
      nav('/')
    } catch {
      setError('Không thể đăng ký (email có thể đã tồn tại).')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto max-w-md">
        <div className="mb-6 text-center">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-indigo-600 text-white">A</div>
          <h1 className="mt-4 text-2xl font-semibold text-slate-900">Đăng ký ASDr</h1>
          <p className="mt-1 text-sm text-slate-600">Tạo tài khoản để quản lý hồ sơ trẻ và lịch sử kết quả.</p>
        </div>

        <form onSubmit={onSubmit} className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
          <label className="block text-sm font-medium text-slate-700">Tên hiển thị</label>
          <input
            className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-200"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />

          <label className="mt-4 block text-sm font-medium text-slate-700">Email</label>
          <input
            className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-200"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            autoComplete="email"
          />

          <label className="mt-4 block text-sm font-medium text-slate-700">Mật khẩu</label>
          <input
            className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-200"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            autoComplete="new-password"
          />

          {error && <div className="mt-4 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}

          <button
            disabled={loading}
            className="mt-5 w-full rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            {loading ? 'Đang tạo tài khoản...' : 'Đăng ký'}
          </button>

          <div className="mt-4 text-center text-sm text-slate-600">
            Đã có tài khoản? <Link className="text-indigo-700 hover:underline" to="/login">Đăng nhập</Link>
          </div>
        </form>
      </div>
    </div>
  )
}
