export type PostCategory = 'STORY' | 'PARENTING' | 'LIFESTYLE' | 'EDUCATION' | 'QA'

export interface CommunityAuthor {
  id: string
  name: string
  role: string
  isAnonymous: boolean
  isSelf: boolean
}

export interface CommunityComment {
  id: string
  postId: string
  parentId: string | null
  content: string
  createdAt: string
  author: CommunityAuthor
  canManage: boolean
  replies: CommunityComment[]
}

export interface CommunityPost {
  id: string
  category: PostCategory
  title: string
  content: string
  isPinned: boolean
  likesCount: number
  commentsCount: number
  createdAt: string
  updatedAt: string
  author: CommunityAuthor
  isLiked: boolean
  isBookmarked: boolean
  canManage: boolean
  comments?: CommunityComment[]
}

export interface CommunityPagination {
  page: number
  limit: number
  total: number
  totalPages: number
}

export interface CommunityPostsResponse {
  posts: CommunityPost[]
  pagination: CommunityPagination
}

export const CATEGORY_INFO: Record<
  PostCategory,
  { label: string; icon: string; bg: string; text: string; border: string; desc: string }
> = {
  STORY: {
    label: 'Tâm sự & Lắng nghe',
    icon: '💬',
    bg: 'bg-rose-50',
    text: 'text-rose-700',
    border: 'border-rose-200',
    desc: 'Chia sẻ cảm xúc, nhật ký hành trình cùng con và giải tỏa âu lo.',
  },
  PARENTING: {
    label: 'Kinh nghiệm dạy con',
    icon: '💡',
    bg: 'bg-amber-50',
    text: 'text-amber-800',
    border: 'border-amber-200',
    desc: 'Phương pháp can thiệp sớm, mẹo dạy ngôn ngữ, hành vi tại nhà.',
  },
  LIFESTYLE: {
    label: 'Dinh dưỡng & Giác quan',
    icon: '🥗',
    bg: 'bg-emerald-50',
    text: 'text-emerald-800',
    border: 'border-emerald-200',
    desc: 'Thói quen ăn uống, giấc ngủ, nhạy cảm giác quan và đồ chơi.',
  },
  EDUCATION: {
    label: 'Trường lớp & Hòa nhập',
    icon: '🏫',
    bg: 'bg-sky-50',
    text: 'text-sky-800',
    border: 'border-sky-200',
    desc: 'Chọn trường mầm non hòa nhập, trung tâm can thiệp và môi trường.',
  },
  QA: {
    label: 'Hỏi đáp & Lời khuyên',
    icon: '❓',
    bg: 'bg-purple-50',
    text: 'text-purple-800',
    border: 'border-purple-200',
    desc: 'Hỏi kinh nghiệm đi khám, chọn cơ sở y tế và giải đáp thắc mắc.',
  },
}
