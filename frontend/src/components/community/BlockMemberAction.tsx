import { useEffect, useId, useRef, useState } from 'react'
import { CheckCircle2, Loader2, ShieldBan, ShieldCheck, X } from 'lucide-react'
import { api } from '../../lib/api'

export function BlockMemberAction({ memberId, displayName, blocked, onChanged, onNotice }: { memberId: string; displayName: string; blocked: boolean; onChanged: (blocked: boolean) => void; onNotice?: (message: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const descriptionId = useId()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const Icon = blocked ? ShieldCheck : ShieldBan
  useEffect(() => { if (open) dialog.current?.showModal(); else dialog.current?.close() }, [open])
  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), 5000)
    return () => window.clearTimeout(timer)
  }, [notice])
  async function confirm() {
    if (busy) return
    setBusy(true); setError('')
    const next = !blocked
    try {
      if (blocked) await api.delete(`/community/members/${memberId}/block`)
      else await api.post(`/community/members/${memberId}/block`)
    } catch {
      setError('Chưa lưu được thay đổi. Vui lòng kiểm tra kết nối và thử lại.')
      setBusy(false)
      return
    }
    setOpen(false); setBusy(false)
    const message = next ? `Đã chặn ${displayName}.` : `Đã bỏ chặn ${displayName}.`
    if (onNotice) onNotice(message)
    else setNotice(message)
    onChanged(next)
    window.dispatchEvent(new Event('community-blocks-changed'))
  }
  return <>
    <button type="button" className={`inline-flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${blocked ? 'bg-duo-green-soft text-duo-green-dark hover:bg-emerald-100' : 'bg-red-50 text-red-700 hover:bg-red-100'}`} disabled={busy} onClick={() => { setError(''); setOpen(true) }}><Icon className="h-4 w-4" aria-hidden="true" />{blocked ? 'Bỏ chặn' : 'Chặn'}</button>
    <dialog ref={dialog} aria-labelledby={titleId} aria-describedby={descriptionId} onCancel={(event) => { if (busy) event.preventDefault(); else setOpen(false) }} className="m-auto w-[calc(100%_-_2rem)] max-w-md overflow-y-auto rounded-3xl border-0 bg-white p-0 text-duo-ink shadow-2xl backdrop:bg-slate-950/40 backdrop:backdrop-blur-sm">
      <div className="p-6 sm:p-7"><div className="flex items-start justify-between gap-3"><div className={`flex h-14 w-14 items-center justify-center rounded-2xl ${blocked ? 'bg-duo-green-soft text-duo-green-dark' : 'bg-red-50 text-red-600'}`}><Icon className="h-7 w-7" aria-hidden="true" /></div><button type="button" aria-label="Đóng xác nhận" disabled={busy} className="rounded-xl p-2 text-duo-mute hover:bg-duo-mist" onClick={() => setOpen(false)}><X className="h-5 w-5" /></button></div>
        <h2 id={titleId} className="mt-4 break-words text-xl font-black">{blocked ? 'Bỏ chặn' : 'Chặn'} {displayName}?</h2>
        <p id={descriptionId} className="mt-3 text-sm font-medium leading-relaxed text-duo-mute">{blocked ? 'Bạn có thể tiếp tục cuộc trò chuyện đã được chấp nhận nếu cả hai tài khoản đều có quyền nhắn tin. Lời mời đã hủy sẽ không tự khôi phục.' : 'Hai bên sẽ không thể nhắn tin hoặc tương tác với nhau trong Cộng đồng. Lịch sử trò chuyện vẫn được giữ lại và bạn có thể bỏ chặn bất cứ lúc nào.'}</p>
        {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}
        <div className="mt-6 flex justify-end gap-3"><button autoFocus type="button" disabled={busy} className="btn-duo-secondary !px-5 !py-2.5" onClick={() => setOpen(false)}>Hủy</button><button type="button" disabled={busy} className={blocked ? 'btn-duo !px-5 !py-2.5' : 'inline-flex items-center justify-center gap-2 rounded-2xl bg-red-600 px-5 py-2.5 text-sm font-extrabold text-white shadow-sm transition-colors hover:bg-red-700 disabled:opacity-50'} onClick={() => void confirm()}>{busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}{busy ? 'Đang xử lý…' : blocked ? 'Bỏ chặn' : 'Chặn thành viên'}</button></div>
      </div>
    </dialog>
    {notice && <div role="status" className="fixed inset-x-4 bottom-24 z-50 mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-emerald-200 bg-white px-4 py-3 shadow-xl md:bottom-6"><CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" aria-hidden="true" /><p className="min-w-0 flex-1 break-words text-sm font-bold text-duo-ink">{notice}</p><button type="button" aria-label="Đóng thông báo" className="rounded-lg p-1 text-duo-mute hover:bg-duo-mist" onClick={() => setNotice('')}><X className="h-4 w-4" /></button></div>}
  </>
}
