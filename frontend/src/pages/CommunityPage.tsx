import { useState, useEffect, useCallback } from 'react'
import {
  Search,
  Plus,
  Bookmark,
  Sparkles,
  TrendingUp,
  Clock,
  Loader2,
  X,
  MessageSquareHeart,
} from 'lucide-react'
import { DashboardLayout } from '../layouts/DashboardLayout'
import type { CommunityPost, PostCategory } from '../lib/communityTypes'
import { CATEGORY_INFO } from '../lib/communityTypes'
import { fetchCommunityPosts, fetchBookmarkedPosts } from '../lib/community'
import { PostCard } from '../components/community/PostCard'
import { CreatePostModal } from '../components/community/CreatePostModal'
import { CommunityGuidelinesCard } from '../components/community/CommunityGuidelinesCard'
import { useAuth } from '../state/auth'

const CATEGORIES: PostCategory[] = ['STORY', 'PARENTING', 'LIFESTYLE', 'EDUCATION', 'QA']

export function CommunityPage() {
  const { user } = useAuth()
  const [posts, setPosts] = useState<CommunityPost[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL')
  const [sort, setSort] = useState<'latest' | 'popular'>('latest')
  const [viewTab, setViewTab] = useState<'feed' | 'bookmarks'>('feed')
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadPosts = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      if (viewTab === 'bookmarks') {
        const bookmarked = await fetchBookmarkedPosts()
        setPosts(bookmarked)
      } else {
        const res = await fetchCommunityPosts({
          category: selectedCategory === 'ALL' ? undefined : selectedCategory,
          sort,
          search: search || undefined,
        })
        setPosts(res.posts)
      }
    } catch {
      setError('Không thể tải bài viết. Vui lòng kiểm tra lại kết nối.')
    } finally {
      setLoading(false)
    }
  }, [viewTab, selectedCategory, sort, search])

  useEffect(() => {
    void loadPosts()
  }, [loadPosts])

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSearch(searchInput.trim())
  }

  function handlePostCreated(newPost: CommunityPost) {
    setPosts((prev) => [newPost, ...prev])
  }

  function handlePostDeleted(id: string) {
    setPosts((prev) => prev.filter((p) => p.id !== id))
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Banner Header */}
        <div className="card-duo overflow-hidden bg-gradient-to-r from-duo-green to-emerald-700 p-6 text-white shadow-lg md:p-8">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 rounded-xl bg-white/20 px-3 py-1 text-xs font-black backdrop-blur-sm">
              <MessageSquareHeart className="h-4 w-4" />
              <span>Góc chia sẻ & Đồng hành</span>
            </div>
            <h1 className="mt-3 text-2xl font-black md:text-3xl">
              Cộng đồng Phụ huynh AIMBRACE
            </h1>
            <p className="mt-2 text-sm font-semibold text-emerald-100 leading-relaxed">
              Nơi cha mẹ cùng chia sẻ kinh nghiệm can thiệp sớm, tâm sự những trăn trở và tiếp thêm niềm tin trên hành trình phát triển của con.
            </p>
          </div>
        </div>

        {/* Quick Post Creator Bar */}
        <div className="card-duo flex items-center justify-between gap-4 p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-duo-green-soft text-duo-green-dark">
              <Sparkles className="h-5 w-5 stroke-[2.5]" />
            </div>
            <div className="text-sm font-black text-duo-ink">
              Bạn có điều gì muốn tâm sự hoặc chia sẻ cùng các cha mẹ khác hôm nay?
            </div>
          </div>
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="btn-duo flex-shrink-0 text-xs"
          >
            <Plus className="h-4 w-4" />
            <span>Đăng bài mới</span>
          </button>
        </div>

        {/* Filter & View Tabs */}
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* View Switcher: Feed / Bookmarks */}
            <div className="flex rounded-2xl bg-duo-mist p-1">
              <button
                type="button"
                onClick={() => setViewTab('feed')}
                className={[
                  'rounded-xl px-4 py-2 text-xs font-black transition-all',
                  viewTab === 'feed'
                    ? 'bg-white text-duo-ink shadow-sm'
                    : 'text-duo-mute hover:text-duo-ink',
                ].join(' ')}
              >
                Tất cả bài viết
              </button>
              <button
                type="button"
                onClick={() => setViewTab('bookmarks')}
                className={[
                  'flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-black transition-all',
                  viewTab === 'bookmarks'
                    ? 'bg-white text-duo-ink shadow-sm'
                    : 'text-duo-mute hover:text-duo-ink',
                ].join(' ')}
              >
                <Bookmark className="h-3.5 w-3.5" />
                <span>Bài viết đã lưu</span>
              </button>
            </div>

            {/* Sort Switcher (only for Feed) */}
            {viewTab === 'feed' && (
              <div className="flex items-center gap-2">
                <span className="text-xs font-extrabold text-duo-mute">Sắp xếp:</span>
                <button
                  type="button"
                  onClick={() => setSort('latest')}
                  className={[
                    'flex items-center gap-1 rounded-xl px-3 py-1.5 text-xs font-extrabold transition-all',
                    sort === 'latest'
                      ? 'bg-duo-green-soft text-duo-green-dark'
                      : 'bg-duo-mist text-duo-mute hover:text-duo-ink',
                  ].join(' ')}
                >
                  <Clock className="h-3.5 w-3.5" />
                  <span>Mới nhất</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSort('popular')}
                  className={[
                    'flex items-center gap-1 rounded-xl px-3 py-1.5 text-xs font-extrabold transition-all',
                    sort === 'popular'
                      ? 'bg-duo-green-soft text-duo-green-dark'
                      : 'bg-duo-mist text-duo-mute hover:text-duo-ink',
                  ].join(' ')}
                >
                  <TrendingUp className="h-3.5 w-3.5" />
                  <span>Nhiều quan tâm</span>
                </button>
              </div>
            )}
          </div>

          {/* Search Bar & Category Pills (only for Feed) */}
          {viewTab === 'feed' && (
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              {/* Category Pills */}
              <div className="flex flex-wrap items-center gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none]">
                <button
                  type="button"
                  onClick={() => setSelectedCategory('ALL')}
                  className={[
                    'rounded-xl px-3 py-1.5 text-xs font-black transition-all',
                    selectedCategory === 'ALL'
                      ? 'bg-duo-green text-white shadow-brand'
                      : 'bg-duo-mist text-duo-mute hover:bg-duo-mist/80 hover:text-duo-ink',
                  ].join(' ')}
                >
                  Tất cả chủ đề
                </button>
                {CATEGORIES.map((catKey) => {
                  const info = CATEGORY_INFO[catKey]
                  const isSelected = selectedCategory === catKey
                  return (
                    <button
                      key={catKey}
                      type="button"
                      onClick={() => setSelectedCategory(catKey)}
                      className={[
                        'inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-extrabold transition-all',
                        isSelected
                          ? `${info.bg} ${info.text} border-2 ${info.border} font-black shadow-sm`
                          : 'bg-duo-mist text-duo-mute hover:text-duo-ink border-2 border-transparent',
                      ].join(' ')}
                    >
                      <span>{info.icon}</span>
                      <span>{info.label}</span>
                    </button>
                  )
                })}
              </div>

              {/* Search Form */}
              <form onSubmit={handleSearchSubmit} className="relative min-w-[240px]">
                <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-duo-mute" />
                <input
                  type="text"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="Tìm kiếm bài viết..."
                  className="input-duo pl-9 pr-8 text-xs"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchInput('')
                      setSearch('')
                    }}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-duo-mute hover:text-duo-ink"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </form>
            </div>
          )}
        </div>

        {/* Content Grid: Posts Stream + Right Sidebar */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
          {/* Main Feed */}
          <div className="space-y-4">
            {error && (
              <div className="rounded-2xl bg-red-50 p-4 text-center text-sm font-bold text-red-700">
                {error}
              </div>
            )}

            {loading && (
              <div className="card-duo flex flex-col items-center justify-center p-12 text-duo-mute">
                <Loader2 className="h-8 w-8 animate-spin text-duo-green" />
                <span className="mt-3 text-sm font-extrabold">Đang tải bài viết...</span>
              </div>
            )}

            {!loading && posts.length === 0 && (
              <div className="card-duo p-12 text-center">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-duo-mist text-2xl">
                  📝
                </div>
                <h3 className="mt-3 text-base font-black text-duo-ink">Chưa có bài viết nào</h3>
                <p className="mt-1 text-xs font-semibold text-duo-mute">
                  {viewTab === 'bookmarks'
                    ? 'Bạn chưa lưu bài viết nào. Hãy bấm biểu tượng lưu ở các bài viết hay để đọc lại sau nhé.'
                    : 'Hãy là người đầu tiên chia sẻ câu chuyện hoặc đặt câu hỏi cho cộng đồng!'}
                </p>
                {viewTab === 'feed' && (
                  <button
                    type="button"
                    onClick={() => setModalOpen(true)}
                    className="btn-duo mt-4 text-xs"
                  >
                    <Plus className="h-4 w-4" />
                    <span>Đăng bài đầu tiên</span>
                  </button>
                )}
              </div>
            )}

            {!loading && posts.map((post) => (
              <PostCard
                key={post.id}
                post={post}
                onDeleted={handlePostDeleted}
                isAdmin={user?.role === 'ADMIN'}
              />
            ))}
          </div>

          {/* Right Sidebar */}
          <div className="space-y-4">
            <CommunityGuidelinesCard />
          </div>
        </div>

        {/* Create Post Modal */}
        <CreatePostModal
          isOpen={modalOpen}
          onClose={() => setModalOpen(false)}
          onCreated={handlePostCreated}
        />
      </div>
    </DashboardLayout>
  )
}
