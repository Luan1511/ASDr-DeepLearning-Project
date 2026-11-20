import { useEffect, useState } from 'react'
import { DashboardLayout } from '../layouts/DashboardLayout'
import { api } from '../lib/api'

type Report = { id: string; reason: string; details: string; contentSnapshot: string; authorSnapshot: string; status: string; createdAt: string; directMessageId?: string | null; postId?: string | null; actions: Array<{ id: string; action: string; reason: string; createdAt: string }> }

export function AdminCommunityPage() {
  const [reports, setReports] = useState<Report[]>([])
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('ALL')
  const load = () => api.get('/admin/community/reports').then((r) => { setReports(r.data.reports); setError('') }).catch(() => setError('Không tải được hàng chờ báo cáo.'))
  useEffect(() => { void load() }, [])
  async function act(id: string, action: string) {
    const reason = window.prompt('Ghi lý do xử lý (sẽ lưu trong nhật ký kiểm duyệt):')
    if (!reason?.trim()) return
    try { await api.post(`/admin/community/reports/${id}/action`, { action, reason }); await load() }
    catch { setError('Không xử lý được báo cáo. Vui lòng tải lại.') }
  }
  return <DashboardLayout><main className="mx-auto max-w-5xl space-y-4"><h1 className="text-2xl font-black text-duo-ink">Kiểm duyệt Cộng đồng</h1><select className="input-duo !w-auto" aria-label="Loại báo cáo" value={filter} onChange={(e) => setFilter(e.target.value)}><option value="ALL">Tất cả</option><option value="MESSAGE">Tin nhắn</option><option value="CONTENT">Bài viết / bình luận</option></select>{error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}{reports.filter((r) => filter === "ALL" || (filter === "MESSAGE" ? Boolean(r.directMessageId) : !r.directMessageId)).map((r) => <article key={r.id} className="card-duo space-y-3 p-4"><div className="flex flex-wrap justify-between gap-2"><strong>{r.directMessageId ? "Tin nhắn" : r.postId ? "Bài viết" : "Bình luận"} · {r.reason} · {r.authorSnapshot}</strong><span className="text-xs">{r.status} · {new Date(r.createdAt).toLocaleString('vi-VN')}</span></div><p className="whitespace-pre-wrap text-sm">{r.contentSnapshot}</p>{r.details && <p className="text-sm text-duo-mute">Lý do: {r.details}</p>}<div className="flex flex-wrap gap-2"><button className="btn-duo-secondary" onClick={() => void act(r.id, 'REVIEWING')}>Đang xem xét</button><button className="btn-duo-secondary" onClick={() => void act(r.id, 'HIDE')}>Ẩn nội dung</button><button className="btn-duo-secondary" onClick={() => void act(r.id, 'RESTORE')}>Khôi phục</button><button className="btn-duo-secondary" onClick={() => void act(r.id, 'SUSPEND_AUTHOR')}>Tạm ngưng thành viên</button><button className="btn-duo-secondary" onClick={() => void act(r.id, 'UNSUSPEND_AUTHOR')}>Gỡ tạm ngưng</button><button className="btn-duo-secondary" onClick={() => void act(r.id, 'DISMISS')}>Bỏ qua</button></div><details className="text-xs"><summary>Lịch sử xử lý</summary>{r.actions.map((action) => <p key={action.id} className="mt-2">{action.action}: {action.reason} · {new Date(action.createdAt).toLocaleString("vi-VN")}</p>)}</details></article>)}{reports.length === 0 && !error && <p className="card-duo p-6 text-sm">Hàng chờ hiện chưa có báo cáo.</p>}</main></DashboardLayout>
}
