import { useCallback, useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { useChatPolling } from '../../lib/useChatPolling'
import { BlockMemberAction } from './BlockMemberAction'

type BlockedMember = { id: string; displayName: string; createdAt: string }
export function BlockedMembersPanel() {
  const [open, setOpen] = useState(false)
  const [members, setMembers] = useState<BlockedMember[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), 5000)
    return () => window.clearTimeout(timer)
  }, [notice])
  const load = useCallback(async () => {
    if (!open) return
    try { const { data } = await api.get('/community/blocks'); setMembers(data.members); setLoaded(true); setError('') }
    catch { setError('Không tải được danh sách đã chặn.'); throw new Error('BLOCK_LIST_UNAVAILABLE') }
  }, [open])
  useChatPolling(load, 15000)
  return <section className="card-duo p-4"><button type="button" className="text-sm font-bold text-duo-ink" aria-expanded={open} onClick={() => setOpen((value) => !value)}>Tài khoản đã chặn {open ? '▴' : '▾'}</button>{notice && <p role="status" className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">{notice}</p>}{open && <div className="mt-3 space-y-2">{error && <p role="alert" className="text-xs text-red-700">{error}<button type="button" className="ml-2 underline" onClick={() => void load().catch(() => undefined)}>Thử lại</button></p>}{!loaded && !error && <p role="status" className="text-xs">Đang tải…</p>}{loaded && members.length === 0 && !error && <p className="text-sm text-duo-mute">Bạn chưa chặn thành viên nào.</p>}{members.map((member) => <div key={member.id} className="flex items-center justify-between gap-3 rounded-xl bg-duo-mist p-3"><div className="min-w-0"><strong className="break-words text-sm">{member.displayName}</strong><p className="text-xs text-duo-mute">Đã chặn từ {new Date(member.createdAt).toLocaleDateString('vi-VN')}</p></div><BlockMemberAction memberId={member.id} displayName={member.displayName} blocked onNotice={setNotice} onChanged={() => { void load().catch(() => undefined) }} /></div>)}</div>}</section>
}
