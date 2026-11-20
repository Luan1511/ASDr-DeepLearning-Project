import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Eye, EyeOff, Loader2, Stethoscope } from 'lucide-react'
import { Card } from '../Card'
import {
  MOCK_DOCTOR_NOTICE,
  SHARE_SCOPE_LABEL,
  doctorApiErrorMessage,
  doctorName,
  fetchDoctorLinks,
  revokeDoctorLink,
  type DoctorLinkDto,
} from '../../lib/doctors'
import { formatDate, formatDateTime } from '../../lib/format'
import { DoctorAccessHistory } from './DoctorAccessHistory'

type SectionState =
  | { kind: 'loading' }
  | { kind: 'hidden' }
  | { kind: 'ready'; available: boolean; links: DoctorLinkDto[] }

function viewedText(link: DoctorLinkDto) {
  if (!link.lastViewedAt) return 'Bác sĩ chưa mở hồ sơ.'
  return `Bác sĩ mở hồ sơ gần nhất lúc ${formatDateTime(link.lastViewedAt)} (${link.viewCount} lần).`
}

/**
 * "Chia sẻ với bác sĩ" card of a child's dashboard: who can currently read the
 * record, which parts, when they last opened it, and a button to stop.
 */
export function ChildDoctorLinksSection({ childId, childName }: { childId: string; childName: string }) {
  const [state, setState] = useState<SectionState>({ kind: 'loading' })
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    fetchDoctorLinks(childId).then(
      (data) => active && setState({ kind: 'ready', ...data }),
      // An older backend, or any failure: the rest of the dashboard matters more than this card.
      () => active && setState({ kind: 'hidden' }),
    )
    return () => {
      active = false
    }
  }, [childId])

  if (state.kind !== 'ready') return null
  // Feature off and nothing ever shared: nothing to show.
  if (!state.available && state.links.length === 0) return null

  const activeLinks = state.links.filter((l) => l.active)
  const ended = state.links.filter((l) => !l.active)

  async function revoke(link: DoctorLinkDto) {
    setBusyId(link.id)
    setError(null)
    try {
      await revokeDoctorLink(childId, link.id)
      const fresh = await fetchDoctorLinks(childId)
      setState({ kind: 'ready', ...fresh })
      setConfirmId(null)
    } catch (e) {
      setError(doctorApiErrorMessage(e, 'Chưa ngừng chia sẻ được. Vui lòng thử lại.'))
    } finally {
      setBusyId(null)
    }
  }

  const title = (
    <span className="flex items-center gap-2">
      <Stethoscope className="h-4 w-4 text-duo-green-dark" />
      Chia sẻ với bác sĩ
    </span>
  )

  return (
    <Card title={title}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-2xl text-sm font-semibold leading-relaxed text-duo-ink">
            {activeLinks.length === 0
              ? `Hồ sơ của ${childName} hiện chưa được chia sẻ với bác sĩ nào.`
              : `${activeLinks.length} bác sĩ đang xem được hồ sơ của ${childName}. Bạn có thể ngừng chia sẻ bất cứ lúc nào.`}
          </p>
          {state.available && (
            <Link to={`/doctors?childId=${encodeURIComponent(childId)}`} className="btn-duo">
              <Stethoscope className="h-4 w-4" />
              Kết nối bác sĩ
            </Link>
          )}
        </div>

        {error && <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-bold text-duo-red">{error}</div>}

        {activeLinks.map((link) => (
          <div key={link.id} className="rounded-2xl bg-duo-mist px-4 py-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-black text-duo-ink">{doctorName(link.doctor)}</span>
                  {link.doctor.isMock && (
                    <span className="rounded-full bg-yellow-50 px-2 py-0.5 text-[11px] font-extrabold text-yellow-900" title={MOCK_DOCTOR_NOTICE}>
                      Bác sĩ mẫu
                    </span>
                  )}
                </div>
                <div className="text-xs font-bold text-duo-mute">
                  {link.doctor.specialty} • {link.doctor.workplace}, {link.doctor.city}
                </div>
              </div>
              {confirmId === link.id ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-bold text-duo-ink">Ngừng chia sẻ với bác sĩ này?</span>
                  <button type="button" className="btn-duo-secondary !px-3 !py-2 !text-duo-red" disabled={busyId === link.id} onClick={() => void revoke(link)}>
                    {busyId === link.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <EyeOff className="h-4 w-4" />}
                    Ngừng
                  </button>
                  <button type="button" className="link-duo text-xs" disabled={busyId === link.id} onClick={() => setConfirmId(null)}>
                    Giữ nguyên
                  </button>
                </div>
              ) : (
                <button type="button" className="btn-duo-secondary !px-3 !py-2" onClick={() => setConfirmId(link.id)}>
                  <EyeOff className="h-4 w-4" />
                  Ngừng chia sẻ
                </button>
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {link.scopes.map((scope) => (
                <span key={scope} className="rounded-full bg-white px-2.5 py-1 text-[11px] font-extrabold text-duo-ink shadow-chip">
                  {SHARE_SCOPE_LABEL[scope]}
                </span>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-bold text-duo-mute">
              <span>Chia sẻ từ {formatDate(link.grantedAt)}</span>
              <span>{link.expiresAt ? `Hết hạn ${formatDate(link.expiresAt)}` : 'Không thời hạn'}</span>
              <span className="flex items-center gap-1">
                <Eye className="h-3.5 w-3.5" />
                {viewedText(link)}
              </span>
            </div>
            {link.message && <div className="mt-2 text-xs font-semibold text-duo-ink">Lời nhắn của bạn: “{link.message}”</div>}
          </div>
        ))}

        {ended.length > 0 && (
          <details className="rounded-2xl bg-white px-4 py-3 shadow-card-inner">
            <summary className="cursor-pointer text-xs font-extrabold uppercase tracking-wide text-duo-mute">
              Đã ngừng chia sẻ ({ended.length})
            </summary>
            <ul className="mt-2 space-y-1.5 text-xs font-bold text-duo-mute">
              {ended.map((link) => (
                <li key={link.id}>
                  {doctorName(link.doctor)} — từ {formatDate(link.grantedAt)}
                  {link.revokedAt ? ` đến ${formatDate(link.revokedAt)}` : ''}
                  {link.viewCount > 0 ? ` • đã mở ${link.viewCount} lần` : ' • chưa mở lần nào'}
                </li>
              ))}
            </ul>
          </details>
        )}

        <DoctorAccessHistory key={state.links.map((link) => `${link.id}:${link.revokedAt}`).join('|')} childId={childId} />
        <p className="text-xs font-semibold leading-relaxed text-duo-mute">
          Bác sĩ chỉ xem được những phần bạn đã chọn và không bao giờ thấy video của con. Xoá hồ sơ trẻ cũng xoá mọi kết nối.
        </p>
      </div>
    </Card>
  )
}
