import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, Info, Loader2, Stethoscope } from 'lucide-react'
import { DashboardLayout } from '../layouts/DashboardLayout'
import { ChildAvatar } from '../components/ChildAvatar'
import {
  DOCTOR_VIEW_DISCLAIMER,
  SHARE_SCOPE_LABEL,
  doctorApiErrorMessage,
  doctorName,
  fetchDoctorMe,
  fetchPatients,
  type DoctorDto,
  type PatientSummaryDto,
} from '../lib/doctors'
import { GENDER_LABEL, formatAge, formatDate, formatDateTime } from '../lib/format'

/** Doctor side, home: the records parents are currently sharing with this doctor. */
export function DoctorHomePage() {
  const [doctor, setDoctor] = useState<DoctorDto | null>(null)
  const [patients, setPatients] = useState<PatientSummaryDto[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let stale = false
    Promise.all([fetchDoctorMe(), fetchPatients()]).then(
      ([me, list]) => {
        if (stale) return
        setDoctor(me.doctor)
        setPatients(list)
        setError(null)
      },
      (e: unknown) => !stale && setError(doctorApiErrorMessage(e, 'Không tải được danh sách hồ sơ được chia sẻ.')),
    )
    return () => {
      stale = true
    }
  }, [reloadKey])

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-3xl font-black text-duo-ink">Hồ sơ được chia sẻ</h1>
            <p className="mt-2 max-w-3xl text-base font-semibold text-duo-mute">
              Những hồ sơ trẻ mà phụ huynh đang chia sẻ với bạn. Bạn chỉ xem được các phần phụ huynh đã chọn; khi phụ huynh ngừng
              chia sẻ, hồ sơ sẽ rời khỏi danh sách này.
            </p>
          </div>
          {doctor && (
            <div className="rounded-2xl bg-[#DCE6FA] px-4 py-3 text-sm font-extrabold text-[#172B6B]">
              <div className="flex items-center gap-2">
                <Stethoscope className="h-4 w-4" />
                {doctorName(doctor)}
              </div>
              <div className="text-xs font-bold opacity-80">
                {doctor.specialty} • {doctor.workplace}
              </div>
            </div>
          )}
        </div>

        {doctor?.isMock && (
          <div className="flex items-start gap-2 rounded-2xl bg-yellow-50 px-4 py-3 text-sm font-bold leading-relaxed text-yellow-900">
            <Info className="mt-0.5 h-4 w-4 flex-shrink-0" />
            Bạn đang dùng một tài khoản bác sĩ mẫu để thử tính năng chia sẻ hồ sơ. Tài khoản này không đại diện cho một bác sĩ
            thật; không dùng để tư vấn y khoa.
          </div>
        )}

        {error && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-red-50 px-4 py-3 text-sm font-bold text-duo-red">
            <span>{error}</span>
            <button type="button" className="btn-duo-secondary !px-3 !py-2" onClick={() => setReloadKey((k) => k + 1)}>
              Thử lại
            </button>
          </div>
        )}

        {!patients && !error && (
          <div className="flex items-center gap-2 text-sm font-semibold text-duo-mute">
            <Loader2 className="h-4 w-4 animate-spin" />
            Đang tải...
          </div>
        )}

        {patients && patients.length === 0 && (
          <div className="rounded-2xl bg-duo-mist px-4 py-10 text-center">
            <div className="text-base font-black text-duo-ink">Chưa có hồ sơ nào được chia sẻ với bạn</div>
            <p className="mx-auto mt-2 max-w-xl text-sm font-semibold leading-relaxed text-duo-mute">
              Khi một phụ huynh chọn bạn trong mục “Kết nối bác sĩ” và đồng ý chia sẻ, hồ sơ của trẻ sẽ xuất hiện ở đây.
            </p>
          </div>
        )}

        {patients && patients.length > 0 && (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {patients.map((p) => (
              <Link key={p.linkId} to={`/doctor/patients/${p.linkId}`} className="card-duo-interactive flex flex-col gap-3 p-5">
                <div className="flex items-center gap-3">
                  <ChildAvatar name={p.child.fullName} size="lg" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-lg font-black text-duo-ink">{p.child.fullName}</div>
                    <div className="text-sm font-bold text-duo-mute">
                      {formatAge(p.child.dateOfBirth)} • {GENDER_LABEL[p.child.gender]}
                    </div>
                    <div className="text-xs font-bold text-duo-mute">Phụ huynh: {p.parent.name}</div>
                  </div>
                  <ChevronRight className="h-5 w-5 flex-shrink-0 text-duo-mute" />
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {p.scopes.map((scope) => (
                    <span key={scope} className="rounded-full bg-duo-mist px-2.5 py-1 text-[11px] font-extrabold text-duo-ink">
                      {SHARE_SCOPE_LABEL[scope]}
                    </span>
                  ))}
                </div>
                {p.message && <div className="rounded-2xl bg-duo-mist px-3 py-2 text-sm font-semibold text-duo-ink">“{p.message}”</div>}
                <div className="text-xs font-bold text-duo-mute">
                  Chia sẻ từ {formatDate(p.grantedAt)}
                  {p.lastViewedAt ? ` • bạn xem gần nhất lúc ${formatDateTime(p.lastViewedAt)}` : ' • chưa xem'}
                </div>
              </Link>
            ))}
          </div>
        )}

        <p className="text-xs font-semibold leading-relaxed text-duo-mute">{DOCTOR_VIEW_DISCLAIMER}</p>
      </div>
    </DashboardLayout>
  )
}
