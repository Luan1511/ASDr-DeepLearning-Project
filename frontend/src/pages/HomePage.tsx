import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { DashboardLayout } from '../layouts/DashboardLayout'
import { UploadDropzone } from '../components/UploadDropzone'
import { AnalysisSteps } from '../components/AnalysisSteps'
import { AIAssistantCard } from '../components/AIAssistantCard'
import { RecentResultsCard } from '../components/RecentResultsCard'
import { api } from '../lib/api'
import type { ChildProfile, VideoScreening } from '../lib/types'
import { RiskPill, ConfidenceGauge } from '../components/RiskPill'

const uploadHelper = 'Định dạng hỗ trợ: MP4, MOV, AVI (Tối đa 200MB, 10 phút)'

const features = [
  {
    icon: '🔬',
    color: 'bg-violet-50 text-violet-600',
    title: 'Khoa học & đáng tin cậy',
    desc: 'Dựa trên các nghiên cứu và mô hình AI tiên tiến.',
  },
  {
    icon: '🔒',
    color: 'bg-sky-50 text-sky-600',
    title: 'Bảo mật tuyệt đối',
    desc: 'Dữ liệu của bạn được mã hóa và bảo vệ nghiêm ngặt.',
  },
  {
    icon: '⚡',
    color: 'bg-amber-50 text-amber-600',
    title: 'Nhanh chóng',
    desc: 'Nhận kết quả phân tích chi tiết trong vài phút.',
  },
  {
    icon: '🤝',
    color: 'bg-emerald-50 text-emerald-600',
    title: 'Hỗ trợ đồng hành',
    desc: 'Trợ lý AI luôn sẵn sàng giải đáp thắc mắc của bạn.',
  },
]

export function HomePage() {
  const navigate = useNavigate()
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

  const selectedChild = useMemo(
    () => children?.find((c) => c.id === childId) ?? null,
    [children, childId],
  )

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
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_340px]">
        {/* ===== LEFT COLUMN ===== */}
        <div className="space-y-6">
          {/* Hero Banner */}
          <div
            className="relative overflow-hidden rounded-3xl p-6 md:p-8"
            style={{ background: 'linear-gradient(135deg, #EEF2FF 0%, #E0F2FE 100%)' }}
          >
            <div className="grid grid-cols-1 items-center gap-6 md:grid-cols-[1fr_auto]">
              <div>
                <h1 className="text-2xl font-bold leading-snug text-slate-800 md:text-3xl">
                  Hiểu con sớm hơn,{' '}
                  <span
                    className="font-extrabold"
                    style={{ background: 'linear-gradient(90deg,#6C63FF,#00BCD4)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}
                  >
                    đồng hành kịp thời
                  </span>
                </h1>
                <p className="mt-2 text-sm leading-relaxed text-slate-500 max-w-md">
                  Tải video ngắn ghi lại các hành vi tự nhiên của trẻ. AI sẽ phân tích và đưa ra kết quả tham khảo dựa trên các chỉ số hành vi.
                </p>
                <div className="mt-5 flex flex-wrap gap-3">
                  <a
                    href="#upload"
                    className="inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold text-white shadow-md transition hover:opacity-90"
                    style={{ background: 'linear-gradient(135deg, #6C63FF, #818CF8)' }}
                  >
                    <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                      <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 6.707a1 1 0 010-1.414l3-3a1 1 0 011.414 0l3 3a1 1 0 01-1.414 1.414L11 5.414V13a1 1 0 11-2 0V5.414L7.707 6.707a1 1 0 01-1.414 0z" clipRule="evenodd" />
                    </svg>
                    Tải video ngay
                  </a>
                  <button
                    onClick={() => navigate('/guide')}
                    className="inline-flex items-center gap-2 rounded-xl bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 shadow-sm ring-1 ring-slate-200 transition hover:bg-slate-50"
                  >
                    Xem hướng dẫn
                  </button>
                </div>
              </div>

              {/* Decorative card */}
              <div className="hidden md:block">
                <div className="rounded-2xl bg-white/80 p-4 shadow-md ring-1 ring-slate-200 min-w-[180px]">
                  <div className="text-xs font-semibold text-slate-500 mb-2">Phân tích hành vi</div>
                  <div className="text-xs text-slate-400 mb-3">Đang xử lý...</div>
                  <div className="space-y-2">
                    {[75, 60, 80].map((v, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <div className="h-2 flex-1 rounded-full bg-slate-100 overflow-hidden">
                          <div
                            className="h-2 rounded-full"
                            style={{
                              width: `${v}%`,
                              background: ['#6C63FF', '#00BCD4', '#818CF8'][i],
                            }}
                          />
                        </div>
                        <span className="text-xs text-slate-500 tabular-nums w-7 text-right">{v}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Decorative circles */}
            <div className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full opacity-20" style={{ background: 'linear-gradient(135deg,#6C63FF,#4FC3F7)' }} />
            <div className="pointer-events-none absolute -bottom-6 right-24 h-20 w-20 rounded-full opacity-10" style={{ background: 'linear-gradient(135deg,#818CF8,#00BCD4)' }} />
          </div>

          {/* Upload Section */}
          <div id="upload" className="rounded-3xl bg-white p-6 shadow-card ring-1 ring-slate-100">
            <div className="mb-4 flex items-center gap-2">
              <div
                className="flex h-7 w-7 items-center justify-center rounded-lg text-white text-xs font-bold"
                style={{ background: 'linear-gradient(135deg, #6C63FF, #4FC3F7)' }}
              >
                1
              </div>
              <h2 className="text-base font-bold text-slate-800">Tải video của trẻ</h2>
            </div>

            {/* Child selector */}
            <div className="mb-4">
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

            {/* Create child form (collapsible) */}
            {showCreateForm && (
              <div className="mb-4 rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200 space-y-3">
                <div className="text-sm font-semibold text-slate-700">Tạo hồ sơ trẻ mới</div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <div>
                    <label className="text-xs font-medium text-slate-600">Họ và tên</label>
                    <input
                      className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#6C63FF] focus:ring-2 focus:ring-indigo-100"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder="Ví dụ: Bé An"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-600">Ngày sinh</label>
                    <input
                      type="date"
                      className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#6C63FF] focus:ring-2 focus:ring-indigo-100"
                      value={newDob}
                      onChange={(e) => setNewDob(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-600">Giới tính</label>
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
                </div>
                <button
                  type="button"
                  onClick={createChild}
                  className="rounded-xl px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90"
                  style={{ background: 'linear-gradient(135deg, #6C63FF, #4FC3F7)' }}
                >
                  Tạo hồ sơ
                </button>
              </div>
            )}

            <UploadDropzone disabled={!canUpload} onFileSelected={onFileSelected} helperText={uploadHelper} />

            {/* Hint */}
            <div className="mt-3 flex items-start gap-2 rounded-xl bg-indigo-50 px-3 py-2.5 text-xs text-indigo-700">
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 flex-shrink-0 mt-0.5 text-[#6C63FF]">
                <path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
              </svg>
              <span>
                <strong>Gợi ý:</strong> Video ghi lại các hoạt động tự nhiên của trẻ như: chơi, đi lại, tương tác, phản ứng...
              </span>
            </div>

            {error && (
              <div className="mt-3 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700 ring-1 ring-rose-100">
                {error}
              </div>
            )}

            {/* Processing result */}
            {screening && (
              <div className="mt-4 rounded-2xl bg-white p-5 ring-1 ring-slate-200 shadow-card">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                  <div>
                    <div className="text-sm font-bold text-slate-800">Trạng thái xử lý</div>
                    <div className="text-xs text-slate-400 mt-0.5">
                      {new Date(screening.createdAt).toLocaleString('vi-VN')}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {screening.status === 'PROCESSING' && (
                      <span className="flex items-center gap-1.5 rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-600">
                        <span className="h-1.5 w-1.5 rounded-full bg-indigo-400 animate-pulse" />
                        Đang phân tích...
                      </span>
                    )}
                    {screening.status === 'FAILED' && (
                      <span className="rounded-full bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-600">
                        Thất bại
                      </span>
                    )}
                  </div>
                </div>

                {screening.result && (
                  <div className="space-y-4">
                    <div className="flex items-center gap-3">
                      <div className="text-sm font-semibold text-slate-700">Kết quả tham khảo:</div>
                      <RiskPill risk={screening.result.riskLevel} />
                    </div>

                    <ConfidenceGauge
                      confidenceScore={screening.result.confidenceScore}
                      riskLevel={screening.result.riskLevel}
                    />

                    <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm leading-relaxed text-slate-600 ring-1 ring-slate-200">
                      {screening.result.recommendation}
                    </div>

                    <div className="rounded-xl bg-amber-50 px-3 py-2.5 text-xs text-amber-700 ring-1 ring-amber-100">
                      ⚠️ Lưu ý: Kết quả chỉ mang tính tham khảo, không thay thế chẩn đoán y khoa.
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Analysis Steps */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
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

          {/* Feature cards */}
          <div>
            <h2 className="mb-3 text-base font-bold text-slate-800">Tính năng nổi bật</h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {features.map((f) => (
                <div
                  key={f.title}
                  className="rounded-2xl bg-white p-4 shadow-card ring-1 ring-slate-100 flex flex-col items-start gap-2"
                >
                  <div className={`flex h-10 w-10 items-center justify-center rounded-xl text-xl ${f.color}`}>
                    {f.icon}
                  </div>
                  <div className="text-sm font-bold text-slate-800 leading-snug">{f.title}</div>
                  <div className="text-xs leading-relaxed text-slate-500">{f.desc}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ===== RIGHT COLUMN ===== */}
        <div className="space-y-4">
          <AIAssistantCard />
          <RecentResultsCard />
        </div>
      </div>
    </DashboardLayout>
  )
}
