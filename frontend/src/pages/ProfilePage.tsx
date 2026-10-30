import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { DashboardLayout } from '../layouts/DashboardLayout'
import { useAuth } from '../state/auth'
import { api, apiErrorMessage } from '../lib/api'
import type { ChildProfile } from '../lib/types'
import {
  User as UserIcon,
  Mail,
  Shield,
  KeyRound,
  Calendar,
  Baby,
  Video,
  Activity,
  MessageSquareHeart,
  CheckCircle2,
  AlertCircle,
  Eye,
  EyeOff,
  Save,
  LogOut,
  ChevronRight,
  Sparkles,
  Heart,
  Lock,
} from 'lucide-react'

interface UserStats {
  childrenCount: number
  screeningsCount: number
  exercisesCount: number
  postsCount: number
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/)
  const a = parts[0]?.[0] ?? 'U'
  const b = parts.length > 1 ? (parts[parts.length - 1][0] ?? '') : ''
  return (a + b).toUpperCase()
}

export function ProfilePage() {
  const { user, logout, updateUser } = useAuth()
  const navigate = useNavigate()

  // Tabs
  const [activeTab, setActiveTab] = useState<'info' | 'security' | 'children' | 'privacy'>('info')

  // Edit profile state
  const [name, setName] = useState(user?.name ?? '')
  const [savingProfile, setSavingProfile] = useState(false)
  const [profileSuccess, setProfileSuccess] = useState<string | null>(null)
  const [profileError, setProfileError] = useState<string | null>(null)

  // Password state
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showCurrent, setShowCurrent] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [savingPassword, setSavingPassword] = useState(false)
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null)
  const [passwordError, setPasswordError] = useState<string | null>(null)

  // Stats and children
  const [stats, setStats] = useState<UserStats>({
    childrenCount: 0,
    screeningsCount: 0,
    exercisesCount: 0,
    postsCount: 0,
  })
  const [children, setChildren] = useState<ChildProfile[]>([])
  const [loadingData, setLoadingData] = useState(true)

  // Sync user name if auth changes
  useEffect(() => {
    if (user?.name) setName(user.name)
  }, [user?.name])

  // Fetch stats & children
  useEffect(() => {
    let cancelled = false
    async function loadData() {
      setLoadingData(true)
      try {
        const [statsRes, childrenRes] = await Promise.allSettled([
          api.get('/auth/stats'),
          api.get('/children'),
        ])

        if (!cancelled) {
          if (statsRes.status === 'fulfilled' && statsRes.value.data?.stats) {
            setStats(statsRes.value.data.stats)
          }
          if (childrenRes.status === 'fulfilled' && childrenRes.value.data?.children) {
            setChildren(childrenRes.value.data.children)
          }
        }
      } finally {
        if (!cancelled) setLoadingData(false)
      }
    }
    loadData()
    return () => {
      cancelled = true
    }
  }, [])

  // Handle name update
  async function handleUpdateProfile(e: React.FormEvent) {
    e.preventDefault()
    setProfileError(null)
    setProfileSuccess(null)

    if (!name.trim()) {
      setProfileError('Họ và tên không được để trống.')
      return
    }

    setSavingProfile(true)
    try {
      const res = await api.patch('/auth/profile', { name: name.trim() })
      if (res.data?.user) {
        updateUser(res.data.user)
      }
      setProfileSuccess('Cập nhật thông tin tài khoản thành công!')
      setTimeout(() => setProfileSuccess(null), 4000)
    } catch (err) {
      setProfileError(apiErrorMessage(err, 'Không thể cập nhật thông tin. Vui lòng thử lại.'))
    } finally {
      setSavingProfile(false)
    }
  }

  // Handle password change
  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault()
    setPasswordError(null)
    setPasswordSuccess(null)

    if (!currentPassword) {
      setPasswordError('Vui lòng nhập mật khẩu hiện tại.')
      return
    }
    if (newPassword.length < 6) {
      setPasswordError('Mật khẩu mới phải có tối thiểu 6 ký tự.')
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('Mật khẩu xác nhận không khớp.')
      return
    }

    setSavingPassword(true)
    try {
      await api.post('/auth/change-password', { currentPassword, newPassword })
      setPasswordSuccess('Đổi mật khẩu thành công! Bạn có thể sử dụng mật khẩu mới trong lần đăng nhập tiếp theo.')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setTimeout(() => setPasswordSuccess(null), 5000)
    } catch (err) {
      setPasswordError(apiErrorMessage(err, 'Mật khẩu hiện tại không đúng hoặc đã xảy ra lỗi.'))
    } finally {
      setSavingPassword(false)
    }
  }

  const joinDateFormatted = user?.createdAt
    ? new Date(user.createdAt).toLocaleDateString('vi-VN', { month: 'long', year: 'numeric' })
    : 'Thành viên AIMBRACE'

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-4xl space-y-6">
        {/* Page Header */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-black tracking-tight text-duo-ink">Hồ sơ tài khoản</h1>
            <p className="mt-1 text-sm font-semibold text-duo-mute">
              Quản lý thông tin cá nhân, bảo mật và dữ liệu hoạt động của bạn trên AIMBRACE
            </p>
          </div>
          <button
            type="button"
            onClick={() => logout()}
            className="flex items-center gap-2 rounded-2xl border-2 border-red-200 bg-red-50/70 px-4 py-2.5 text-sm font-extrabold text-duo-red transition-all hover:bg-red-100"
          >
            <LogOut className="h-4 w-4 stroke-[2.5]" />
            <span>Đăng xuất</span>
          </button>
        </div>

        {/* Top Profile Summary Card */}
        <div className="overflow-hidden rounded-3xl bg-white p-6 shadow-card-duo md:p-8">
          <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-5">
              <div className="relative">
                <div className="grid h-20 w-20 place-items-center rounded-3xl bg-duo-gold text-2xl font-black text-duo-ink shadow-md md:h-24 md:w-24 md:text-3xl">
                  {user ? initials(user.name) : 'U'}
                </div>
                <div className="absolute -bottom-1 -right-1 grid h-7 w-7 place-items-center rounded-full bg-white shadow-sm ring-2 ring-white">
                  {user?.role === 'ADMIN' ? (
                    <Shield className="h-4 w-4 text-duo-green-dark" />
                  ) : (
                    <Heart className="h-4 w-4 text-duo-green-dark" />
                  )}
                </div>
              </div>

              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2.5">
                  <h2 className="truncate text-2xl font-black text-duo-ink md:text-3xl">{user?.name}</h2>
                  <span
                    className={[
                      'inline-flex items-center gap-1 rounded-full px-3 py-0.5 text-xs font-black uppercase tracking-wider',
                      user?.role === 'ADMIN'
                        ? 'bg-purple-100 text-purple-800'
                        : 'bg-duo-green-soft text-duo-green-dark',
                    ].join(' ')}
                  >
                    {user?.role === 'ADMIN' ? 'Quản trị viên' : 'Phụ huynh'}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-sm font-semibold text-duo-mute">
                  <Mail className="h-4 w-4 flex-shrink-0" />
                  <span className="truncate">{user?.email}</span>
                </div>
                <div className="flex items-center gap-1.5 text-xs font-bold text-duo-mute">
                  <Calendar className="h-3.5 w-3.5 flex-shrink-0" />
                  <span>Tham gia từ {joinDateFormatted}</span>
                </div>
              </div>
            </div>

            {/* Quick Action Badges */}
            <div className="grid grid-cols-2 gap-3 border-t border-duo-mist pt-4 md:border-l md:border-t-0 md:pl-8 md:pt-0">
              <Link
                to="/children"
                className="group flex flex-col rounded-2xl bg-duo-mist/60 p-3.5 transition-all hover:bg-duo-green-soft"
              >
                <div className="flex items-center justify-between text-xs font-bold text-duo-mute group-hover:text-duo-green-dark">
                  <span>Hồ sơ trẻ</span>
                  <Baby className="h-4 w-4 text-duo-green" />
                </div>
                <span className="mt-1 text-2xl font-black text-duo-ink group-hover:text-duo-green-dark">
                  {stats.childrenCount}
                </span>
              </Link>

              <Link
                to="/history"
                className="group flex flex-col rounded-2xl bg-duo-mist/60 p-3.5 transition-all hover:bg-duo-green-soft"
              >
                <div className="flex items-center justify-between text-xs font-bold text-duo-mute group-hover:text-duo-green-dark">
                  <span>Sàng lọc video</span>
                  <Video className="h-4 w-4 text-duo-blue" />
                </div>
                <span className="mt-1 text-2xl font-black text-duo-ink group-hover:text-duo-green-dark">
                  {stats.screeningsCount}
                </span>
              </Link>

              <Link
                to="/exercises"
                className="group flex flex-col rounded-2xl bg-duo-mist/60 p-3.5 transition-all hover:bg-duo-green-soft"
              >
                <div className="flex items-center justify-between text-xs font-bold text-duo-mute group-hover:text-duo-green-dark">
                  <span>Bài tập can thiệp</span>
                  <Activity className="h-4 w-4 text-duo-gold" />
                </div>
                <span className="mt-1 text-2xl font-black text-duo-ink group-hover:text-duo-green-dark">
                  {stats.exercisesCount}
                </span>
              </Link>

              <Link
                to="/community"
                className="group flex flex-col rounded-2xl bg-duo-mist/60 p-3.5 transition-all hover:bg-duo-green-soft"
              >
                <div className="flex items-center justify-between text-xs font-bold text-duo-mute group-hover:text-duo-green-dark">
                  <span>Bài cộng đồng</span>
                  <MessageSquareHeart className="h-4 w-4 text-pink-500" />
                </div>
                <span className="mt-1 text-2xl font-black text-duo-ink group-hover:text-duo-green-dark">
                  {stats.postsCount}
                </span>
              </Link>
            </div>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex overflow-x-auto border-b border-duo-mist [scrollbar-width:none]">
          <div className="flex gap-2 pb-1">
            <button
              type="button"
              onClick={() => setActiveTab('info')}
              className={[
                'flex items-center gap-2 rounded-2xl px-5 py-3 text-sm font-extrabold transition-all',
                activeTab === 'info'
                  ? 'bg-duo-green text-white shadow-brand'
                  : 'text-duo-mute hover:bg-duo-mist hover:text-duo-ink',
              ].join(' ')}
            >
              <UserIcon className="h-4 w-4 stroke-[2.5]" />
              <span>Thông tin cá nhân</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('security')}
              className={[
                'flex items-center gap-2 rounded-2xl px-5 py-3 text-sm font-extrabold transition-all',
                activeTab === 'security'
                  ? 'bg-duo-green text-white shadow-brand'
                  : 'text-duo-mute hover:bg-duo-mist hover:text-duo-ink',
              ].join(' ')}
            >
              <KeyRound className="h-4 w-4 stroke-[2.5]" />
              <span>Bảo mật & Mật khẩu</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('children')}
              className={[
                'flex items-center gap-2 rounded-2xl px-5 py-3 text-sm font-extrabold transition-all',
                activeTab === 'children'
                  ? 'bg-duo-green text-white shadow-brand'
                  : 'text-duo-mute hover:bg-duo-mist hover:text-duo-ink',
              ].join(' ')}
            >
              <Baby className="h-4 w-4 stroke-[2.5]" />
              <span>Hồ sơ trẻ ({stats.childrenCount})</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('privacy')}
              className={[
                'flex items-center gap-2 rounded-2xl px-5 py-3 text-sm font-extrabold transition-all',
                activeTab === 'privacy'
                  ? 'bg-duo-green text-white shadow-brand'
                  : 'text-duo-mute hover:bg-duo-mist hover:text-duo-ink',
              ].join(' ')}
            >
              <Shield className="h-4 w-4 stroke-[2.5]" />
              <span>Quyền riêng tư & Dữ liệu</span>
            </button>
          </div>
        </div>

        {/* Tab 1: Profile Details */}
        {activeTab === 'info' && (
          <div className="rounded-3xl bg-white p-6 shadow-card-duo md:p-8">
            <div className="mb-6">
              <h3 className="text-xl font-black text-duo-ink">Thông tin cơ bản</h3>
              <p className="mt-1 text-sm font-semibold text-duo-mute">
                Tên hiển thị của bạn sẽ xuất hiện trên thanh điều hướng và khi chia sẻ trên cộng đồng AIMBRACE.
              </p>
            </div>

            {profileSuccess && (
              <div className="mb-6 flex items-center gap-3 rounded-2xl bg-green-50 p-4 text-sm font-extrabold text-green-800">
                <CheckCircle2 className="h-5 w-5 flex-shrink-0 text-green-600" />
                <span>{profileSuccess}</span>
              </div>
            )}

            {profileError && (
              <div className="mb-6 flex items-center gap-3 rounded-2xl bg-red-50 p-4 text-sm font-extrabold text-duo-red">
                <AlertCircle className="h-5 w-5 flex-shrink-0 text-duo-red" />
                <span>{profileError}</span>
              </div>
            )}

            <form onSubmit={handleUpdateProfile} className="max-w-xl space-y-5">
              <div>
                <label className="mb-1.5 block text-xs font-black uppercase tracking-wider text-duo-mute">
                  Họ và tên
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="input-duo text-base font-bold"
                  placeholder="Nhập họ và tên của bạn"
                  required
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-black uppercase tracking-wider text-duo-mute">
                  Địa chỉ Email
                </label>
                <div className="relative">
                  <input
                    type="email"
                    value={user?.email ?? ''}
                    disabled
                    className="input-duo bg-duo-mist/40 text-base font-bold text-duo-mute cursor-not-allowed"
                  />
                  <div className="absolute right-3.5 top-1/2 -translate-y-1/2">
                    <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-black text-green-800">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Đã xác thực
                    </span>
                  </div>
                </div>
                <p className="mt-1.5 text-xs font-semibold text-duo-mute">
                  Email được dùng làm tài khoản đăng nhập chính thức. Nếu cần thay đổi email, vui lòng liên hệ ban quản trị.
                </p>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-black uppercase tracking-wider text-duo-mute">
                  Vai trò trên hệ thống
                </label>
                <div className="flex items-center gap-3 rounded-2xl bg-duo-mist/40 p-4">
                  <div className="grid h-10 w-10 place-items-center rounded-xl bg-white shadow-sm">
                    {user?.role === 'ADMIN' ? (
                      <Shield className="h-5 w-5 text-purple-600" />
                    ) : (
                      <Heart className="h-5 w-5 text-duo-green" />
                    )}
                  </div>
                  <div>
                    <div className="font-extrabold text-duo-ink">
                      {user?.role === 'ADMIN' ? 'Tài khoản Quản trị viên (Admin)' : 'Tài khoản Phụ huynh (Parent)'}
                    </div>
                    <div className="text-xs font-semibold text-duo-mute">
                      {user?.role === 'ADMIN'
                        ? 'Có quyền quản lý bài tập, xem khung xương ML và quản trị nội dung cộng đồng.'
                        : 'Có quyền tạo hồ sơ con, tải video sàng lọc dáng đi, làm bảng hỏi và tham gia thảo luận cộng đồng.'}
                    </div>
                  </div>
                </div>
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={savingProfile || name === user?.name}
                  className="btn-duo flex items-center gap-2"
                >
                  <Save className="h-4 w-4 stroke-[2.5]" />
                  <span>{savingProfile ? 'Đang lưu thay đổi...' : 'Lưu thông tin'}</span>
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Tab 2: Security & Password */}
        {activeTab === 'security' && (
          <div className="rounded-3xl bg-white p-6 shadow-card-duo md:p-8">
            <div className="mb-6">
              <h3 className="text-xl font-black text-duo-ink">Đổi mật khẩu</h3>
              <p className="mt-1 text-sm font-semibold text-duo-mute">
                Để bảo vệ an toàn cho dữ liệu sức khỏe của con, hãy sử dụng mật khẩu mạnh và không chia sẻ tài khoản.
              </p>
            </div>

            {passwordSuccess && (
              <div className="mb-6 flex items-center gap-3 rounded-2xl bg-green-50 p-4 text-sm font-extrabold text-green-800">
                <CheckCircle2 className="h-5 w-5 flex-shrink-0 text-green-600" />
                <span>{passwordSuccess}</span>
              </div>
            )}

            {passwordError && (
              <div className="mb-6 flex items-center gap-3 rounded-2xl bg-red-50 p-4 text-sm font-extrabold text-duo-red">
                <AlertCircle className="h-5 w-5 flex-shrink-0 text-duo-red" />
                <span>{passwordError}</span>
              </div>
            )}

            <form onSubmit={handleChangePassword} className="max-w-xl space-y-5">
              <div>
                <label className="mb-1.5 block text-xs font-black uppercase tracking-wider text-duo-mute">
                  Mật khẩu hiện tại
                </label>
                <div className="relative">
                  <input
                    type={showCurrent ? 'text' : 'password'}
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    className="input-duo pr-11 font-bold"
                    placeholder="Nhập mật khẩu hiện tại"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrent(!showCurrent)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1 text-duo-mute hover:text-duo-ink"
                  >
                    {showCurrent ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-black uppercase tracking-wider text-duo-mute">
                  Mật khẩu mới
                </label>
                <div className="relative">
                  <input
                    type={showNew ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="input-duo pr-11 font-bold"
                    placeholder="Mật khẩu mới (tối thiểu 6 ký tự)"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowNew(!showNew)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1 text-duo-mute hover:text-duo-ink"
                  >
                    {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-black uppercase tracking-wider text-duo-mute">
                  Xác nhận mật khẩu mới
                </label>
                <div className="relative">
                  <input
                    type={showConfirm ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="input-duo pr-11 font-bold"
                    placeholder="Nhập lại mật khẩu mới"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirm(!showConfirm)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1 text-duo-mute hover:text-duo-ink"
                  >
                    {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="rounded-2xl bg-duo-mist/50 p-4 text-xs font-semibold leading-relaxed text-duo-mute">
                <div className="font-extrabold text-duo-ink mb-1 flex items-center gap-1.5">
                  <Lock className="h-3.5 w-3.5 text-duo-green-dark" />
                  Gợi ý tạo mật khẩu an toàn:
                </div>
                • Tối thiểu 6 ký tự trở lên (khuyên dùng 8–16 ký tự).<br />
                • Kết hợp chữ hoa, chữ thường và chữ số.<br />
                • Tránh sử dụng ngày sinh của trẻ hoặc số điện thoại dễ đoán.
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={savingPassword || !currentPassword || !newPassword || !confirmPassword}
                  className="btn-duo flex items-center gap-2"
                >
                  <KeyRound className="h-4 w-4 stroke-[2.5]" />
                  <span>{savingPassword ? 'Đang cập nhật mật khẩu...' : 'Cập nhật mật khẩu'}</span>
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Tab 3: Children Profiles */}
        {activeTab === 'children' && (
          <div className="rounded-3xl bg-white p-6 shadow-card-duo md:p-8">
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-xl font-black text-duo-ink">Hồ sơ trẻ đang quản lý</h3>
                <p className="mt-1 text-sm font-semibold text-duo-mute">
                  Danh sách hồ sơ trẻ liên kết với tài khoản phụ huynh này.
                </p>
              </div>
              <Link to="/children" className="btn-duo flex items-center gap-2 text-sm">
                <Baby className="h-4 w-4" />
                <span>Quản lý hồ sơ trẻ</span>
              </Link>
            </div>

            {loadingData ? (
              <div className="py-8 text-center text-sm font-bold text-duo-mute">Đang tải danh sách hồ sơ trẻ...</div>
            ) : children.length === 0 ? (
              <div className="rounded-2xl border-2 border-dashed border-duo-mist p-8 text-center">
                <Baby className="mx-auto h-12 w-12 text-duo-mute/60" />
                <h4 className="mt-3 text-lg font-black text-duo-ink">Chưa có hồ sơ trẻ nào</h4>
                <p className="mt-1 text-sm font-semibold text-duo-mute">
                  Tạo hồ sơ cho bé để bắt đầu theo dõi quá trình sàng lọc dáng đi và làm các bảng hỏi phát triển.
                </p>
                <Link to="/children" className="btn-duo mt-4 inline-flex items-center gap-2">
                  <span>+ Tạo hồ sơ trẻ đầu tiên</span>
                </Link>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {children.map((c) => {
                  const birthDate = new Date(c.dateOfBirth)
                  const ageMonths = Math.floor((Date.now() - birthDate.getTime()) / (1000 * 60 * 60 * 24 * 30.4375))
                  const ageYears = Math.floor(ageMonths / 12)
                  const remMonths = ageMonths % 12
                  const ageStr =
                    ageYears > 0
                      ? `${ageYears} tuổi${remMonths > 0 ? ` ${remMonths} tháng` : ''}`
                      : `${ageMonths} tháng tuổi`

                  return (
                    <div
                      key={c.id}
                      className="group flex items-center justify-between rounded-2xl border-2 border-duo-mist p-4 transition-all hover:border-duo-green hover:shadow-card-duo"
                    >
                      <div className="flex items-center gap-3.5 min-w-0">
                        <div className="grid h-12 w-12 flex-shrink-0 place-items-center rounded-2xl bg-duo-green-soft text-lg font-black text-duo-green-dark">
                          {c.fullName.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <h4 className="truncate font-extrabold text-duo-ink group-hover:text-duo-green-dark">
                            {c.fullName}
                          </h4>
                          <div className="text-xs font-bold text-duo-mute">
                            {ageStr} • Sinh ngày {birthDate.toLocaleDateString('vi-VN')}
                          </div>
                          {c.gender && (
                            <span className="mt-1 inline-block text-[11px] font-bold text-duo-mute">
                              Giới tính: {c.gender === 'MALE' ? 'Nam' : c.gender === 'FEMALE' ? 'Nữ' : 'Khác'}
                            </span>
                          )}
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => navigate(`/children/${c.id}`)}
                        className="rounded-xl p-2 text-duo-mute transition-colors hover:bg-duo-mist hover:text-duo-ink"
                        title="Xem chi tiết"
                      >
                        <ChevronRight className="h-5 w-5" />
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* Tab 4: Privacy & Data */}
        {activeTab === 'privacy' && (
          <div className="rounded-3xl bg-white p-6 shadow-card-duo md:p-8 space-y-6">
            <div>
              <h3 className="text-xl font-black text-duo-ink">Quyền riêng tư & Bảo vệ dữ liệu trẻ em</h3>
              <p className="mt-1 text-sm font-semibold text-duo-mute">
                AIMBRACE cam kết tuân thủ nghiêm ngặt các nguyên tắc bảo vệ quyền riêng tư và dữ liệu nhạy cảm.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="rounded-2xl bg-duo-mist/40 p-5 space-y-2">
                <div className="flex items-center gap-2 font-black text-duo-ink">
                  <Shield className="h-5 w-5 text-duo-green" />
                  <span>Xác nhận đồng ý của phụ huynh</span>
                </div>
                <p className="text-xs font-semibold leading-relaxed text-duo-mute">
                  Video của trẻ chỉ được xử lý khi có sự đồng ý tường minh của phụ huynh qua form xác nhận điện tử. Bạn có quyền thu hồi sự đồng ý bất kỳ lúc nào tại mục tải video.
                </p>
              </div>

              <div className="rounded-2xl bg-duo-mist/40 p-5 space-y-2">
                <div className="flex items-center gap-2 font-black text-duo-ink">
                  <Video className="h-5 w-5 text-duo-blue" />
                  <span>Xử lý khung xương (Skeleton-only)</span>
                </div>
                <p className="text-xs font-semibold leading-relaxed text-duo-mute">
                  Hệ thống trích xuất tọa độ khớp xương (pose landmarks) để phân tích dáng đi. Video gốc không bao giờ được chia sẻ công khai hay dùng cho mục đích thương mại.
                </p>
              </div>

              <div className="rounded-2xl bg-duo-mist/40 p-5 space-y-2">
                <div className="flex items-center gap-2 font-black text-duo-ink">
                  <MessageSquareHeart className="h-5 w-5 text-pink-500" />
                  <span>Chế độ ẩn danh trên Cộng đồng</span>
                </div>
                <p className="text-xs font-semibold leading-relaxed text-duo-mute">
                  Khi chia sẻ tâm sự hoặc kinh nghiệm nuôi dạy trẻ trên diễn đàn AIMBRACE, bạn có thể chọn chế độ "Đăng bài ẩn danh" để bảo vệ hoàn toàn danh tính của bản thân và con.
                </p>
              </div>

              <div className="rounded-2xl bg-duo-mist/40 p-5 space-y-2">
                <div className="flex items-center gap-2 font-black text-duo-ink">
                  <Sparkles className="h-5 w-5 text-duo-gold" />
                  <span>Lưu ý y khoa quan trọng</span>
                </div>
                <p className="text-xs font-semibold leading-relaxed text-duo-mute">
                  Tất cả các kết quả phân tích dáng đi và điểm số bảng hỏi trên AIMBRACE đều mang tính chất sàng lọc tham khảo, không thay thế chẩn đoán lâm sàng của bác sĩ chuyên khoa nhi.
                </p>
              </div>
            </div>

            <div className="border-t border-duo-mist pt-5 flex items-center justify-between">
              <div>
                <div className="font-black text-duo-ink">Phiên đăng nhập hiện tại</div>
                <div className="text-xs font-semibold text-duo-mute">
                  Đang hoạt động trên thiết bị này với tài khoản {user?.email}
                </div>
              </div>
              <button
                type="button"
                onClick={() => logout()}
                className="btn-duo-ghost text-sm text-duo-red hover:bg-red-50 hover:text-duo-red"
              >
                Đăng xuất phiên làm việc
              </button>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  )
}
