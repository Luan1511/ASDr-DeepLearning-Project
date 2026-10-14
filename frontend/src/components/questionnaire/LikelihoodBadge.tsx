import { CircleAlert, CircleCheck, TriangleAlert, type LucideIcon } from 'lucide-react'
import { BAND_LABEL } from '../../lib/questionnaires'
import type { McHatBand } from '../../lib/questionnaireTypes'

// Text + icon + colour, so the band stays readable in grayscale and when printed.
const BAND_STYLE: Record<McHatBand, { icon: LucideIcon; cls: string }> = {
  LOW: { icon: CircleCheck, cls: 'bg-duo-green-soft text-duo-green-dark' },
  MODERATE: { icon: CircleAlert, cls: 'bg-yellow-100 text-yellow-800' },
  HIGH: { icon: TriangleAlert, cls: 'bg-red-100 text-duo-red-dark' },
}

export function LikelihoodBadge({ band, size = 'sm' }: { band: McHatBand; size?: 'sm' | 'lg' }) {
  const { icon: Icon, cls } = BAND_STYLE[band]
  return (
    <span
      className={[
        'inline-flex items-center gap-1.5 rounded-full font-extrabold print:border print:border-current print:bg-white',
        size === 'lg' ? 'px-4 py-1.5 text-sm' : 'px-3 py-1 text-xs',
        cls,
      ].join(' ')}
    >
      <Icon className={size === 'lg' ? 'h-4 w-4 stroke-[2.5]' : 'h-3.5 w-3.5 stroke-[2.5]'} aria-hidden="true" />
      {BAND_LABEL[band]}
    </span>
  )
}
