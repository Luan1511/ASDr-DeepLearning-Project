import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  ArrowLeft,
  Heart,
  Bookmark,
  Share2,
  Trash2,
  Pin,
  Send,
  EyeOff,
  CornerDownRight,
  Loader2,
  Shield,
  MessageCircle,
} from 'lucide-react'
import { DashboardLayout } from '../layouts/DashboardLayout'
import type { CommunityPost } from '../lib/communityTypes'
import { CATEGORY_INFO } from '../lib/communityTypes'
import {
  fetchCommunityPost,
  toggleLikePost,
  toggleBookmarkPost,
  deleteCommunityPost,
  togglePinPost,
  createComment,
  deleteComment,
} from '../lib/community'
import { AuthorAvatar } from '../components/community/AuthorAvatar'
import { CommunityGuidelinesCard } from '../components/community/CommunityGuidelinesCard'
import { formatDateTime } from '../lib/format'
import { useAuth } from '../state/auth'

export function CommunityPostDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()

  const [post, setPost] = useState<CommunityPost | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Actions state
  const [likeBusy, setLikeBusy] = useState(false)
  const [bookmarkBusy, setBookmarkBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  // New comment state
  const [commentText, setCommentText] = useState('')
  const [commentAnonymous, setCommentAnonymous] = useState(false)
  const [commentLoading, setCommentLoading] = useState(false)
  const [commentError, setCommentError] = useState<string | null>(null)

  // Reply state
  const [replyTarget, setReplyTarget] = useState<{ id: string; authorName: string } | null>(null)
  const [replyText, setReplyText] = useState('')
  const [replyAnonymous, setReplyAnonymous] = useState(false)
  const [replyLoading, setReplyLoading] = useState(false)

  const loadDetail = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      const data = await fetchCommunityPost(id)
      setPost(data)
    } catch {
      setError('Không thể tải bài viết hoặc bài viết đã bị xoá.')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void loadDetail()
  }, [loadDetail])

  async function handleLike() {
    if (!post || likeBusy) return
    setLikeBusy(true)
    try {
      const res = await toggleLikePost(post.id)
      setPost((p) => p && { ...p, isLiked: res.liked, likesCount: res.likesCount })
    } catch {
      // ignore
    } finally {
      setLikeBusy(false)
    }
  }

  async function handleBookmark() {
    if (!post || bookmarkBusy) return
    setBookmarkBusy(true)
    try {
      const res = await toggleBookmarkPost(post.id)
      setPost((p) => p && { ...p, isBookmarked: res.bookmarked })
    } catch {
      // ignore
    } finally {
      setBookmarkBusy(false)
    }
  }

  async function handleShare() {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // ignore
    }
  }

  async function handlePin() {
    if (!post) return
    try {
      const pinned = await togglePinPost(post.id)
      setPost((p) => p && { ...p, isPinned: pinned })
    } catch {
      // ignore
    }
  }

  async function handleDeletePost() {
    if (!post) return
    if (!window.confirm('Bạn có chắc chắn muốn xoá bài viết này?')) return
    try {
      await deleteCommunityPost(post.id)
      navigate('/community')
    } catch {
      alert('Không thể xoá bài viết.')
    }
  }

  async function handleSubmitComment(e: React.FormEvent) {
    e.preventDefault()
    if (!post || !commentText.trim()) return
    setCommentError(null)
    setCommentLoading(true)
    try {
      const newComment = await createComment(post.id, {
        content: commentText.trim(),
        isAnonymous: commentAnonymous,
      })
      setPost((p) =>
        p
          ? {
              ...p,
              commentsCount: p.commentsCount + 1,
              comments: [...(p.comments ?? []), newComment],
            }
          : p,
      )
      setCommentText('')
      setCommentAnonymous(false)
    } catch (err: any) {
      setCommentError(err?.response?.data?.detail || 'Không thể gửi bình luận.')
    } finally {
      setCommentLoading(false)
    }
  }

  async function handleSubmitReply(parentId: string) {
    if (!post || !replyText.trim()) return
    setReplyLoading(true)
    try {
      const newReply = await createComment(post.id, {
        content: replyText.trim(),
        isAnonymous: replyAnonymous,
        parentId,
      })
      setPost((p) => {
        if (!p) return p
        const updatedComments = (p.comments ?? []).map((c) => {
          if (c.id === parentId) {
            return { ...c, replies: [...(c.replies ?? []), newReply] }
          }
          return c
        })
        return {
          ...p,
          commentsCount: p.commentsCount + 1,
          comments: updatedComments,
        }
      })
      setReplyText('')
      setReplyTarget(null)
      setReplyAnonymous(false)
    } catch {
      alert('Không thể gửi phản hồi.')
    } finally {
      setReplyLoading(false)
    }
  }

  async function handleDeleteComment(commentId: string, parentId?: string | null) {
    if (!post) return
    if (!window.confirm('Bạn có chắc chắn muốn xoá bình luận này?')) return
    try {
      await deleteComment(commentId)
      setPost((p) => {
        if (!p) return p
        if (parentId) {
          const updated = (p.comments ?? []).map((c) => {
            if (c.id === parentId) {
              return { ...c, replies: (c.replies ?? []).filter((r) => r.id !== commentId) }
            }
            return c
          })
          return { ...p, commentsCount: Math.max(0, p.commentsCount - 1), comments: updated }
        }
        return {
          ...p,
          commentsCount: Math.max(0, p.commentsCount - 1),
          comments: (p.comments ?? []).filter((c) => c.id !== commentId),
        }
      })
    } catch {
      alert('Không thể xoá bình luận.')
    }
  }

  const cat = post ? CATEGORY_INFO[post.category] ?? CATEGORY_INFO.STORY : null
  const isAdmin = user?.role === 'ADMIN'

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Navigation Bar */}
        <div className="flex items-center justify-between">
          <Link
            to="/community"
            className="inline-flex items-center gap-2 text-sm font-extrabold text-duo-mute hover:text-duo-ink transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Quay lại Cộng đồng</span>
          </Link>
        </div>

        {error && (
          <div className="card-duo p-12 text-center">
            <div className="text-red-600 font-extrabold">{error}</div>
            <Link to="/community" className="btn-duo mt-4 text-xs">
              Về trang cộng đồng
            </Link>
          </div>
        )}

        {loading && (
          <div className="card-duo flex flex-col items-center justify-center p-16 text-duo-mute">
            <Loader2 className="h-8 w-8 animate-spin text-duo-green" />
            <span className="mt-3 text-sm font-extrabold">Đang tải chi tiết bài viết...</span>
          </div>
        )}

        {post && cat && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
            {/* Main Post & Comments */}
            <div className="space-y-6">
              {/* Main Post Card */}
              <article className="card-duo p-6 space-y-4">
                {/* Meta header */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-duo-line/60 pb-4">
                  <div className="flex items-center gap-2">
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

                  {post.canManage && (
                    <div className="flex items-center gap-1.5">
                      {isAdmin && (
                        <button
                          type="button"
                          onClick={handlePin}
                          className="flex items-center gap-1 rounded-xl bg-duo-mist px-2.5 py-1.5 text-xs font-extrabold text-duo-ink hover:bg-duo-green-soft"
                          title="Ghim/Bỏ ghim"
                        >
                          <Pin className="h-3.5 w-3.5" />
                          <span>{post.isPinned ? 'Bỏ ghim' : 'Ghim'}</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={handleDeletePost}
                        className="flex items-center gap-1 rounded-xl bg-red-50 px-2.5 py-1.5 text-xs font-extrabold text-red-600 hover:bg-red-100"
                        title="Xoá bài viết"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        <span>Xoá</span>
                      </button>
                    </div>
                  )}
                </div>

                {/* Author Info */}
                <div className="flex items-center gap-3">
                  <AuthorAvatar author={post.author} size="lg" />
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-base font-black text-duo-ink">
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
                      Đăng lúc {formatDateTime(post.createdAt)}
                    </div>
                  </div>
                </div>

                {/* Title & Body */}
                <div className="pt-2">
                  <h1 className="text-xl font-black text-duo-ink md:text-2xl leading-snug">
                    {post.title}
                  </h1>
                  <div className="mt-4 whitespace-pre-line text-sm font-semibold leading-relaxed text-duo-ink/90">
                    {post.content}
                  </div>
                </div>

                {/* Bottom Interaction Bar */}
                <div className="flex items-center justify-between border-t border-duo-line/60 pt-4 text-xs font-extrabold text-duo-mute">
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={handleLike}
                      disabled={likeBusy}
                      className={[
                        'flex items-center gap-2 rounded-2xl px-4 py-2 transition-all',
                        post.isLiked
                          ? 'bg-rose-50 text-rose-600 font-black shadow-sm'
                          : 'bg-duo-mist text-duo-mute hover:text-duo-ink',
                      ].join(' ')}
                    >
                      <Heart
                        className={[
                          'h-4 w-4 transition-transform active:scale-125',
                          post.isLiked ? 'fill-current stroke-rose-600' : 'stroke-[2.2]',
                        ].join(' ')}
                      />
                      <span>{post.likesCount > 0 ? `${post.likesCount} đồng cảm` : 'Đồng cảm'}</span>
                    </button>

                    <div className="flex items-center gap-1.5 px-3 py-2 text-duo-mute">
                      <MessageCircle className="h-4 w-4" />
                      <span>{post.commentsCount} bình luận</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleBookmark}
                      disabled={bookmarkBusy}
                      className={[
                        'flex items-center gap-1.5 rounded-2xl px-3 py-2 transition-colors',
                        post.isBookmarked
                          ? 'bg-amber-50 text-amber-700 font-black'
                          : 'bg-duo-mist hover:text-duo-ink',
                      ].join(' ')}
                    >
                      <Bookmark className={`h-4 w-4 stroke-[2.2] ${post.isBookmarked ? 'fill-current' : ''}`} />
                      <span>{post.isBookmarked ? 'Đã lưu' : 'Lưu'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleShare}
                      className="flex items-center gap-1.5 rounded-2xl bg-duo-mist px-3 py-2 text-duo-mute hover:text-duo-ink transition-colors"
                      title="Sao chép liên kết"
                    >
                      <Share2 className="h-4 w-4" />
                      <span>{copied ? 'Đã sao chép!' : 'Chia sẻ'}</span>
                    </button>
                  </div>
                </div>
              </article>

              {/* Comments Section */}
              <div className="card-duo p-6 space-y-6">
                <div className="flex items-center justify-between border-b border-duo-line/60 pb-3">
                  <div className="text-base font-black text-duo-ink">
                    Bình luận ({post.commentsCount})
                  </div>
                </div>

                {/* Main Comment Input Form */}
                <form onSubmit={handleSubmitComment} className="space-y-3">
                  {commentError && (
                    <div className="rounded-xl bg-red-50 p-2.5 text-xs font-bold text-red-700">
                      {commentError}
                    </div>
                  )}
                  <textarea
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    placeholder="Viết lời động viên, chia sẻ kinh nghiệm hoặc thảo luận..."
                    rows={3}
                    maxLength={2000}
                    className="input-duo leading-relaxed"
                    required
                  />

                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <label className="flex items-center gap-2 cursor-pointer text-xs font-extrabold text-duo-mute hover:text-duo-ink">
                      <input
                        type="checkbox"
                        checked={commentAnonymous}
                        onChange={(e) => setCommentAnonymous(e.target.checked)}
                        className="h-3.5 w-3.5 rounded accent-duo-green"
                      />
                      <EyeOff className="h-3.5 w-3.5 text-amber-600" />
                      <span>Bình luận ẩn danh</span>
                    </label>

                    <button
                      type="submit"
                      disabled={commentLoading || !commentText.trim()}
                      className="btn-duo text-xs"
                    >
                      {commentLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4" />
                      )}
                      <span>Gửi bình luận</span>
                    </button>
                  </div>
                </form>

                {/* Comments List */}
                <div className="space-y-4 pt-2">
                  {(!post.comments || post.comments.length === 0) && (
                    <div className="py-6 text-center text-xs font-semibold text-duo-mute">
                      Chưa có bình luận nào. Hãy là người đầu tiên chia sẻ cảm nghĩ nhé!
                    </div>
                  )}

                  {post.comments?.map((comment) => (
                    <div
                      key={comment.id}
                      className="space-y-3 rounded-2xl bg-duo-mist/40 p-4 transition-colors"
                    >
                      {/* Comment Header */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          <AuthorAvatar author={comment.author} size="sm" />
                          <div>
                            <div className="text-xs font-black text-duo-ink">
                              {comment.author.name}
                            </div>
                            <div className="text-[10px] font-semibold text-duo-mute">
                              {formatDateTime(comment.createdAt)}
                            </div>
                          </div>
                        </div>

                        {comment.canManage && (
                          <button
                            type="button"
                            onClick={() => handleDeleteComment(comment.id)}
                            className="rounded-lg p-1 text-duo-mute hover:text-red-600"
                            title="Xoá bình luận"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>

                      {/* Comment Body */}
                      <p className="whitespace-pre-line text-xs font-semibold leading-relaxed text-duo-ink/90">
                        {comment.content}
                      </p>

                      {/* Reply Button Trigger */}
                      <div className="flex items-center gap-3 pt-1">
                        <button
                          type="button"
                          onClick={() => {
                            if (replyTarget?.id === comment.id) {
                              setReplyTarget(null)
                            } else {
                              setReplyTarget({ id: comment.id, authorName: comment.author.name })
                              setReplyText('')
                            }
                          }}
                          className="flex items-center gap-1 text-[11px] font-black text-duo-green hover:underline"
                        >
                          <CornerDownRight className="h-3 w-3" />
                          <span>Trả lời</span>
                        </button>
                      </div>

                      {/* Inline Reply Composer */}
                      {replyTarget?.id === comment.id && (
                        <div className="mt-3 space-y-2 rounded-xl bg-white p-3 border border-duo-line">
                          <div className="text-[11px] font-extrabold text-duo-mute">
                            Trả lời {replyTarget.authorName}:
                          </div>
                          <textarea
                            value={replyText}
                            onChange={(e) => setReplyText(e.target.value)}
                            placeholder="Nhập nội dung phản hồi..."
                            rows={2}
                            maxLength={2000}
                            className="input-duo text-xs"
                            autoFocus
                          />
                          <div className="flex items-center justify-between">
                            <label className="flex items-center gap-1.5 cursor-pointer text-[11px] font-extrabold text-duo-mute">
                              <input
                                type="checkbox"
                                checked={replyAnonymous}
                                onChange={(e) => setReplyAnonymous(e.target.checked)}
                                className="h-3 w-3 rounded accent-duo-green"
                              />
                              <span>Ẩn danh</span>
                            </label>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => setReplyTarget(null)}
                                className="rounded-xl px-2.5 py-1 text-[11px] font-extrabold text-duo-mute hover:bg-duo-mist"
                              >
                                Hủy
                              </button>
                              <button
                                type="button"
                                onClick={() => handleSubmitReply(comment.id)}
                                disabled={replyLoading || !replyText.trim()}
                                className="btn-duo px-3 py-1 text-[11px]"
                              >
                                {replyLoading ? 'Đang gửi...' : 'Gửi'}
                              </button>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Nested Replies */}
                      {comment.replies && comment.replies.length > 0 && (
                        <div className="ml-4 mt-3 space-y-3 border-l-2 border-duo-line/80 pl-3">
                          {comment.replies.map((reply) => (
                            <div key={reply.id} className="space-y-1.5">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <AuthorAvatar author={reply.author} size="sm" />
                                  <div>
                                    <div className="text-[11px] font-black text-duo-ink">
                                      {reply.author.name}
                                    </div>
                                    <div className="text-[9px] font-semibold text-duo-mute">
                                      {formatDateTime(reply.createdAt)}
                                    </div>
                                  </div>
                                </div>
                                {reply.canManage && (
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteComment(reply.id, comment.id)}
                                    className="rounded-lg p-1 text-duo-mute hover:text-red-600"
                                    title="Xoá phản hồi"
                                  >
                                    <Trash2 className="h-3 w-3" />
                                  </button>
                                )}
                              </div>
                              <p className="whitespace-pre-line text-xs font-semibold leading-relaxed text-duo-ink/90 pl-1">
                                {reply.content}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Right Sidebar */}
            <div className="space-y-4">
              <CommunityGuidelinesCard />
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  )
}
