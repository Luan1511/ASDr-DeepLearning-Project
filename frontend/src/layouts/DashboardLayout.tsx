import React from 'react'
import { NavLink } from 'react-router-dom'
import { Sidebar } from '../components/Sidebar'
import { HeaderBar } from '../components/HeaderBar'
import { Home, Video, History, Baby, Bot, BookOpen, PersonStanding, Settings, Users, type LucideIcon } from 'lucide-react'
import { useExerciseCapabilities } from '../lib/useExerciseCapabilities'
import { useAuth } from '../state/auth'

interface MobileItem {
  to: string
  label: string
  icon: LucideIcon
  end?: boolean
}

const mobileItems: MobileItem[] = [
  { to: '/', label: 'Home', end: true, icon: Home },
  { to: '/screening', label: 'Sàng lọc', icon: Video },
  { to: '/children', label: 'Trẻ', icon: Baby },
  { to: '/history', label: 'Lịch sử', icon: History },
  { to: '/assistant', label: 'AI', icon: Bot },
  { to: '/knowledge', label: 'Học', icon: BookOpen },
]

// With exercises available, "Tập" takes the slot of "Học" (still reachable from Home and the sidebar).
const exerciseMobileItems: MobileItem[] = [
  { to: '/', label: 'Home', end: true, icon: Home },
  { to: '/screening', label: 'Sàng lọc', icon: Video },
  { to: '/children', label: 'Trẻ', icon: Baby },
  { to: '/exercises', label: 'Tập', icon: PersonStanding },
  { to: '/assistant', label: 'AI', icon: Bot },
  { to: '/history', label: 'Lịch sử', icon: History },
]

// A doctor account only works on the doctor side.
const doctorMobileItems: MobileItem[] = [
  { to: '/doctor', label: 'Hồ sơ', icon: Users },
  { to: '/knowledge', label: 'Học', icon: BookOpen },
  { to: '/settings', label: 'Cài đặt', icon: Settings },
]

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const caps = useExerciseCapabilities()
  const { user } = useAuth()
  const navItems = user?.doctor ? doctorMobileItems : caps?.available ? exerciseMobileItems : mobileItems
  return (
    <div className="min-h-screen bg-white">
      <div className="mx-auto flex">
        <div className="sticky top-0 z-10 hidden h-screen w-[280px] flex-shrink-0 bg-white shadow-rail md:block">
          <Sidebar />
        </div>

        <main className="min-w-0 flex-1 px-6 pb-24 pt-4 md:px-12 md:pb-12 md:pt-8">
          <HeaderBar />
          <div className="mt-5">{children}</div>
        </main>
      </div>

      <nav
        className={[
          'fixed inset-x-0 bottom-0 z-20 grid bg-white shadow-nav-bar md:hidden',
          navItems.length === 3 ? 'grid-cols-3' : 'grid-cols-6',
        ].join(' ')}
      >
        {navItems.map((it) => {
          const Icon = it.icon
          return (
            <NavLink
              key={it.to}
              to={it.to}
              end={it.end}
              className={({ isActive }) =>
                [
                  'flex flex-col items-center gap-1 py-2 text-[10px] font-extrabold uppercase tracking-wide transition-colors',
                  isActive ? 'text-duo-green-dark font-black' : 'text-duo-mute hover:text-duo-ink',
                ].join(' ')
              }
            >
              {({ isActive }) => (
                <>
                  <Icon
                    className={`h-5 w-5 ${
                      isActive ? 'text-duo-green-dark stroke-[2.5]' : 'text-duo-mute stroke-[2]'
                    }`}
                  />
                  <span>{it.label}</span>
                </>
              )}
            </NavLink>
          )
        })}
      </nav>
    </div>
  )
}
