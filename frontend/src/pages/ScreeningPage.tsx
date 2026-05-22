import { useEffect, useMemo, useState } from 'react'
import { DashboardLayout } from '../layouts/DashboardLayout'
import { UploadDropzone } from '../components/UploadDropzone'
import { AnalysisSteps } from '../components/AnalysisSteps'
import { api } from '../lib/api'
import type { ChildProfile, VideoScreening } from '../lib/types'
import { RiskPill, ConfidenceGauge } from '../components/RiskPill'

const uploadHelper = 'Định dạng hỗ trợ: MP4, MOV, AVI (Tối đa 200MB, 10 phút)'

export function ScreeningPage() {
  const [children, setChildren] = useState<ChildProfile[] | null>(null)
  const [childId, setChildId] = useState<string>('')
  const [newName, setNewName] = useState('')
  const [newDob, setNewDob] = useState('')
  const [newGender, setNewGender] = useState<'UNSPECIFIED' | 'MALE' | 'FEMALE' | 'OTHER'>('UNSPECIFIED')
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
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
      const res = await api.get(`/screenings/${id}`)
      const s: VideoScreening = res.data.screening
      setScreening(s)
      if (s.status === 'COMPLETED' || s.status === 'FAILED') return
      if (Date.now() - start > 120_000) throw new Error('timeout')
      await new Promise((r) => setTimeout(r, 1500))
      return tick()
    }
    return tick()
  }

  async function onFileSelected(file: File) {
    setError(null)
    setUploading(true)
    setScreening(null)
    try {
      const fd = new FormData()
      fd.append('video', file)
      fd.append('childId', childId)
      const upRes = await api.post('/screenings/upload', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      const video: VideoScreening = upRes.data.video
      setScreening(video)
      await api.post(`/screenings/${video.id}/process`)
      await pollScreening(video.id)
    } catch (e: any) {
      const msg = e?.response?.data?.error
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
        {/* Upload card */}
        <div className="rounded-3xl bg-white shadow-card ring-1 ring-slate-100 p-6">
          <div className="mb-5 flex items-center gap-2">
            <div
              className="flex h-8 w-8 items-center justify-center rounded-xl text-white text-sm font-bold"
              style={{ background: 'linear-gradient(135deg, #6C63FF, #4FC3F7)' }}
            >
              📹
            </div>
            <h1 className="text-lg font-bold text-slate-800">Sàng lọc ASD – Tải video</h1>
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_300px]">
            {/* Left: dropzone area */}
            <div className="space-y-4">
              {/* Child selector */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-semibold text-slate-700">Chọn hồ sơ trẻ</label>
                  <button
                    type="button"
                    onClick={() => setShowCreateForm((v) => !v)}
                    className="text-xs font-semibold text-[#6C63FF] hover:underline"
                  >
                    {showCreateForm ? 'Ẩn' : '+ Tạo hồ sơ mới'}
                  </button>
                </div>
                <select
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none focus:border-[#6C63FF] focus:ring-2 focus:ring-indigo-100"
                  value={childId}
                  onChange={(e) => setChildId(e.target.value)}
                >
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
                  <div className="mt-1.5 text-xs text-slate-400">
                    Ngày sinh: {new Date(selectedChild.dateOfBirth).toLocaleDateString('vi-VN')} • Giới tính:{' '}
                    {selectedChild.gender === 'MALE' ? 'Nam' : selectedChild.gender === 'FEMALE' ? 'Nữ' : 'Khác'}
                  </div>
                )}
              </div>

              <UploadDropzone disabled={!canUpload} onFileSelected={onFileSelected} helperText={uploadHelper} />

              <div className="flex items-start gap-2 rounded-xl bg-indigo-50 px-3 py-2.5 text-xs text-indigo-700">
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 flex-shrink-0 mt-0.5 text-[#6C63FF]">
                  <path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
                </svg>
                <span>
                  <strong>Gợi ý:</strong> Video ghi lại các hoạt động tự nhiên của trẻ như: chơi, đi lại, tương tác, phản ứng...
                </span>
              </div>

              {error && (
                <div className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700 ring-1 ring-rose-100">
                  {error}
                </div>
              )}

              {/* Result display */}
              {screening && (
                <div className="rounded-2xl bg-white p-5 ring-1 ring-slate-200 shadow-card space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-bold text-slate-800">Trạng thái xử lý</div>
                      <div className="text-xs text-slate-400 mt-0.5">
                        {new Date(screening.createdAt).toLocaleString('vi-VN')}
                      </div>
                    </div>
                    {screening.status === 'PROCESSING' && (
                      <span className="flex items-center gap-1.5 rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-600">
                        <span className="h-1.5 w-1.5 rounded-full bg-indigo-400 animate-pulse" />
                        Đang phân tích...
                      </span>
                    )}
                    {screening.status === 'FAILED' && (
                      <span className="rounded-full bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-600">Thất bại</span>
                    )}
                  </div>

                  {screening.result && (
                    <>
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-semibold text-slate-700">Kết quả:</span>
                        <RiskPill risk={screening.result.riskLevel} />
                      </div>

                      <ConfidenceGauge
                        confidenceScore={screening.result.confidenceScore}
                        riskLevel={screening.result.riskLevel}
                      />

                      <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm leading-relaxed text-slate-600 ring-1 ring-slate-100">
                        {screening.result.recommendation}
                      </div>

                      <div className="rounded-xl bg-amber-50 px-3 py-2.5 text-xs text-amber-700 ring-1 ring-amber-100">
                        ⚠️ Lưu ý: Kết quả chỉ mang tính tham khảo, không thay thế chẩn đoán y khoa.
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Right: create child form */}
            {showCreateForm && (
              <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200 space-y-3 h-fit">
                <div className="text-sm font-bold text-slate-800">Tạo hồ sơ trẻ</div>
                <div className="text-xs text-slate-500">Mỗi video screening sẽ gắn với một hồ sơ trẻ.</div>

                <div>
                  <label className="text-xs font-semibold text-slate-700">Họ và tên</label>
                  <input
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#6C63FF] focus:ring-2 focus:ring-indigo-100"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="Ví dụ: Bé An"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-700">Ngày sinh</label>
                  <input
                    type="date"
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#6C63FF] focus:ring-2 focus:ring-indigo-100"
                    value={newDob}
                    onChange={(e) => setNewDob(e.target.value)}
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-700">Giới tính</label>
                  <select
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#6C63FF] focus:ring-2 focus:ring-indigo-100"
                    value={newGender}
                    onChange={(e) => setNewGender(e.target.value as any)}
                  >
                    <option value="UNSPECIFIED">Chưa xác định</option>
                    <option value="MALE">Nam</option>
                    <option value="FEMALE">Nữ</option>
                    <option value="OTHER">Khác</option>
                  </select>
                </div>

                <button
                  type="button"
                  onClick={createChild}
                  className="w-full rounded-xl py-2 text-sm font-bold text-white transition hover:opacity-90"
                  style={{ background: 'linear-gradient(135deg, #6C63FF, #4FC3F7)' }}
                >
                  Tạo hồ sơ
                </button>
              </div>
            )}

            {/* If form hidden, show a placeholder hint card */}
            {!showCreateForm && (
              <div
                className="hidden lg:flex flex-col items-center justify-center gap-3 rounded-2xl p-6 text-white h-fit"
                style={{ background: 'linear-gradient(135deg, #6C63FF, #4FC3F7)' }}
              >
                <div className="text-4xl">👶</div>
                <div className="text-sm font-bold text-center">Chưa có hồ sơ trẻ?</div>
                <div className="text-xs text-white/80 text-center">
                  Tạo hồ sơ để gắn kết với video phân tích.
                </div>
                <button
                  onClick={() => setShowCreateForm(true)}
                  className="rounded-xl bg-white/20 px-4 py-2 text-xs font-semibold hover:bg-white/30 transition"
                >
                  Tạo ngay →
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Analysis Steps */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <div
              className="flex h-7 w-7 items-center justify-center rounded-lg text-white text-xs font-bold"
              style={{ background: 'linear-gradient(135deg, #6C63FF, #4FC3F7)' }}
            >
              2
            </div>
            <h2 className="text-base font-bold text-slate-800">Quy trình phân tích</h2>
          </div>
          <AnalysisSteps />
        </div>
      </div>
    </DashboardLayout>
  )
}
