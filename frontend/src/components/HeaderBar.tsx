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
    <header className="flex items-center justify-between gap-3">
      <div className="md:hidden text-xl font-black text-duo-ink">ASDr</div>
      <div className="ml-auto flex items-center gap-3">
        {user && (
          <div className="flex items-center gap-2">
            <div className="grid h-10 w-10 place-items-center rounded-full bg-duo-gold text-sm font-black text-duo-ink">
              {initials(user.name)}
            </div>
            <div className="hidden sm:block">
              <div className="text-sm font-extrabold text-duo-ink">{user.name.split(' ').at(-1)}</div>
              <div className="text-xs font-bold uppercase tracking-wide text-duo-mute">
                {user.role === 'ADMIN' ? 'Admin' : 'Phụ huynh'}
              </div>
            </div>
            <button type="button" className="btn-duo-ghost !px-3 !py-2 !text-xs" onClick={() => logout()}>
              Thoát
            </button>
          </div>
        )}
      </div>
    </header>
  )
}
