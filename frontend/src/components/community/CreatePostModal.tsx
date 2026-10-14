import { useState } from 'react'
import { X, Send, EyeOff, Loader2 } from 'lucide-react'
import type { PostCategory, CommunityPost } from '../../lib/communityTypes'
import { CATEGORY_INFO } from '../../lib/communityTypes'
import { createCommunityPost } from '../../lib/community'

const CATEGORIES: PostCategory[] = ['STORY', 'PARENTING', 'LIFESTYLE', 'EDUCATION', 'QA']

const PLACEHOLDERS: Record<PostCategory, string> = {
  STORY: 'Chia sẻ cảm xúc, hành trình nuôi dạy con, những lúc khó khăn hay niềm vui nhỏ của gia đình bạn...',
  PARENTING: 'Chia sẻ các bài tập, mẹo dạy con giao tiếp, cách xử lý hành vi hay phương pháp bạn thấy hiệu quả...',
  LIFESTYLE: 'Chia sẻ kinh nghiệm về chế độ ăn, thói quen ngủ, xử lý nhạy cảm âm thanh/ánh sáng...',
  EDUCATION: 'Kinh nghiệm chọn trường mầm non hòa nhập, trung tâm can thiệp, làm việc với thầy cô...',
  QA: 'Đặt câu hỏi cần cộng đồng tư vấn kinh nghiệm, quy trình đi khám, địa chỉ đánh giá uy tín...',
}

export function CreatePostModal({
  isOpen,
  onClose,
  onCreated,
}: {
  isOpen: boolean
  onClose: () => void
  onCreated: (post: CommunityPost) => void
}) {
  const [category, setCategory] = useState<PostCategory>('STORY')
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [isAnonymous, setIsAnonymous] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!isOpen) return null

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (title.trim().length < 3) {
      setError('Tiêu đề cần có ít nhất 3 ký tự.')
      return
    }
    if (content.trim().length < 10) {
      setError('Nội dung cần có ít nhất 10 ký tự.')
      return
    }

    setLoading(true)
    try {
      const newPost = await createCommunityPost({
        title: title.trim(),
        content: content.trim(),
        category,
        isAnonymous,
      })
      onCreated(newPost)
      onClose()
      setTitle('')
      setContent('')
      setIsAnonymous(false)
    } catch {
      setError('Không thể đăng bài viết. Vui lòng thử lại sau.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="card-duo w-full max-w-xl max-h-[90vh] overflow-y-auto p-6 shadow-2xl">
        <div className="flex items-center justify-between border-b border-duo-line/60 pb-3">
          <div className="text-lg font-black text-duo-ink">Tạo bài viết chia sẻ</div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-1 text-duo-mute hover:bg-duo-mist hover:text-duo-ink"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {error && (
          <div className="mt-4 rounded-2xl bg-red-50 p-3 text-xs font-bold text-red-700">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          {/* Category selection */}
          <div>
            <label className="block text-xs font-extrabold uppercase tracking-wide text-duo-mute">
              Chủ đề bài viết
            </label>
            <div className="mt-2 flex flex-wrap gap-2">
              {CATEGORIES.map((catKey) => {
                const info = CATEGORY_INFO[catKey]
                const isSelected = category === catKey
                return (
                  <button
                    key={catKey}
                    type="button"
                    onClick={() => setCategory(catKey)}
                    className={[
                      'inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-extrabold transition-all',
                      isSelected
                        ? 'bg-duo-green-soft text-duo-green-dark shadow-ring-green border-2 border-duo-green'
                        : 'bg-duo-mist text-duo-mute hover:text-duo-ink border-2 border-transparent',
                    ].join(' ')}
                  >
                    <span>{info.icon}</span>
                    <span>{info.label}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Title */}
          <div>
            <label className="block text-xs font-extrabold uppercase tracking-wide text-duo-mute">
              Tiêu đề bài viết
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Tóm tắt ngắn gọn câu chuyện hoặc câu hỏi của bạn..."
              maxLength={200}
              className="input-duo mt-1.5"
              required
            />
          </div>

          {/* Content */}
          <div>
            <label className="block text-xs font-extrabold uppercase tracking-wide text-duo-mute">
              Nội dung chi tiết
            </label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={PLACEHOLDERS[category]}
              rows={5}
              maxLength={10000}
              className="input-duo mt-1.5 leading-relaxed"
              required
            />
            <div className="mt-1 text-right text-[11px] font-semibold text-duo-mute">
              {content.length}/10.000 ký tự
            </div>
          </div>

          {/* Anonymous toggle */}
          <div className="rounded-2xl border border-duo-line/80 bg-duo-mist/50 p-3.5">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={isAnonymous}
                onChange={(e) => setIsAnonymous(e.target.checked)}
                className="mt-1 h-4 w-4 rounded accent-duo-green"
              />
              <div className="flex-1">
                <div className="flex items-center gap-1.5 text-sm font-black text-duo-ink">
                  <EyeOff className="h-4 w-4 text-amber-600" />
                  <span>Đăng ẩn danh</span>
                </div>
                <p className="mt-0.5 text-xs font-semibold text-duo-mute">
                  Tên và ảnh của bạn sẽ hiển thị là "Phụ huynh giấu tên" đối với các thành viên khác.
                </p>
              </div>
            </label>
          </div>

          {/* Footer buttons */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="btn-duo-ghost text-xs"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={loading}
              className="btn-duo text-xs"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Đang đăng...</span>
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" />
                  <span>Đăng bài</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
