const COLORS = ['bg-duo-green', 'bg-duo-blue', 'bg-duo-gold', 'bg-[#CE82FF]']

function hash(text: string) {
  let h = 0
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return h
}

/**
 * Initial of the given name (last word: "Bé An" → A, "Nguyễn Minh Khôi" → K)
 * on a colour derived from the whole name, so a child keeps the same avatar everywhere.
 */
export function ChildAvatar({ name, size = 'md' }: { name: string; size?: 'md' | 'lg' }) {
  const words = name.trim().split(/\s+/)
  const initial = (words[words.length - 1] ?? '').charAt(0).toUpperCase() || '?'
  const color = COLORS[hash(name.trim()) % COLORS.length]
  const dims = size === 'lg' ? 'h-16 w-16 text-2xl' : 'h-10 w-10 text-sm'
  return (
    <div className={`flex flex-shrink-0 items-center justify-center rounded-full font-black text-white ${dims} ${color}`}>
      {initial}
    </div>
  )
}
