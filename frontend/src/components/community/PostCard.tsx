import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Heart,
  MessageCircle,
  Bookmark,
  Pin,
  Trash2,
  Shield,
  MoreVertical,
  Flag,
} from 'lucide-react'
import type { CommunityPost } from '../../lib/communityTypes'
import { CATEGORY_INFO } from '../../lib/communityTypes'
import { AuthorAvatar } from './AuthorAvatar'
import { CommunityGallery } from './CommunityGallery'
import { StartConversationButton } from './StartConversationButton'
import { formatDateTime } from '../../lib/format'
import { toggleLikePost, toggleBookmarkPost, deleteCommunityPost, reportCommunityPost, updateCommunityPost } from '../../lib/community'

export function PostCard({
  post: initialPost,
  onDeleted,
}: {
  post: CommunityPost
  onDeleted?: (id: string) => void
  isAdmin?: boolean
}) {
  const navigate = useNavigate()
  const [post, setPost] = useState(initialPost)
  const [likeBusy, setLikeBusy] = useState(false)
  const [bookmarkBusy, setBookmarkBusy] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)

  const cat = CATEGORY_INFO[post.category] ?? CATEGORY_INFO.STORY

  async function handleLike(e: React.MouseEvent) {
    e.stopPropagation()
    if (likeBusy) return
    setLikeBusy(true)
    try {
      const res = await toggleLikePost(post.id)
      setPost((p) => ({
        ...p,
        isLiked: res.liked,
        likesCount: res.likesCount,
      }))
    } catch {
      // ignore
    } finally {
      setLikeBusy(false)
    }
  }

  async function handleBookmark(e: React.MouseEvent) {
    e.stopPropagation()
    if (bookmarkBusy) return
    setBookmarkBusy(true)
    try {
      const res = await toggleBookmarkPost(post.id)
      setPost((p) => ({
        ...p,
        isBookmarked: res.bookmarked,
      }))
    } catch {
      // ignore
    } finally {
      setBookmarkBusy(false)
    }
  }

  async function handleDelete(e: React.MouseEvent) {
    e.stopPropagation()
    setMenuOpen(false)
    if (!window.confirm('Bạn có chắc chắn muốn xoá bài viết này?')) return
    try {
      await deleteCommunityPost(post.id)
      onDeleted?.(post.id)
    } catch {
      alert('Không thể xoá bài viết. Vui lòng thử lại.')
    }
  }

  async function handleReport(e: React.MouseEvent) {
    e.stopPropagation()
    setMenuOpen(false)
    if (!window.confirm('Báo cáo bài viết này để quản trị viên xem xét?')) return
    try { await reportCommunityPost(post.id); window.alert('Đã gửi báo cáo để quản trị viên xem xét.') }
    catch { window.alert('Chưa gửi được báo cáo. Có thể bài này đã được báo cáo trước đó.') }
  }

  async function handleEdit(e: React.MouseEvent) {
    e.stopPropagation(); setMenuOpen(false)
    const title = window.prompt('Sửa tiêu đề bài viết', post.title)
    if (title === null) return
    const content = window.prompt('Sửa nội dung bài viết', post.content)
    if (content === null) return
    try { const updated = await updateCommunityPost(post.id, { title, content }); setPost((old) => ({ ...old, ...updated })) }
    catch { window.alert('Không lưu được thay đổi bài viết.') }
  }

  const isLong = post.content.length > 300
  const displayContent = !expanded && isLong ? `${post.content.slice(0, 300)}...` : post.content

  return (
    <article
      onClick={() => navigate(`/community/post/${post.id}`)}
      className="card-duo-interactive cursor-pointer p-5 transition-all"
    >
      {/* Top row: Category, Pin, and Menu */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 rounded-xl px-2.5 py-1 text-xs font-black ${cat.bg} ${cat.text} ${cat.border} border`}
          >
            <span>{cat.icon}</span>
            <span>{cat.label}</span>
          </span>
          {post.isPinned && (
            <span className="inline-flex items-center gap-1 rounded-xl bg-duo-green-soft px-2.5 py-1 text-xs font-black text-duo-green-dark">
              <Pin className="h-3 w-3 fill-current stroke-[2.5]" />
              <span>Đã ghim</span>
            </span>
          )}
        </div>

        {(
          <div className="relative" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="rounded-xl p-1.5 text-duo-mute hover:bg-duo-mist hover:text-duo-ink"
              onClick={() => setMenuOpen((o) => !o)}
              title="Tuỳ chọn"
            >
              <MoreVertical className="h-4 w-4" />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full z-20 mt-1 min-w-[160px] rounded-2xl bg-white p-1.5 shadow-lg border border-duo-line">
                {!post.author.isSelf && <button type="button" onClick={handleReport} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-extrabold text-amber-700 hover:bg-amber-50"><Flag className="h-3.5 w-3.5" />Báo cáo bài viết</button>}
                {post.canEdit && <button type="button" onClick={handleEdit} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-extrabold text-duo-ink hover:bg-duo-mist">Sửa bài viết</button>}
                {post.canDelete && <button
                  type="button"
                  onClick={handleDelete}
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-extrabold text-red-600 hover:bg-red-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>Xoá bài viết</span>
                </button>}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Author Header */}
      <div className="mt-3 flex items-center gap-3">
        <AuthorAvatar author={post.author} size="md" postId={post.id} postTitle={post.title} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-black text-duo-ink">
              {post.author.name}
            </span>
            {post.author.role === 'ADMIN' && (
              <span className="inline-flex items-center gap-0.5 rounded-md bg-duo-green px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-white">
                <Shield className="h-2.5 w-2.5 stroke-[2.5]" />
                Admin
              </span>
            )}
          </div>
          <div className="text-xs font-semibold text-duo-mute">
            {formatDateTime(post.createdAt)}
          </div>
          {!post.author.isSelf && post.author.id !== 'anonymous' && <button type="button" className="mt-1 text-xs font-bold text-duo-green-dark hover:underline" onClick={(e) => { e.stopPropagation(); navigate(`/community/member/${post.author.id}`) }}>Hồ sơ thành viên</button>}
        </div>
      </div>

      {/* Post Title & Content */}
      {!post.author.isAnonymous && post.author.role === 'USER' && <StartConversationButton recipientId={post.author.id} displayName={post.author.name} postId={post.id} postTitle={post.title} />}
      <div className="mt-3">
        <h2 className="text-base font-black leading-snug text-duo-ink hover:text-duo-green transition-colors">
          {post.title}
        </h2>
        <p className="mt-2 whitespace-pre-line text-sm font-semibold leading-relaxed text-duo-ink/80">
          {displayContent}
        </p>
        {!!post.media?.length && <CommunityGallery media={post.media} />}
        {isLong && !expanded && (
          <button
            type="button"
            className="mt-1 text-xs font-extrabold text-duo-green hover:underline"
            onClick={(e) => {
              e.stopPropagation()
              setExpanded(true)
            }}
          >
            Xem thêm
          </button>
        )}
      </div>

      {/* Actions Bar */}
      <div className="mt-4 flex items-center justify-between border-t border-duo-line/60 pt-3 text-xs font-extrabold text-duo-mute">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={handleLike}
            disabled={likeBusy}
            className={[
              'flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 transition-colors',
              post.isLiked
                ? 'bg-rose-50 text-rose-600 font-black'
                : 'hover:bg-duo-mist hover:text-duo-ink',
            ].join(' ')}
          >
            <Heart
              className={[
                'h-4 w-4 transition-transform active:scale-125',
                post.isLiked ? 'fill-current stroke-rose-600' : 'stroke-[2.2]',
              ].join(' ')}
            />
            <span>{post.likesCount > 0 ? post.likesCount : 'Đồng cảm'}</span>
          </button>

          <Link
            to={`/community/post/${post.id}`}
            onClick={(e) => e.stopPropagation()}
            className="flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 transition-colors hover:bg-duo-mist hover:text-duo-ink"
          >
            <MessageCircle className="h-4 w-4 stroke-[2.2]" />
            <span>{post.commentsCount > 0 ? `${post.commentsCount} bình luận` : 'Bình luận'}</span>
          </Link>
        </div>

        <button
          type="button"
          onClick={handleBookmark}
          disabled={bookmarkBusy}
          className={[
            'flex items-center gap-1 rounded-xl p-1.5 transition-colors',
            post.isBookmarked
              ? 'bg-amber-50 text-amber-700'
              : 'hover:bg-duo-mist hover:text-duo-ink',
          ].join(' ')}
          title={post.isBookmarked ? 'Đã lưu' : 'Lưu bài viết'}
        >
          <Bookmark className={`h-4 w-4 stroke-[2.2] ${post.isBookmarked ? 'fill-current' : ''}`} />
        </button>
      </div>
    </article>
  )
}
