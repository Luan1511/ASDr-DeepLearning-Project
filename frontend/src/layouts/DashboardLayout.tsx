import React from 'react'
import { NavLink } from 'react-router-dom'
import { Sidebar } from '../components/Sidebar'
import { HeaderBar } from '../components/HeaderBar'
import { Home, Video, History, Bot, BookOpen, type LucideIcon } from 'lucide-react'

interface MobileItem {
  to: string
  label: string
  icon: LucideIcon
  end?: boolean
}

const mobileItems: MobileItem[] = [
  { to: '/', label: 'Home', end: true, icon: Home },
  { to: '/screening', label: 'Sàng lọc', icon: Video },
  { to: '/history', label: 'Lịch sử', icon: History },
  { to: '/assistant', label: 'AI', icon: Bot },
  { to: '/knowledge', label: 'Học', icon: BookOpen },
]

export function DashboardLayout({ children }: { children: React.ReactNode }) {
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

      <nav className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 bg-white shadow-nav-bar md:hidden">
        {mobileItems.map((it) => {
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
