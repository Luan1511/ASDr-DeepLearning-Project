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
    <div className="flex min-h-screen items-center justify-center bg-white px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-duo-green text-2xl font-black text-white shadow-brand">
            A
          </div>
          <h1 className="mt-5 text-3xl font-black text-duo-ink">Tạo tài khoản</h1>
          <p className="mt-2 text-sm font-semibold text-duo-mute">Quản lý hồ sơ trẻ và lịch sử kết quả.</p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-extrabold uppercase tracking-wide text-duo-mute">Tên hiển thị</label>
            <input className="input-duo" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-extrabold uppercase tracking-wide text-duo-mute">Email</label>
            <input
              className="input-duo"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              autoComplete="email"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-extrabold uppercase tracking-wide text-duo-mute">Mật khẩu</label>
            <input
              className="input-duo"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              autoComplete="new-password"
            />
          </div>

          {error && <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-bold text-duo-red">{error}</div>}

          <button disabled={loading} className="btn-duo w-full">
            {loading ? 'Đang tạo tài khoản...' : 'Đăng ký'}
          </button>

          <div className="text-center text-sm font-semibold text-duo-mute">
            Đã có tài khoản?{' '}
            <Link className="link-duo" to="/login">
              Đăng nhập
            </Link>
          </div>
        </form>
      </div>
    </div>
  )
}
