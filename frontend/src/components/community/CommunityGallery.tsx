import type { CommunityPost } from '../../lib/communityTypes'
import { CommunityImage } from './CommunityImage'

export function CommunityGallery({ media }: { media: NonNullable<CommunityPost['media']> }) {
  if (!media.length) return null
  return (
    <div
      className={`mt-3 grid h-64 max-w-2xl gap-1 overflow-hidden rounded-2xl sm:h-80 ${media.length === 1 ? 'grid-cols-1 grid-rows-1' : media.length === 2 ? 'grid-cols-2 grid-rows-1' : 'grid-cols-2 grid-rows-2'}`}
      onClick={(event) => event.stopPropagation()}
      aria-label="Ảnh đính kèm bài viết"
    >
      {media.slice(0, 4).map((image, index) => (
        <div key={image.id} className={`min-h-0 min-w-0 ${media.length === 3 && index === 0 ? 'row-span-2' : ''}`}>
          <CommunityImage url={image.url} />
        </div>
      ))}
    </div>
  )
}
