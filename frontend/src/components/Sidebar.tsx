import { NavLink, useLocation, useNavigate } from 'react-router-dom'
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
  PersonStanding,
  ClipboardList,
  MessageSquareHeart,
  type LucideIcon,
} from 'lucide-react'
import { useExerciseCapabilities } from '../lib/useExerciseCapabilities'
import { useQuestionnairesEnabled } from '../lib/useQuestionnairesEnabled'

interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  end?: boolean
  isActive?: (pathname: string) => boolean
}

const helpItems: NavItem[] = [
  { to: '/assistant', label: 'Trợ lý AI', icon: Bot },
  { to: '/knowledge', label: 'Kiến thức', icon: BookOpen },
  { to: '/guide', label: 'Hướng dẫn', icon: HelpCircle },
]

// Admin tools sit under one entry; their links show only inside /admin.
const adminItems: Array<Omit<NavItem, 'icon'>> = [
  { to: '/admin', label: 'Tổng quan', end: true },
  { to: '/admin/skeleton', label: 'Skeleton' },
  { to: '/admin/exercises', label: 'Bài tập' },
]

function NavRow({ item, currentPath }: { item: NavItem; currentPath: string }) {
  const Icon = item.icon
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) => {
        const active = item.isActive ? item.isActive(currentPath) : isActive
        return [
          'group flex items-center gap-3 rounded-xl px-3 py-2 text-[15px] transition-colors',
          active
            ? 'bg-duo-green-soft font-extrabold text-duo-green-dark'
            : 'font-bold text-duo-mute hover:bg-duo-mist hover:text-duo-ink',
        ].join(' ')
      }}
    >
      {({ isActive }) => {
        const active = item.isActive ? item.isActive(currentPath) : isActive
        return (
          <>
            <Icon
              className={[
                'h-5 w-5 flex-shrink-0',
                active ? 'stroke-[2.5] text-duo-green-dark' : 'stroke-[2] text-duo-mute group-hover:text-duo-ink',
              ].join(' ')}
            />
            <span>{item.label}</span>
          </>
        )
      }}
    </NavLink>
  )
}

function Divider() {
  return <div className="mx-3 my-2.5 h-px bg-duo-line" />
}

export function Sidebar() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const caps = useExerciseCapabilities()
  const questionnaires = useQuestionnairesEnabled()

  const isQuestionnairePath = (p: string) =>
    p === '/questionnaires' ||
    p.startsWith('/questionnaires/') ||
    p.startsWith('/questionnaire-responses/') ||
    p.includes('/questionnaires/')

  const isChildPath = (p: string) =>
    (p === '/children' || p.startsWith('/children/')) && (!questionnaires || !p.includes('/questionnaires/'))

  const isExercisePath = (p: string) =>
    p === '/exercises' || p.startsWith('/exercises/') || p.startsWith('/exercise-sessions/')

  const isCommunityPath = (p: string) =>
    p === '/community' || p.startsWith('/community/')

  const mainItems: NavItem[] = [
    { to: '/', label: 'Trang chủ', icon: Home, end: true },
    {
      to: '/children',
      label: 'Hồ sơ trẻ',
      icon: Baby,
      isActive: isChildPath,
    },
    { to: '/screening', label: 'Sàng lọc', icon: Video },
    ...(questionnaires
      ? [
          {
            to: '/questionnaires',
            label: 'Bảng hỏi',
            icon: ClipboardList,
            isActive: isQuestionnairePath,
          },
        ]
      : []),
    ...(caps?.available
      ? [
          {
            to: '/exercises',
            label: 'Bài tập',
            icon: PersonStanding,
            isActive: isExercisePath,
          },
        ]
      : []),
    {
      to: '/community',
      label: 'Cộng đồng',
      icon: MessageSquareHeart,
      isActive: isCommunityPath,
    },
    { to: '/history', label: 'Lịch sử', icon: History },
  ]
  const isAdmin = user?.role === 'ADMIN'
  const inAdmin = pathname === '/admin' || pathname.startsWith('/admin/')

  return (
    <aside className="flex h-full flex-col px-4 py-5">
      <button type="button" className="mb-5 flex items-center gap-2 px-1 text-left" onClick={() => navigate('/')}>
        <span className="grid h-10 w-10 place-items-center rounded-2xl bg-duo-green text-lg font-black text-white shadow-brand">
          A
        </span>
        <span className="text-2xl font-black tracking-tight text-duo-ink">AIMBRACE</span>
      </button>

      <nav className="-mx-1 flex min-h-0 flex-1 flex-col overflow-y-auto px-1 [scrollbar-width:thin]">
        <div className="flex flex-col gap-0.5">
          {mainItems.map((it) => (
            <NavRow key={it.to} item={it} currentPath={pathname} />
          ))}
        </div>

        <Divider />

        <div className="flex flex-col gap-0.5">
          {helpItems.map((it) => (
            <NavRow key={it.to} item={it} currentPath={pathname} />
          ))}
        </div>

        <div className="mt-auto">
          <Divider />
          <div className="flex flex-col gap-0.5">
            {isAdmin && (
              <>
                <NavLink
                  to="/admin"
                  className={[
                    'group flex items-center gap-3 rounded-xl px-3 py-2 text-[15px] transition-colors',
                    inAdmin ? 'font-extrabold text-duo-green-dark' : 'font-bold text-duo-mute hover:bg-duo-mist hover:text-duo-ink',
                  ].join(' ')}
                >
                  <Shield
                    className={[
                      'h-5 w-5 flex-shrink-0',
                      inAdmin ? 'stroke-[2.5] text-duo-green-dark' : 'stroke-[2] text-duo-mute group-hover:text-duo-ink',
                    ].join(' ')}
                  />
                  <span>Quản trị</span>
                </NavLink>
                {inAdmin && (
                  <div className="mb-1 ml-[22px] flex flex-col gap-0.5 border-l-2 border-duo-line pl-3">
                    {adminItems.map((it) => (
                      <NavLink
                        key={it.to}
                        to={it.to}
                        end={it.end}
                        className={({ isActive }) =>
                          [
                            'rounded-lg px-3 py-1.5 text-sm transition-colors',
                            isActive
                              ? 'bg-duo-green-soft font-extrabold text-duo-green-dark'
                              : 'font-bold text-duo-mute hover:bg-duo-mist hover:text-duo-ink',
                          ].join(' ')
                        }
                      >
                        {it.label}
                      </NavLink>
                    ))}
                  </div>
                )}
              </>
            )}
            <NavRow item={{ to: '/settings', label: 'Cài đặt', icon: Settings }} currentPath={pathname} />
          </div>
        </div>
      </nav>
    </aside>
  )
}
