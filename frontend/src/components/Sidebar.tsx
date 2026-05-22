import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../state/auth'

// SVG Icons
const Icons = {
  home: (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
      <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" />
    </svg>
  ),
  screening: (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
      <path d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm3 2h6v4H7V5zm8 8v2h1v-2h-1zm-2-2H7v4h6v-4zm2 0h1V9h-1v2zm1-4V5h-1v2h1zM6 5H5v2h1V5zM5 7H4v2h1V7zm0 2H4v2h1V9zm0 2H4v2h1v-2z" />
    </svg>
  ),
  history: (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
      <path fillRule="evenodd" d="M3 3a1 1 0 000 2v8a2 2 0 002 2h2.586l-1.293 1.293a1 1 0 101.414 1.414L10 15.414l2.293 2.293a1 1 0 001.414-1.414L12.414 15H15a2 2 0 002-2V5a1 1 0 100-2H3zm11.707 4.707a1 1 0 00-1.414-1.414L10 9.586 8.707 8.293a1 1 0 00-1.414 0l-2 2a1 1 0 101.414 1.414L8 10.414l1.293 1.293a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
    </svg>
  ),
  child: (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
      <path d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v1h8v-1zM6 8a2 2 0 11-4 0 2 2 0 014 0zM16 18v-1a5.972 5.972 0 00-.75-2.906A3.005 3.005 0 0119 15v1h-3zM4.75 14.094A5.973 5.973 0 004 17v1H1v-1a3 3 0 013.75-2.906z" />
    </svg>
  ),
  assistant: (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
      <path fillRule="evenodd" d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7zM7 9H5v2h2V9zm8 0h-2v2h2V9zM9 9h2v2H9V9z" clipRule="evenodd" />
    </svg>
  ),
  knowledge: (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
      <path d="M9 4.804A7.968 7.968 0 005.5 4c-1.255 0-2.443.29-3.5.804v10A7.969 7.969 0 015.5 14c1.669 0 3.218.51 4.5 1.385A7.962 7.962 0 0114.5 14c1.255 0 2.443.29 3.5.804v-10A7.968 7.968 0 0014.5 4c-1.255 0-2.443.29-3.5.804V12a1 1 0 11-2 0V4.804z" />
    </svg>
  ),
  guide: (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-3a1 1 0 00-.867.5 1 1 0 11-1.731-1A3 3 0 0113 8a3.001 3.001 0 01-2 2.83V11a1 1 0 11-2 0v-1a1 1 0 011-1 1 1 0 100-2zm0 8a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
    </svg>
  ),
  settings: (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
      <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
    </svg>
  ),
  admin: (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
      <path fillRule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
    </svg>
  ),
  lock: (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
      <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
    </svg>
  ),
}

const items = [
  { to: '/', label: 'Trang chủ', icon: Icons.home, end: true },
  { to: '/screening', label: 'Sàng lọc ASD', icon: Icons.screening },
  { to: '/history', label: 'Lịch sử kết quả', icon: Icons.history },
  { to: '/children', label: 'Hồ sơ của trẻ', icon: Icons.child },
  { to: '/assistant', label: 'Trợ lý AI', icon: Icons.assistant },
  { to: '/knowledge', label: 'Kiến thức ASD', icon: Icons.knowledge },
  { to: '/guide', label: 'Hướng dẫn sử dụng', icon: Icons.guide },
  { to: '/settings', label: 'Cài đặt', icon: Icons.settings },
]

export function Sidebar() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const navItems =
    user?.role === 'ADMIN' ? [...items, { to: '/admin', label: 'Admin', icon: Icons.admin }] : items

  return (
    <aside className="hidden md:flex w-60 flex-shrink-0 flex-col gap-4">
      {/* Logo */}
      <div
        className="flex items-center gap-3 px-4 py-4 cursor-pointer"
        onClick={() => navigate('/')}
      >
        <div
          className="flex h-10 w-10 items-center justify-center rounded-xl text-white text-lg font-bold shadow-md"
          style={{ background: 'linear-gradient(135deg, #6C63FF 0%, #4FC3F7 100%)' }}
        >
          🧩
        </div>
        <div>
          <div className="text-base font-bold text-slate-900">ASDr</div>
          <div className="text-[11px] text-slate-500">AI for ASD Screening</div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex flex-col gap-1 px-2">
        {navItems.map((it) => (
          <NavLink
            key={it.to}
            to={it.to}
            end={it.end}
            className={({ isActive }) =>
              [
                'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all',
                isActive
                  ? 'text-white shadow-md'
                  : 'text-slate-600 hover:bg-white hover:text-[#6C63FF] hover:shadow-sm',
              ].join(' ')
            }
            style={({ isActive }) =>
              isActive
                ? { background: 'linear-gradient(135deg, #6C63FF 0%, #818CF8 100%)' }
                : {}
            }
          >
            <span className="opacity-90">{it.icon}</span>
            {it.label}
          </NavLink>
        ))}
      </nav>

      {/* Bottom illustration card */}
      <div
        className="mx-2 mt-auto rounded-2xl p-4 text-white shadow-card"
        style={{ background: 'linear-gradient(135deg, #7C3AED 0%, #6C63FF 60%, #4FC3F7 100%)' }}
      >
        <div className="text-[22px] mb-1">👨‍👩‍👧</div>
        <div className="text-sm font-bold leading-snug">Cùng đồng hành với con mỗi ngày</div>
        <div className="mt-1.5 text-xs leading-relaxed opacity-85">
          ASDr hỗ trợ phát hiện sớm các dấu hiệu ASD thông qua phân tích hành vi bằng AI khoa học và bảo mật.
        </div>
        <button
          onClick={() => navigate('/guide')}
          className="mt-3 inline-flex items-center gap-1 rounded-lg bg-white/20 px-3 py-1.5 text-xs font-semibold hover:bg-white/30 transition"
        >
          Tìm hiểu thêm →
        </button>
      </div>

      {/* Privacy note */}
      <div className="mx-2 mb-2 flex items-center gap-2 rounded-xl bg-white px-3 py-2.5 shadow-card ring-1 ring-slate-100">
        <span className="text-[#6C63FF]">{Icons.lock}</span>
        <div>
          <div className="text-xs font-semibold text-slate-800">Bảo mật & Quyền riêng tư</div>
          <div className="text-[10px] text-slate-500 leading-snug mt-0.5">
            Video và dữ liệu của bạn được mã hóa và bảo vệ tuyệt đối.
          </div>
        </div>
      </div>
    </aside>
  )
}
