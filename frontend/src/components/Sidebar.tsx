import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../state/auth'
import {
  Home,
  Video,
  History,
  Baby,
  Bot,
  BookOpen,
  HelpCircle,
  Settings,
  Shield,
  type LucideIcon,
} from 'lucide-react'

interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  end?: boolean
}

const items: NavItem[] = [
  { to: '/', label: 'Trang chủ', icon: Home, end: true },
  { to: '/screening', label: 'Sàng lọc', icon: Video },
  { to: '/history', label: 'Lịch sử', icon: History },
  { to: '/children', label: 'Hồ sơ trẻ', icon: Baby },
  { to: '/assistant', label: 'Trợ lý AI', icon: Bot },
  { to: '/knowledge', label: 'Kiến thức', icon: BookOpen },
  { to: '/guide', label: 'Hướng dẫn', icon: HelpCircle },
  { to: '/settings', label: 'Cài đặt', icon: Settings },
]

export function Sidebar() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const navItems: NavItem[] =
    user?.role === 'ADMIN' ? [...items, { to: '/admin', label: 'Admin', icon: Shield }] : items

  return (
    <aside className="flex h-full flex-col px-4 py-6">
      <button type="button" className="mb-8 flex items-center gap-2 px-1 text-left" onClick={() => navigate('/')}>
        <span className="grid h-10 w-10 place-items-center rounded-2xl bg-duo-green text-lg font-black text-white shadow-brand">
          A
        </span>
        <span className="text-2xl font-black tracking-tight text-duo-ink">ASDr</span>
      </button>

      <nav className="flex flex-col gap-1.5">
        {navItems.map((it) => {
          const Icon = it.icon
          return (
            <NavLink
              key={it.to}
              to={it.to}
              end={it.end}
              className={({ isActive }) =>
                [
                  'group flex items-center gap-3 rounded-2xl px-3.5 py-3 text-[13px] font-extrabold uppercase tracking-wide transition-all',
                  isActive
                    ? 'bg-duo-green-soft text-duo-green-dark shadow-ring-green font-black'
                    : 'text-duo-mute hover:bg-duo-mist hover:text-duo-ink',
                ].join(' ')
              }
            >
              {({ isActive }) => (
                <>
                  <Icon
                    className={[
                      'h-5 w-5 flex-shrink-0 transition-transform group-hover:scale-110',
                      isActive ? 'text-duo-green-dark stroke-[2.5]' : 'text-duo-mute stroke-[2] group-hover:text-duo-ink',
                    ].join(' ')}
                  />
                  <span>{it.label}</span>
                </>
              )}
            </NavLink>
          )
        })}
      </nav>
    </aside>
  )
}
