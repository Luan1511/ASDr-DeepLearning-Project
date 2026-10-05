import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Loader2, RotateCcw, ShieldCheck } from 'lucide-react'
import { api, apiErrorCode, isNetworkError } from '../lib/api'
import type { ChildProfile, ConsentScope, ConsentStatement, ConsentStatus, VideoScreening } from '../lib/types'
import { readVideoMetadata } from '../lib/video'
import { SCREENING_STATUS_LABEL } from '../lib/format'
import { UploadDropzone } from './UploadDropzone'
import { ConsentPanel } from './ConsentPanel'
import { ScreeningResultView } from './ScreeningResultView'

const UPLOAD_HELPER = 'MP4, MOV, AVI, MKV • quay 6–10 giây trẻ đi thẳng, thấy cả bàn chân'
const POLL_INTERVAL_MS = 2000

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function uploadErrorMessage(e: unknown): string {
  const code = apiErrorCode(e)
  if (code === 'FILE_TOO_LARGE') return 'File quá lớn. Vui lòng chọn video nhỏ hơn.'
  if (code === 'UNSUPPORTED_FILE_TYPE') return 'Định dạng file không được hỗ trợ (dùng MP4, MOV, AVI hoặc MKV).'
  if (code === 'CONSENT_REQUIRED') return 'Cần xác nhận đồng ý của phụ huynh trước khi tải video.'
  if (code === 'CHILD_NOT_FOUND') return 'Không tìm thấy hồ sơ trẻ.'
  if (isNetworkError(e)) return 'Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.'
  return 'Tải video thất bại. Vui lòng thử lại.'
}

/**
 * Child picker + guardian consent + upload + live job status + result.
 * Used by the home page and the screening page.
 */
export function ScreeningUploadPanel({ title, headerRight }: { title: string; headerRight?: ReactNode }) {
  const [children, setChildren] = useState<ChildProfile[] | null>(null)
  const [childId, setChildId] = useState('')
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDob, setNewDob] = useState('')
  const [newGender, setNewGender] = useState<ChildProfile['gender']>('UNSPECIFIED')

  const [statement, setStatement] = useState<ConsentStatement | null>(null)
  // Consent status tagged with the child it belongs to; a stale entry reads as "loading".
  const [consentEntry, setConsentEntry] = useState<{ childId: string; status: ConsentStatus } | null>(null)
  const [consentSaving, setConsentSaving] = useState(false)

  const [uploading, setUploading] = useState(false)
  const [uploadPct, setUploadPct] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hint, setHint] = useState<string | null>(null)
  const [screening, setScreening] = useState<VideoScreening | null>(null)

  // Bumped to cancel an in-flight polling loop (new upload or unmount).
  const pollToken = useRef(0)
  useEffect(() => () => void (pollToken.current += 1), [])

  useEffect(() => {
    api
      .get('/children')
      .then((res) => {
        setChildren(res.data.children)
        if (res.data.children?.[0]?.id) setChildId((current) => current || res.data.children[0].id)
      })
      .catch(() => setChildren([]))
    api
      .get('/consent/current')
      .then((res) => setStatement(res.data.statement))
      .catch(() => setStatement(null))
  }, [])

  useEffect(() => {
    if (!childId) return
    let stale = false
    api
      .get(`/children/${childId}/consent`)
      .then((res) => !stale && setConsentEntry({ childId, status: res.data }))
      .catch(() => !stale && setConsentEntry({ childId, status: { currentVersion: '', consent: null } }))
    return () => {
      stale = true
    }
  }, [childId])

  const consent = consentEntry?.childId === childId ? consentEntry.status : null
  const setConsent = (status: ConsentStatus) => setConsentEntry({ childId, status })

  const selectedChild = useMemo(() => children?.find((c) => c.id === childId) ?? null, [children, childId])
  const hasConsent = Boolean(consent?.consent)
  const canUpload = Boolean(childId) && hasConsent && !uploading

  async function createChild() {
    setError(null)
    if (!newName || !newDob) {
      setError('Vui lòng nhập họ tên và ngày sinh của trẻ.')
      return
    }
    try {
      const res = await api.post('/children', { fullName: newName, dateOfBirth: newDob, gender: newGender })
      const created: ChildProfile = res.data.child
      setChildren((prev) => [created, ...(prev ?? [])])
      setChildId(created.id)
      setNewName('')
      setNewDob('')
      setNewGender('UNSPECIFIED')
      setShowCreateForm(false)
    } catch {
      setError('Không thể tạo hồ sơ trẻ.')
    }
  }

  async function acceptConsent(scopes: ConsentScope[]) {
    if (!statement || !childId) return
    setConsentSaving(true)
    setError(null)
    try {
      const res = await api.post(`/children/${childId}/consent`, { accepted: true, version: statement.version, scopes })
      setConsent({ currentVersion: statement.version, consent: res.data.consent })
    } catch (e) {
      if (apiErrorCode(e) === 'CONSENT_VERSION_OUTDATED') {
        const fresh = await api.get('/consent/current').catch(() => null)
        if (fresh) setStatement(fresh.data.statement)
        setError('Nội dung đồng ý vừa được cập nhật. Vui lòng đọc lại và xác nhận.')
      } else {
        setError('Không lưu được xác nhận đồng ý. Vui lòng thử lại.')
      }
    } finally {
      setConsentSaving(false)
    }
  }

  async function revokeConsent() {
    if (!childId) return
    if (!window.confirm('Thu hồi đồng ý? Hệ thống sẽ không nhận thêm video mới của trẻ cho đến khi bạn đồng ý lại.')) return
    try {
      await api.delete(`/children/${childId}/consent`)
      setConsent({ currentVersion: consent?.currentVersion ?? '', consent: null })
    } catch {
      setError('Không thu hồi được đồng ý. Vui lòng thử lại.')
    }
  }

  async function poll(id: string, token: number) {
    while (token === pollToken.current) {
      try {
        const res = await api.get(`/screenings/${id}`, { params: { _t: Date.now() } })
        if (token !== pollToken.current) return
        const s: VideoScreening = res.data.screening
        setScreening(s)
        if (s.status === 'COMPLETED' || s.status === 'FAILED') return
      } catch {
        // Transient polling errors must not look like a failed analysis.
      }
      await sleep(POLL_INTERVAL_MS)
    }
  }

  async function startProcessing(id: string) {
    await api.post(`/screenings/${id}/process`)
    pollToken.current += 1
    void poll(id, pollToken.current)
  }

  async function onFileSelected(file: File) {
    setError(null)
    setHint(null)
    setScreening(null)
    setUploading(true)
    setUploadPct(0)
    pollToken.current += 1
    try {
      const meta = await readVideoMetadata(file)
      if (meta && meta.durationMs < 4000) {
        setHint('Video ngắn hơn 4 giây nên kết quả sẽ kém tin cậy. Nên quay 6–10 giây trẻ đi thẳng.')
      }

      const fd = new FormData()
      fd.append('childId', childId)
      if (meta) {
        fd.append('durationMs', String(meta.durationMs))
        fd.append('videoWidth', String(meta.width))
        fd.append('videoHeight', String(meta.height))
      }
      fd.append('video', file)

      const upRes = await api.post('/screenings/upload', fd, {
        params: { childId },
        onUploadProgress: (ev) => {
          if (ev.total) setUploadPct(Math.round((ev.loaded / ev.total) * 100))
        },
      })
      const video: VideoScreening = upRes.data.video
      setScreening(video)
      setUploadPct(null)
      await startProcessing(video.id)
    } catch (e) {
      setError(uploadErrorMessage(e))
    } finally {
      setUploading(false)
      setUploadPct(null)
    }
  }

  async function retry() {
    if (!screening) return
    const previous = screening
    setError(null)
    setScreening({ ...previous, status: 'PROCESSING', errorMessage: null, job: null })
    try {
      await startProcessing(previous.id)
    } catch (e) {
      setScreening(previous)
      setError(
        apiErrorCode(e) === 'CONSENT_REQUIRED'
          ? 'Cần xác nhận đồng ý của phụ huynh trước khi phân tích lại.'
          : 'Không gửi lại được yêu cầu phân tích.',
      )
    }
  }

  const job = screening?.job

  return (
    <div className="card-duo p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-extrabold uppercase tracking-wide text-duo-ink">{title}</h2>
        {headerRight}
      </div>

      <div className="mb-4">
        <div className="mb-2 flex items-center justify-between">
          <label className="text-xs font-extrabold uppercase tracking-wide text-duo-mute">Hồ sơ trẻ</label>
          <button type="button" onClick={() => setShowCreateForm((v) => !v)} className="link-duo text-xs">
            {showCreateForm ? 'Ẩn' : '+ Tạo mới'}
          </button>
        </div>
        <select className="input-duo" value={childId} onChange={(e) => setChildId(e.target.value)}>
          <option value="" disabled>
            {children === null ? 'Đang tải...' : 'Chọn hồ sơ'}
          </option>
          {(children ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.fullName}
            </option>
          ))}
        </select>
        {selectedChild && (
          <div className="mt-1.5 text-xs font-bold text-duo-mute">
            Sinh: {new Date(selectedChild.dateOfBirth).toLocaleDateString('vi-VN')}
          </div>
        )}
      </div>

      {showCreateForm && (
        <div className="mb-4 space-y-3 rounded-2xl bg-duo-mist p-4 shadow-card-inner">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <input className="input-duo" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Họ tên" />
            <input className="input-duo" type="date" value={newDob} onChange={(e) => setNewDob(e.target.value)} />
            <select className="input-duo" value={newGender} onChange={(e) => setNewGender(e.target.value as ChildProfile['gender'])}>
              <option value="UNSPECIFIED">Giới tính</option>
              <option value="MALE">Nam</option>
              <option value="FEMALE">Nữ</option>
              <option value="OTHER">Khác</option>
            </select>
          </div>
          <button type="button" onClick={createChild} className="btn-duo">
            Tạo hồ sơ
          </button>
        </div>
      )}

      {childId && (
        <div className="mb-4">
          {consent === null && <div className="text-xs font-bold text-duo-mute">Đang kiểm tra xác nhận đồng ý...</div>}
          {consent?.consent && (
            <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-duo-green-dark">
              <ShieldCheck className="h-4 w-4 stroke-[2.5]" />
              <span>Đã có đồng ý của phụ huynh từ {new Date(consent.consent.grantedAt).toLocaleDateString('vi-VN')}.</span>
              <button type="button" className="link-duo text-xs" onClick={revokeConsent}>
                Thu hồi
              </button>
            </div>
          )}
          {consent && !consent.consent && statement && (
            <ConsentPanel
              statement={statement}
              childName={selectedChild?.fullName ?? ''}
              submitting={consentSaving}
              onAccept={acceptConsent}
            />
          )}
          {consent && !consent.consent && !statement && (
            <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-bold text-duo-red">
              Không tải được nội dung xác nhận đồng ý. Vui lòng tải lại trang.
            </div>
          )}
        </div>
      )}

      <UploadDropzone disabled={!canUpload} onFileSelected={onFileSelected} helperText={UPLOAD_HELPER} />

      {uploadPct !== null && (
        <div className="mt-3">
          <div className="mb-1 flex justify-between text-xs font-bold text-duo-mute">
            <span>Đang tải video lên...</span>
            <span className="tabular-nums">{uploadPct}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-duo-mist">
            <div className="h-2 rounded-full bg-duo-green transition-all" style={{ width: `${uploadPct}%` }} />
          </div>
        </div>
      )}

      {hint && <div className="mt-3 rounded-2xl bg-yellow-50 px-4 py-3 text-sm font-bold text-yellow-900">{hint}</div>}
      {error && <div className="mt-3 rounded-2xl bg-red-50 px-4 py-3 text-sm font-bold text-duo-red">{error}</div>}

      {screening && (
        <div className="panel-duo mt-4 space-y-4 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-extrabold text-duo-ink">Trạng thái</div>
            {screening.status === 'PROCESSING' && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-duo-green-soft px-3 py-1 text-xs font-extrabold text-duo-green-dark">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {job?.status === 'QUEUED'
                  ? `Đang chờ đến lượt${job.queuePosition ? ` (vị trí ${job.queuePosition})` : ''}`
                  : 'Đang phân tích...'}
              </span>
            )}
            {screening.status === 'UPLOADED' && (
              <span className="rounded-full bg-duo-mist px-3 py-1 text-xs font-extrabold text-duo-mute">
                {SCREENING_STATUS_LABEL.UPLOADED}
              </span>
            )}
            {screening.status === 'FAILED' && (
              <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-extrabold text-duo-red">Thất bại</span>
            )}
            {screening.status === 'COMPLETED' && (
              <span className="rounded-full bg-duo-green-soft px-3 py-1 text-xs font-extrabold text-duo-green-dark">Hoàn tất</span>
            )}
          </div>

          {screening.status === 'PROCESSING' && (
            <div className="space-y-1 text-xs font-semibold leading-relaxed text-duo-mute">
              <div>
                Hệ thống đang trích xuất khung xương (OpenPose) và chạy mô hình sàng lọc. Việc này có thể mất vài phút; bạn có thể rời
                trang và xem kết quả ở mục Lịch sử.
              </div>
              {screening.errorMessage && <div className="text-yellow-800">{screening.errorMessage}</div>}
            </div>
          )}

          {screening.status === 'FAILED' && (
            <div className="space-y-3">
              <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-semibold text-duo-red">
                {screening.errorMessage ?? 'Phân tích thất bại.'}
              </div>
              {screening.rawVideoDeleted ? (
                <div className="text-xs font-bold text-duo-mute">Video gốc không còn trên máy chủ; vui lòng tải lên lại.</div>
              ) : (
                <button type="button" className="btn-duo-secondary" onClick={retry}>
                  <RotateCcw className="h-4 w-4" />
                  Thử phân tích lại
                </button>
              )}
            </div>
          )}

          {screening.result && <ScreeningResultView result={screening.result} />}
        </div>
      )}
    </div>
  )
}
