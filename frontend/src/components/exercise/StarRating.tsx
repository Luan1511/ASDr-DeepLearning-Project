import { useEffect, useState } from 'react'
import { Star } from 'lucide-react'
import { usePrefersReducedMotion } from '../../lib/puppet'

const SIZE_CLASS = { sm: 'h-4 w-4', md: 'h-7 w-7', lg: 'h-16 w-16 md:h-20 md:w-20' } as const

/**
 * One to three stars (an attempt always earns at least one). The pop-in
 * animation is skipped when the user prefers reduced motion.
 */
export function StarRating({
  stars,
  size = 'lg',
  animate = true,
}: {
  stars: number
  size?: keyof typeof SIZE_CLASS
  animate?: boolean
}) {
  const reducedMotion = usePrefersReducedMotion()
  const motion = animate && !reducedMotion
  const [entered, setEntered] = useState(false)
  useEffect(() => {
    if (!motion) return
    const id = window.requestAnimationFrame(() => setEntered(true))
    return () => window.cancelAnimationFrame(id)
  }, [motion])

  const filled = Math.max(1, Math.min(3, Math.round(stars)))
  const shown = !motion || entered

  return (
    <div className="inline-flex items-end gap-1" role="img" aria-label={`Được ${['một', 'hai', 'ba'][filled - 1]} sao`}>
      {[1, 2, 3].map((i) => {
        const on = i <= filled
        return (
          <Star
            key={i}
            aria-hidden
            className={[
              SIZE_CLASS[size],
              on ? 'fill-duo-gold text-yellow-500' : 'fill-duo-mist text-duo-line',
              size === 'lg' && i === 2 ? '-translate-y-2' : '',
            ].join(' ')}
            style={
              motion
                ? {
                    transition: 'transform 420ms cubic-bezier(.34,1.56,.64,1), opacity 300ms ease-out',
                    transitionDelay: `${(i - 1) * 260}ms`,
                    transform: `${shown ? 'scale(1)' : 'scale(0.2)'}${size === 'lg' && i === 2 ? ' translateY(-0.5rem)' : ''}`,
                    opacity: shown ? 1 : 0,
                  }
                : undefined
            }
          />
        )
      })}
    </div>
  )
}
