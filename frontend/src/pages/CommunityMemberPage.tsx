import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { DashboardLayout } from '../layouts/DashboardLayout'
import { PostCard } from '../components/community/PostCard'
import type { CommunityPost } from '../lib/communityTypes'
import { api } from '../lib/api'
import { StartConversationButton } from '../components/community/StartConversationButton'
import { BlockMemberAction } from '../components/community/BlockMemberAction'

type Member = { userId: string; displayName: string; bio: string; followers: number; following: number; posts: number; isFollowing: boolean; isSelf: boolean }
export function CommunityMemberPage() {
  const { id = '' } = useParams()
  const [member, setMember] = useState<Member | null>(null)
  const [posts, setPosts] = useState<CommunityPost[]>([])
  const [error, setError] = useState('')
  const [blocked, setBlocked] = useState(false)
  useEffect(() => { let stale = false; Promise.all([api.get(`/community/members/${id}`), api.get('/community/posts', { params: { memberId: id, limit: 30 } })]).then(([m, p]) => { if (!stale) { setMember(m.data.profile); setPosts(p.data.posts) } }).catch(() => !stale && setError('Không tìm thấy thành viên hoặc họ đã bị chặn.')); return () => { stale = true } }, [id])
  async function toggleFollow() { if (!member) return; try { const { data } = await api.post(`/community/members/${id}/follow`); setMember({ ...member, isFollowing: data.following, followers: member.followers + (data.following ? 1 : -1) }) } catch { setError('Không thực hiện được thao tác theo dõi.') } }

  return <DashboardLayout><main className="mx-auto max-w-3xl space-y-4"><section className="card-duo p-5"><h1 className="text-xl font-black">{member?.displayName ?? 'Hồ sơ thành viên'}</h1>{member && <><p className="mt-2 text-sm">{member.bio || 'Chưa có phần giới thiệu.'}</p><p className="mt-2 text-xs text-duo-mute">{member.followers} người theo dõi · {member.following} đang theo dõi · {member.posts} bài viết</p><div className="mt-3 flex gap-2">{!member.isSelf && <>{!blocked && <button className="btn-duo" onClick={() => void toggleFollow()}>{member.isFollowing ? 'Bỏ theo dõi' : 'Theo dõi'}</button>}<BlockMemberAction memberId={member.userId} displayName={member.displayName} blocked={blocked} onChanged={(value) => { setBlocked(value); if (value) setPosts([]) }} /></>}</div></>}</section>{error && <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm">{error}</p>}{member && !member.isSelf && !blocked && <StartConversationButton recipientId={member.userId} displayName={member.displayName} />}{posts.map((post) => <PostCard key={post.id} post={post} />)}</main></DashboardLayout>
}
