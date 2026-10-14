import { EyeOff } from 'lucide-react'
import type { CommunityAuthor } from '../../lib/communityTypes'

const COLORS = ['bg-duo-green', 'bg-duo-blue', 'bg-duo-gold', 'bg-[#CE82FF]', 'bg-[#FF6B6B]', 'bg-[#20BF6B]']

function hash(text: string) {
  let h = 0
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return h
}

export function AuthorAvatar({ author, size = 'md' }: { author: CommunityAuthor; size?: 'sm' | 'md' | 'lg' }) {
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

  return (
    <div
      className={`flex flex-shrink-0 items-center justify-center rounded-2xl font-black text-white shadow-sm ${dims} ${color}`}
      title={author.name}
    >
      {initial}
    </div>
  )
}
