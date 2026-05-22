import { useAuth } from '../state/auth'

function initials(name: string) {
  const parts = name.trim().split(/\s+/)
  const a = parts[0]?.[0] ?? 'U'
  const b = parts.length > 1 ? parts[parts.length - 1][0] : ''
  return (a + b).toUpperCase()
}

export function HeaderBar() {
  const { user, logout } = useAuth()

  return (
    <header className="flex items-center justify-end gap-3 py-2">
      {/* Bell */}
      <button
        type="button"
        className="relative grid h-10 w-10 place-items-center rounded-xl bg-white shadow-card ring-1 ring-slate-100 hover:bg-slate-50 transition"
        aria-label="Thông báo"
      >
        <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 text-slate-500">
          <path d="M10 2a6 6 0 00-6 6v3.586l-.707.707A1 1 0 004 14h12a1 1 0 00.707-1.707L16 11.586V8a6 6 0 00-6-6zM10 18a3 3 0 01-3-3h6a3 3 0 01-3 3z" />
        </svg>
        <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-rose-500 ring-2 ring-white" />
      </button>

      {/* User info */}
      {user && (
        <div className="flex items-center gap-2 rounded-2xl bg-white px-3 py-2 shadow-card ring-1 ring-slate-100">
          <div
            className="grid h-9 w-9 place-items-center rounded-xl text-sm font-bold text-white"
            style={{ background: 'linear-gradient(135deg, #6C63FF 0%, #4FC3F7 100%)' }}
          >
            {initials(user.name)}
          </div>
          <div className="hidden sm:block">
            <div className="text-sm font-semibold text-slate-800">Chào, {user.name.split(' ').at(-1)}</div>
            <div className="text-xs text-slate-500">{user.role === 'ADMIN' ? 'Quản trị viên' : 'Phụ huynh'}</div>
          </div>
          <button
            type="button"
            className="ml-1 rounded-lg px-2 py-1.5 text-xs text-slate-500 hover:bg-slate-50 hover:text-rose-600 transition"
            onClick={() => logout()}
          >
            Đăng xuất
          </button>
        </div>
      )}
    </header>
  )
}
