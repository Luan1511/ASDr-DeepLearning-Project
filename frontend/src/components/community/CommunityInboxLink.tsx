import { useCallback, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../lib/api'
import { useChatPolling } from '../../lib/useChatPolling'
import { useAuth } from '../../state/useAuth'

export function CommunityInboxLink() {
  const { user } = useAuth()
  const allowed = user?.role === 'USER' && !user.doctor
  const [unread, setUnread] = useState(0)
  const [invitations, setInvitations] = useState(0)
  const refresh = useCallback(async () => {
    if (!allowed) return
    const { data } = await api.get('/community/conversations/unread')
    setUnread(data.unread); setInvitations(data.invitations)
  }, [allowed])
  useChatPolling(refresh, 15000)
  if (!allowed) return null
  return <Link to="/community/messages" className="inline-flex items-center gap-2 rounded-xl bg-duo-green-soft px-3 py-2 text-xs font-bold text-duo-green-dark">Tin nhắn{unread > 0 && <span aria-label={`${unread} tin chưa đọc`} className="rounded-full bg-duo-green px-2 text-white">{unread}</span>}{invitations > 0 && <span className="text-[10px]">{invitations} lời mời</span>}</Link>
}
