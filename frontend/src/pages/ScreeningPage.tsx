import { useEffect, useMemo, useState } from 'react'
import { DashboardLayout } from '../layouts/DashboardLayout'
import { UploadDropzone } from '../components/UploadDropzone'
import { AnalysisSteps } from '../components/AnalysisSteps'
import { api } from '../lib/api'
import type { ChildProfile, VideoScreening } from '../lib/types'
import { RiskPill, ConfidenceGauge } from '../components/RiskPill'

const uploadHelper = 'MP4, MOV, AVI • tối đa 200MB, 10 phút'

export function ScreeningPage() {
  const [children, setChildren] = useState<ChildProfile[] | null>(null)
  const [childId, setChildId] = useState<string>('')
  const [newName, setNewName] = useState('')
  const [newDob, setNewDob] = useState('')
  const [newGender, setNewGender] = useState<'UNSPECIFIED' | 'MALE' | 'FEMALE' | 'OTHER'>('UNSPECIFIED')
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errorDetail, setErrorDetail] = useState<string | null>(null)
  const [screening, setScreening] = useState<VideoScreening | null>(null)
  const [showCreateForm, setShowCreateForm] = useState(false)

  const canUpload = Boolean(childId) && !uploading

  async function loadChildren() {
    const res = await api.get('/children')
    setChildren(res.data.children)
    if (!childId && res.data.children?.[0]?.id) setChildId(res.data.children[0].id)
  }

  useEffect(() => {
    loadChildren().catch(() => setChildren([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const selectedChild = useMemo(() => children?.find((c) => c.id === childId) ?? null, [children, childId])

  async function createChild() {
    setError(null)
    setErrorDetail(null)
    if (!newName || !newDob) {
      setError('Vui lòng nhập họ tên và ngày sinh của trẻ.')
      return
    }
    try {
      const res = await api.post('/children', {
        fullName: newName,
        dateOfBirth: newDob,
        gender: newGender,
      })
      const created: ChildProfile = res.data.child
      const next = [created, ...(children ?? [])]
      setChildren(next)
      setChildId(created.id)
      setNewName('')
      setNewDob('')
      setNewGender('UNSPECIFIED')
      setShowCreateForm(false)
    } catch {
      setError('Không thể tạo hồ sơ trẻ.')
    }
  }

  async function pollScreening(id: string) {
    const start = Date.now()
    async function tick() {
      let res
      try {
        // Polling must never use a cached ETag response.  Axios rejects 304
        // and a transient polling error must not be presented as an upload
        // failure while OpenPose continues running successfully.
        res = await api.get(`/screenings/${id}`, {
          params: { _t: Date.now() },
          headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
        })
      } catch (error) {
        if (Date.now() - start > 60 * 60_000) throw error
        await new Promise((r) => setTimeout(r, 1500))
        return tick()
      }
      const s: VideoScreening = res.data.screening
      setScreening(s)
      if (s.status === 'COMPLETED') return
      if (s.status === 'FAILED') throw new Error(s.errorMessage ?? 'Screening failed')
      // OpenPose + ST-GCN can take several minutes for a longer video.
      // Keep the UI in sync with the backend instead of reporting a false
      // upload failure after the previous two-minute limit.
      if (Date.now() - start > 60 * 60_000) throw new Error('timeout')
      await new Promise((r) => setTimeout(r, 1500))
      return tick()
    }
    return tick()
  }

  async function onFileSelected(file: File) {
    setError(null)
    setErrorDetail(null)
    setUploading(true)
    setScreening(null)
    try {
      const fd = new FormData()
      fd.append('video', file)
      fd.append('childId', childId)
      // Axios supplies the multipart boundary required by Multer.
      const upRes = await api.post('/screenings/upload', fd)
      const video: VideoScreening = upRes.data.video
      setScreening(video)
      await api.post(`/screenings/${video.id}/process`)
      // Upload and job creation have succeeded at this point.  Polling is a
      // separate background concern; do not turn a transient GET failure into
      // a false "upload failed" message.
      void pollScreening(video.id).catch((e: unknown) => {
        const detail = e instanceof Error ? e.message : String(e)
        setError('Analysis status could not be refreshed automatically.')
        setErrorDetail(detail)
      })
    } catch (e: any) {
      const msg = e?.response?.data?.error
      const status = e?.response?.status
      const detail = e?.response?.data?.message ?? e?.response?.data?.detail ?? e?.message
      setErrorDetail([status ? `HTTP ${status}` : null, msg, detail].filter(Boolean).join(' - ') || null)
      if (msg === 'FILE_TOO_LARGE') setError('File quá lớn. Vui lòng chọn video nhỏ hơn.')
      else if (msg === 'UNSUPPORTED_FILE_TYPE') setError('Định dạng file không được hỗ trợ.')
      else setError('Upload/Phân tích thất bại. Vui lòng thử lại.')
    } finally {
      setUploading(false)
    }
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-black text-duo-ink">Sàng lọc ASD</h1>
          <p className="mt-1 text-sm font-semibold text-duo-mute">Tải video, chọn hồ sơ trẻ, nhận kết quả tham khảo.</p>
        </div>

        <div className="card-duo p-5">
          <div className="mb-4 flex items-center justify-between">
            <label className="text-xs font-extrabold uppercase tracking-wide text-duo-mute">Hồ sơ trẻ</label>
            <button type="button" onClick={() => setShowCreateForm((v) => !v)} className="link-duo text-xs">
              {showCreateForm ? 'Ẩn' : '+ Tạo mới'}
            </button>
          </div>
          <select className="input-duo mb-4" value={childId} onChange={(e) => setChildId(e.target.value)}>
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
            <div className="-mt-2 mb-4 text-xs font-bold text-duo-mute">
              Sinh: {new Date(selectedChild.dateOfBirth).toLocaleDateString('vi-VN')}
            </div>
          )}

          {showCreateForm && (
            <div className="mb-4 space-y-3 rounded-2xl bg-duo-mist p-4 shadow-card-inner">
              <input className="input-duo" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Họ tên" />
              <input className="input-duo" type="date" value={newDob} onChange={(e) => setNewDob(e.target.value)} />
              <select className="input-duo" value={newGender} onChange={(e) => setNewGender(e.target.value as any)}>
                <option value="UNSPECIFIED">Giới tính</option>
                <option value="MALE">Nam</option>
                <option value="FEMALE">Nữ</option>
                <option value="OTHER">Khác</option>
              </select>
              <button type="button" onClick={createChild} className="btn-duo">
                Tạo hồ sơ
              </button>
            </div>
          )}

          <UploadDropzone disabled={!canUpload} onFileSelected={onFileSelected} helperText={uploadHelper} />

          {error && (
            <div className="mt-3 rounded-2xl bg-red-50 px-4 py-3 text-sm font-bold text-duo-red">
              <div>{error}</div>
              {errorDetail && <div className="mt-1 break-words text-xs font-semibold">{errorDetail}</div>}
            </div>
          )}

          {screening && (
            <div className="panel-duo mt-4 space-y-4 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-extrabold text-duo-ink">Trạng thái</div>
                {screening.status === 'PROCESSING' && (
                  <span className="rounded-full bg-duo-green-soft px-3 py-1 text-xs font-extrabold text-duo-green-dark">
                    Đang phân tích...
                  </span>
                )}
                {screening.status === 'FAILED' && (
                  <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-extrabold text-duo-red">Thất bại</span>
                )}
              </div>
              {screening.result && (
                <>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-extrabold text-duo-ink">Kết quả:</span>
                    <RiskPill risk={screening.result.riskLevel} />
                  </div>
                  <ConfidenceGauge confidenceScore={screening.result.confidenceScore} riskLevel={screening.result.riskLevel} />
                  <div className="rounded-2xl bg-duo-mist px-4 py-3 text-sm font-semibold leading-relaxed text-duo-ink">
                    {screening.result.recommendation}
                  </div>
                  <div className="text-xs font-bold text-duo-mute">Kết quả chỉ tham khảo, không thay thế chẩn đoán y khoa.</div>
                </>
              )}
            </div>
          )}
        </div>

        <AnalysisSteps />
      </div>
    </DashboardLayout>
  )
}
