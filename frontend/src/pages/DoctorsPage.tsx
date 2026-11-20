import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Check, Languages, Loader2, MapPin, Search, Stethoscope, UserPlus, X } from 'lucide-react'
import { DashboardLayout } from '../layouts/DashboardLayout'
import { ChildAvatar } from '../components/ChildAvatar'
import { api } from '../lib/api'
import { childApiErrorMessage } from '../lib/children'
import {
  DOCTOR_MESSAGE_MAX,
  SHARE_SCOPE_LABEL,
  createDoctorLink,
  doctorApiErrorMessage,
  doctorName,
  fetchDoctors,
  fetchShareStatement,
  type DoctorDirectory,
  type DoctorListItem,
  type DoctorShareScope,
  type DoctorShareStatement,
} from '../lib/doctors'
import type { ChildProfile } from '../lib/types'

/** Consent dialog: which child, which parts, the exact statement, then the grant. */
function ShareDialog({
  doctor,
  kids,
  initialChildId,
  statement,
  onClose,
  onShared,
}: {
  doctor: DoctorListItem
  kids: ChildProfile[]
  initialChildId: string | null
  statement: DoctorShareStatement
  onClose: () => void
  onShared: (childId: string) => void
}) {
  const [childId, setChildId] = useState(() => (kids.some((c) => c.id === initialChildId) ? initialChildId! : (kids[0]?.id ?? '')))
  const [scopes, setScopes] = useState<DoctorShareScope[]>(() => statement.scopes.map((s) => s.scope))
  const [message, setMessage] = useState('')
  const [durationDays, setDurationDays] = useState<30 | 90 | 180 | 0>(90)
  const [agreed, setAgreed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const child = kids.find((c) => c.id === childId) ?? null
  const alreadyShared = doctor.links.some((l) => l.childId === childId)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !saving && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, saving])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!child || !agreed) return
    setSaving(true)
    setError(null)
    try {
      await createDoctorLink(child.id, { doctorId: doctor.id, scopes, version: statement.version, durationDays, message: message.trim() || undefined })
      onShared(child.id)
    } catch (err) {
      setError(doctorApiErrorMessage(err, 'Chưa chia sẻ được hồ sơ. Vui lòng thử lại.'))
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-duo-ink/40 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={statement.title}>
      <form onSubmit={submit} className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-3xl bg-white p-6 shadow-card-hover sm:rounded-3xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-black text-duo-ink">{statement.title}</h2>
            <p className="mt-1 text-sm font-bold text-duo-mute">
              Với {doctorName(doctor)} — {doctor.specialty}
            </p>
          </div>
          <button type="button" className="rounded-xl p-2 text-duo-mute hover:bg-duo-mist" aria-label="Đóng" disabled={saving} onClick={onClose}>
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="mt-4 text-sm font-semibold leading-relaxed text-duo-ink">{statement.intro}</p>

        <div className="mt-4">
          <div className="mb-1 text-xs font-extrabold uppercase tracking-wide text-duo-mute">{kids.length > 1 ? 'Hồ sơ của con nào?' : 'Hồ sơ được chia sẻ'}</div>
          {/* One child per account: the picker only appears for older accounts that still have several. */}
          {kids.length === 1 && (
            <div className="flex items-center gap-3 rounded-2xl bg-duo-mist px-3 py-2.5">
              <ChildAvatar name={kids[0].fullName} />
              <span className="min-w-0 truncate text-sm font-black text-duo-ink">{kids[0].fullName}</span>
            </div>
          )}
          <div hidden={kids.length <= 1} className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Chọn hồ sơ trẻ">
            {kids.map((c) => (
              <button
                key={c.id}
                type="button"
                role="radio"
                aria-checked={childId === c.id}
                onClick={() => setChildId(c.id)}
                className={[
                  'flex items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-all',
                  childId === c.id ? 'bg-duo-green-soft shadow-ring-green' : 'bg-duo-mist hover:bg-duo-line/40',
                ].join(' ')}
              >
                <ChildAvatar name={c.fullName} />
                <span className="min-w-0 truncate text-sm font-black text-duo-ink">{c.fullName}</span>
              </button>
            ))}
          </div>
          {alreadyShared && (
            <p className="mt-2 text-xs font-bold text-duo-mute">
              Hồ sơ này đang được chia sẻ với bác sĩ. Xác nhận lại sẽ thay các phần đang chia sẻ bằng lựa chọn mới.
            </p>
          )}
        </div>

        <div className="mt-4">
          <div className="mb-1 text-xs font-extrabold uppercase tracking-wide text-duo-mute">Bác sĩ được xem</div>
          <div className="space-y-2">
            {statement.scopes.map((s) => (
              <label
                key={s.scope}
                className={['flex items-start gap-3 rounded-2xl bg-duo-mist px-4 py-3', s.required ? '' : 'cursor-pointer'].join(' ')}
              >
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 flex-shrink-0 accent-duo-green"
                  checked={scopes.includes(s.scope)}
                  disabled={s.required}
                  onChange={(e) => setScopes((list) => (e.target.checked ? [...list, s.scope] : list.filter((x) => x !== s.scope)))}
                />
                <span>
                  <span className="block text-sm font-extrabold text-duo-ink">
                    {s.label}
                    {s.required && <span className="ml-1.5 text-xs font-bold text-duo-mute">(bắt buộc)</span>}
                  </span>
                  <span className="block text-xs font-semibold leading-relaxed text-duo-mute">{s.detail}</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        <ul className="mt-4 list-disc space-y-1 pl-5 text-xs font-semibold leading-relaxed text-duo-ink">
          {statement.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>

        <div className="mt-4">
          <div className="mb-1 text-xs font-extrabold uppercase tracking-wide text-duo-mute">Lời nhắn cho bác sĩ (không bắt buộc)</div>
          <textarea
            className="input-duo min-h-[72px]"
            value={message}
            maxLength={DOCTOR_MESSAGE_MAX}
            placeholder="Ví dụ: Nhờ bác sĩ xem giúp kết quả sàng lọc tháng này của bé."
            onChange={(e) => setMessage(e.target.value)}
          />
          <label className="mt-4 block text-sm font-bold text-duo-ink" htmlFor="share-duration">Thời hạn chia sẻ</label>
          <select id="share-duration" value={durationDays} onChange={(e) => setDurationDays(Number(e.target.value) as 30 | 90 | 180 | 0)} className="input-duo mt-1">
            <option value={30}>30 ngày</option><option value={90}>90 ngày (mặc định)</option><option value={180}>180 ngày</option><option value={0}>Không thời hạn</option>
          </select>
        </div>

        <label className="mt-4 flex cursor-pointer items-start gap-2 text-sm font-bold text-duo-ink">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-duo-green" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
          <span>Tôi đã đọc các điều trên và đồng ý chia sẻ hồ sơ của {child?.fullName ?? 'trẻ'} với bác sĩ này.</span>
        </label>

        {error && <div className="mt-3 rounded-2xl bg-red-50 px-4 py-3 text-sm font-bold text-duo-red">{error}</div>}

        <div className="mt-5 flex flex-wrap gap-3">
          <button type="submit" className="btn-duo" disabled={!child || !agreed || saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            Chia sẻ hồ sơ
          </button>
          <button type="button" className="btn-duo-secondary" disabled={saving} onClick={onClose}>
            Huỷ
          </button>
        </div>
      </form>
    </div>
  )
}

function DoctorCard({
  doctor,
  kids,
  canShare,
  onShare,
}: {
  doctor: DoctorListItem
  kids: ChildProfile[]
  canShare: boolean
  onShare: () => void
}) {
  const sharedWith = doctor.links.map((l) => kids.find((c) => c.id === l.childId)).filter((c): c is ChildProfile => Boolean(c))
  return (
    <div className="card-duo flex flex-col gap-3 p-5">
      <div className="flex items-start gap-3">
        <div className="grid h-12 w-12 flex-shrink-0 place-items-center rounded-2xl bg-[#DCE6FA] text-[#172B6B]">
          <Stethoscope className="h-6 w-6" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-black text-duo-ink">{doctorName(doctor)}</h3>
            {!doctor.isMock && doctor.verified && <span className="rounded-full bg-duo-green-soft px-2 py-1 text-xs font-bold text-duo-green-dark">Đã xác minh</span>}
            {doctor.isMock && (
              <span className="rounded-full bg-yellow-50 px-2 py-0.5 text-[11px] font-extrabold text-yellow-900">Bác sĩ mẫu</span>
            )}
          </div>
          <div className="text-sm font-extrabold text-duo-green-dark">{doctor.specialty}</div>
        </div>
      </div>

      <p className="text-sm font-semibold leading-relaxed text-duo-ink">{doctor.bio}</p>

      <div className="space-y-1 text-xs font-bold text-duo-mute">
        <div className="flex items-center gap-1.5">
          <MapPin className="h-3.5 w-3.5 flex-shrink-0" />
          {doctor.workplace}, {doctor.city}
        </div>
        {doctor.languages.length > 0 && (
          <div className="flex items-center gap-1.5">
            <Languages className="h-3.5 w-3.5 flex-shrink-0" />
            {doctor.languages.join(', ')}
          </div>
        )}
      </div>

      {sharedWith.length > 0 && (
        <div className="rounded-2xl bg-duo-green-soft px-3 py-2 text-xs font-extrabold text-duo-green-dark">
          Đang xem hồ sơ của: {sharedWith.map((c) => c.fullName).join(', ')}
        </div>
      )}
      {doctor.links.map((link) => {
        const child = kids.find((kid) => kid.id === link.childId)
        return child ? <Link key={link.id} to={`/children/${child.id}`} className="rounded-xl border border-duo-line p-3 text-xs font-semibold text-duo-ink"><strong>{child.fullName}</strong> · {link.expiresAt ? `Hết hạn ${new Date(link.expiresAt).toLocaleDateString('vi-VN')}` : 'Không thời hạn'}<span className="mt-1 block text-duo-mute">{link.scopes?.map((scope) => SHARE_SCOPE_LABEL[scope]).join(' · ')} · Quản lý chia sẻ →</span></Link> : null
      })}

      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-1">
        <span className={['text-xs font-extrabold', doctor.acceptingNew ? 'text-duo-green-dark' : 'text-duo-mute'].join(' ')}>
          {doctor.acceptingNew ? 'Đang nhận hồ sơ mới' : 'Tạm ngừng nhận hồ sơ mới'}
        </span>
        <button type="button" className="btn-duo !px-4 !py-2.5" disabled={!canShare || (!doctor.acceptingNew && sharedWith.length === 0)} onClick={onShare}>
          <UserPlus className="h-4 w-4" />
          {sharedWith.length > 0 ? 'Chia sẻ thêm / đổi phần chia sẻ' : 'Chia sẻ hồ sơ'}
        </button>
      </div>
    </div>
  )
}

/** Parent side of Giai đoạn 7: find a doctor and share a child's record with them. */
export function DoctorsPage() {
  const [searchParams] = useSearchParams()
  const initialChildId = searchParams.get('childId')

  const [directory, setDirectory] = useState<DoctorDirectory | null>(null)
  const [statement, setStatement] = useState<DoctorShareStatement | null>(null)
  const [kids, setKids] = useState<ChildProfile[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [query, setQuery] = useState('')
  const [city, setCity] = useState('')
  const [specialty, setSpecialty] = useState('')
  const [sharing, setSharing] = useState<DoctorListItem | null>(null)
  const [sharedNotice, setSharedNotice] = useState<{ childId: string; doctor: string } | null>(null)

  useEffect(() => {
    let stale = false
    Promise.all([fetchDoctors(), fetchShareStatement()]).then(
      ([dir, text]) => {
        if (stale) return
        setDirectory(dir)
        setStatement(text)
        setLoadError(null)
      },
      (e: unknown) => !stale && setLoadError(doctorApiErrorMessage(e, 'Không tải được danh sách bác sĩ.')),
    )
    return () => {
      stale = true
    }
  }, [reloadKey])

  useEffect(() => {
    api.get('/children').then(
      (res) => setKids(res.data.children ?? []),
      (e: unknown) => {
        setKids([])
        setLoadError(childApiErrorMessage(e, 'Không tải được danh sách hồ sơ trẻ.'))
      },
    )
  }, [])

  // Filtering here keeps typing instant; the server offers the same filters for other clients.
  const visible = useMemo(() => {
    if (!directory) return []
    const fold = (text: string) =>
      text
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .replace(/[đĐ]/g, 'd')
        .toLowerCase()
    const typed = fold(query).split(/[^a-z0-9]+/).filter(Boolean)
    return directory.doctors.filter((d) => {
      if (city && d.city !== city) return false
      if (specialty && d.specialty !== specialty) return false
      const words = fold([d.title, d.displayName, d.specialty, d.workplace, d.city].join(' ')).split(/[^a-z0-9]+/)
      return typed.every((t) => words.some((w) => w.startsWith(t)))
    })
  }, [directory, query, city, specialty])

  const hasKids = (kids?.length ?? 0) > 0

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-black text-duo-ink">Kết nối bác sĩ</h1>
          <p className="mt-2 max-w-3xl text-base font-semibold text-duo-mute">
            Chọn một bác sĩ và chia sẻ hồ sơ của con để họ xem kết quả sàng lọc, bảng hỏi và tiến độ luyện tập. Bạn quyết định
            chia sẻ những phần nào và có thể ngừng bất cứ lúc nào.
          </p>
        </div>

        {sharedNotice && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-duo-green-soft px-4 py-3 text-sm font-bold text-duo-green-dark" role="status">
            <span>Đã chia sẻ hồ sơ với {sharedNotice.doctor}. Bác sĩ sẽ thấy hồ sơ trong danh sách của họ.</span>
            <Link to={`/children/${sharedNotice.childId}`} className="link-duo text-sm">
              Xem và quản lý ở hồ sơ của con
            </Link>
          </div>
        )}

        {loadError && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-red-50 px-4 py-3 text-sm font-bold text-duo-red">
            <span>{loadError}</span>
            <button type="button" className="btn-duo-secondary !px-3 !py-2" onClick={() => setReloadKey((k) => k + 1)}>
              Thử lại
            </button>
          </div>
        )}

        {kids !== null && !hasKids && (
          <div className="card-duo flex flex-wrap items-center justify-between gap-3 p-5">
            <p className="text-sm font-semibold text-duo-ink">Bạn cần tạo hồ sơ cho con trước khi chia sẻ với bác sĩ.</p>
            <Link to="/children" className="btn-duo">
              <UserPlus className="h-4 w-4" />
              Tạo hồ sơ trẻ
            </Link>
          </div>
        )}

        {directory && (
          <>
            <div className="card-duo grid grid-cols-1 gap-3 p-4 md:grid-cols-[1fr_200px_240px]">
              <label className="relative block">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-duo-mute" />
                <input
                  className="input-duo !pl-9"
                  value={query}
                  placeholder="Tìm theo tên, chuyên môn, nơi làm việc"
                  aria-label="Tìm bác sĩ"
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              <select className="input-duo" value={city} aria-label="Lọc theo tỉnh thành" onChange={(e) => setCity(e.target.value)}>
                <option value="">Mọi tỉnh thành</option>
                {directory.cities.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <select className="input-duo" value={specialty} aria-label="Lọc theo chuyên môn" onChange={(e) => setSpecialty(e.target.value)}>
                <option value="">Mọi chuyên môn</option>
                {directory.specialties.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            {directory.doctors.length === 0 ? (
              <div className="rounded-2xl bg-duo-mist px-4 py-8 text-center text-sm font-semibold text-duo-mute">
                Hiện chưa có bác sĩ nào trong danh sách.
              </div>
            ) : visible.length === 0 ? (
              <div className="rounded-2xl bg-duo-mist px-4 py-8 text-center text-sm font-semibold text-duo-mute">
                Không có bác sĩ nào khớp với tìm kiếm. Thử bỏ bớt điều kiện lọc.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {visible.map((doctor) => (
                  <DoctorCard
                    key={doctor.id}
                    doctor={doctor}
                    kids={kids ?? []}
                    canShare={hasKids && statement !== null}
                    onShare={() => {
                      setSharedNotice(null)
                      setSharing(doctor)
                    }}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {!directory && !loadError && (
          <div className="flex items-center gap-2 text-sm font-semibold text-duo-mute">
            <Loader2 className="h-4 w-4 animate-spin" />
            Đang tải danh sách bác sĩ...
          </div>
        )}
      </div>

      {sharing && statement && kids && (
        <ShareDialog
          doctor={sharing}
          kids={kids}
          initialChildId={initialChildId}
          statement={statement}
          onClose={() => setSharing(null)}
          onShared={(childId) => {
            setSharedNotice({ childId, doctor: doctorName(sharing) })
            setSharing(null)
            setReloadKey((k) => k + 1)
          }}
        />
      )}
    </DashboardLayout>
  )
}
