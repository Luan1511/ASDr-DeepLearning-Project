import { EyeOff } from 'lucide-react'
import type { CommunityAuthor } from '../../lib/communityTypes'
import { useAuth } from '../../state/useAuth'
import { StartConversationButton } from './StartConversationButton'

const COLORS = ['bg-duo-green', 'bg-duo-blue', 'bg-duo-gold', 'bg-[#CE82FF]', 'bg-[#FF6B6B]', 'bg-[#20BF6B]']

function hash(text: string) {
  let h = 0
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return h
}

export function AuthorAvatar({ author, size = 'md', postId, postTitle }: { author: CommunityAuthor; size?: 'sm' | 'md' | 'lg'; postId?: string; postTitle?: string }) {
  const { user } = useAuth()
  const dims =
    size === 'lg' ? 'h-12 w-12 text-lg' : size === 'sm' ? 'h-7 w-7 text-xs' : 'h-9 w-9 text-sm'

  if (author.isAnonymous) {
    return (
      <div
        className={`flex flex-shrink-0 items-center justify-center rounded-2xl bg-amber-100 text-amber-800 shadow-sm ${dims}`}
        title="Phụ huynh giấu tên"
      >
        <EyeOff className={size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
      </div>
    )
  }

  const words = author.name.trim().split(/\s+/)
  const initial = (words[words.length - 1] ?? '').charAt(0).toUpperCase() || '?'
  const color = COLORS[hash(author.name.trim()) % COLORS.length]

  const avatar = (
    <div
      className={`flex flex-shrink-0 items-center justify-center rounded-2xl font-black text-white shadow-sm ${dims} ${color}`}
      title={author.name}
    >
      {initial}
    </div>
  )
  if (user?.role === 'USER' && !user.doctor && author.role === 'USER' && !author.isSelf && author.id !== user.id) {
    return <StartConversationButton recipientId={author.id} displayName={author.name} postId={postId} postTitle={postTitle} trigger={avatar} />
  }
  return avatar
}
