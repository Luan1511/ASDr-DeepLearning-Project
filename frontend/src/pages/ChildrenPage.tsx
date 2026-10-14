import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ChevronRight, ShieldAlert, ShieldCheck, UserPlus } from 'lucide-react'
import { DashboardLayout } from '../layouts/DashboardLayout'
import { ChildAvatar } from '../components/ChildAvatar'
import { ChildForm, type ChildFormValues } from '../components/ChildForm'
import { RiskPill } from '../components/RiskPill'
import { api } from '../lib/api'
import { childApiErrorMessage } from '../lib/children'
import { GENDER_LABEL, formatAge, formatDate } from '../lib/format'
import type { ChildProfile } from '../lib/types'

function ChildCard({ child }: { child: ChildProfile }) {
  const s = child.summary
  return (
    <Link to={`/children/${child.id}`} className="card-duo-interactive block p-5">
      <div className="flex items-center gap-3">
        <ChildAvatar name={child.fullName} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-black text-duo-ink">{child.fullName}</div>
          <div className="text-xs font-bold text-duo-mute">
            {formatAge(child.dateOfBirth)}
            {child.gender !== 'UNSPECIFIED' && ` • ${GENDER_LABEL[child.gender]}`}
          </div>
        </div>
        <ChevronRight className="h-5 w-5 flex-shrink-0 text-duo-mute" />
      </div>

      <div className="mt-4 space-y-2 text-xs font-bold text-duo-mute">
        <div className="flex items-center justify-between gap-2">
          <span>
            {s?.screeningCount ? `${s.screeningCount} lần sàng lọc` : 'Chưa sàng lọc lần nào'}
            {s?.lastScreeningAt && ` • gần nhất ${formatDate(s.lastScreeningAt)}`}
          </span>
          {s?.lastResult && <RiskPill risk={s.lastResult.riskLevel} />}
        </div>
        {s && (
          <div className={['flex items-center gap-1.5', s.hasActiveConsent ? 'text-duo-green-dark' : 'text-yellow-800'].join(' ')}>
            {s.hasActiveConsent ? <ShieldCheck className="h-4 w-4" /> : <ShieldAlert className="h-4 w-4" />}
            {s.hasActiveConsent ? 'Đã có đồng ý xử lý video' : 'Chưa có đồng ý xử lý video'}
          </div>
        )}
      </div>
    </Link>
  )
}

export function ChildrenPage() {
  const navigate = useNavigate()
  const location = useLocation()
  // Shown once after a deletion; cleared from history so Back/refresh do not repeat it.
  const [deletedName] = useState(() => (location.state as { deletedName?: string } | null)?.deletedName)
  useEffect(() => {
    if (location.state) navigate(location.pathname, { replace: true, state: null })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [children, setChildren] = useState<ChildProfile[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    api
      .get('/children')
      .then((res) => setChildren(res.data.children))
      .catch((e) => {
        setLoadError(childApiErrorMessage(e, 'Không tải được danh sách hồ sơ trẻ.'))
        setChildren([])
      })
  }, [])

  async function create(values: ChildFormValues) {
    setSaving(true)
    setFormError(null)
    try {
      const res = await api.post('/children', values)
      const created: ChildProfile = res.data.child
      navigate(`/children/${created.id}`)
    } catch (e) {
      setFormError(childApiErrorMessage(e, 'Không tạo được hồ sơ trẻ. Vui lòng thử lại.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-black text-duo-ink">Hồ sơ trẻ</h1>
            <p className="mt-1 text-sm font-semibold text-duo-mute">
              Theo dõi các lần sàng lọc và chỉ số dáng đi của từng trẻ theo thời gian.
            </p>
          </div>
          {!creating && (
            <button type="button" className="btn-duo" onClick={() => setCreating(true)}>
              <UserPlus className="h-4 w-4" />
              Thêm hồ sơ
            </button>
          )}
        </div>

        {deletedName && (
          <div className="rounded-2xl bg-duo-green-soft px-4 py-3 text-sm font-bold text-duo-green-dark">
            Đã xoá hồ sơ “{deletedName}” cùng toàn bộ dữ liệu sàng lọc của trẻ.
          </div>
        )}

        {creating && (
          <div className="card-duo p-5">
            <div className="mb-4 text-sm font-extrabold uppercase tracking-wide text-duo-ink">Hồ sơ mới</div>
            <ChildForm
              submitLabel="Tạo hồ sơ"
              submitting={saving}
              error={formError}
              onSubmit={create}
              onCancel={() => {
                setCreating(false)
                setFormError(null)
              }}
            />
          </div>
        )}

        {loadError && <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-bold text-duo-red">{loadError}</div>}

        {children === null && <div className="text-sm font-semibold text-duo-mute">Đang tải...</div>}

        {children && children.length === 0 && !loadError && !creating && (
          <div className="card-duo px-6 py-10 text-center">
            <div className="text-base font-black text-duo-ink">Chưa có hồ sơ trẻ nào</div>
            <p className="mx-auto mt-1 max-w-md text-sm font-semibold text-duo-mute">
              Tạo hồ sơ để bắt đầu sàng lọc và theo dõi sự thay đổi trong chuyển động của trẻ qua từng lần quay.
            </p>
            <button type="button" className="btn-duo mt-5" onClick={() => setCreating(true)}>
              <UserPlus className="h-4 w-4" />
              Thêm hồ sơ
            </button>
          </div>
        )}

        {children && children.length > 0 && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
            {children.map((child) => (
              <ChildCard key={child.id} child={child} />
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  )
}
