import { useNavigate } from 'react-router-dom'

export function HeaderBar() {
  const navigate = useNavigate()
  return (
    // Only shown on mobile (md:hidden) — desktop uses the sidebar logo
    <header className="md:hidden flex items-center py-1">
      <button
        type="button"
        onClick={() => navigate('/')}
        className="flex items-center gap-2.5 text-left"
      >
        <img src="/logo-mark.png" alt="AIMBRACE" className="h-8 w-8 object-contain flex-shrink-0" />
        <span className="text-xl font-black text-duo-ink tracking-tight">AIMBRACE</span>
      </button>
    </header>
  )
}
