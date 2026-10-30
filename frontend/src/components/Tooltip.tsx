import React, { useState } from 'react'
import { Info, HelpCircle } from 'lucide-react'

export interface TooltipProps {
  content: React.ReactNode
  children: React.ReactNode
  position?: 'top' | 'bottom' | 'left' | 'right'
  className?: string
  widthClass?: string
}

export function Tooltip({
  content,
  children,
  position = 'top',
  className = '',
  widthClass = 'w-64 max-w-xs',
}: TooltipProps) {
  const [mobileOpen, setMobileOpen] = useState(false)

  const posClasses = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
    left: 'right-full top-1/2 -translate-y-1/2 mr-2',
    right: 'left-full top-1/2 -translate-y-1/2 ml-2',
  }[position]

  const arrowClasses = {
    top: 'top-full left-1/2 -translate-x-1/2 border-t-duo-ink border-x-transparent border-b-transparent border-t-4 border-x-4 border-b-0',
    bottom: 'bottom-full left-1/2 -translate-x-1/2 border-b-duo-ink border-x-transparent border-t-transparent border-b-4 border-x-4 border-t-0',
    left: 'left-full top-1/2 -translate-y-1/2 border-l-duo-ink border-y-transparent border-r-transparent border-l-4 border-y-4 border-r-0',
    right: 'right-full top-1/2 -translate-y-1/2 border-r-duo-ink border-y-transparent border-l-transparent border-r-4 border-y-4 border-l-0',
  }[position]

  return (
    <span
      className={`group/tooltip relative inline-flex items-center ${className}`}
      onClick={() => setMobileOpen(!mobileOpen)}
      onMouseLeave={() => setMobileOpen(false)}
      tabIndex={0}
      role="tooltip"
    >
      {children}

      <span
        className={[
          'pointer-events-none absolute z-50 rounded-xl bg-duo-ink px-3 py-2 text-xs font-semibold leading-relaxed text-white shadow-xl transition-all duration-150',
          widthClass,
          posClasses,
          mobileOpen
            ? 'visible opacity-100 scale-100'
            : 'invisible opacity-0 scale-95 group-hover/tooltip:visible group-hover/tooltip:opacity-100 group-hover/tooltip:scale-100 group-focus-visible/tooltip:visible group-focus-visible/tooltip:opacity-100 group-focus-visible/tooltip:scale-100',
        ].join(' ')}
      >
        {content}
        <span className={`absolute h-0 w-0 ${arrowClasses}`} />
      </span>
    </span>
  )
}

/**
 * Compact circular info icon with hover tooltip.
 * Ideal for titles, form labels, and metric headers.
 */
export function InfoTooltip({
  content,
  size = 14,
  position = 'top',
  className = '',
  widthClass = 'w-64 max-w-xs',
  variant = 'info',
}: {
  content: React.ReactNode
  size?: number
  position?: 'top' | 'bottom' | 'left' | 'right'
  className?: string
  widthClass?: string
  variant?: 'info' | 'help'
}) {
  const Icon = variant === 'help' ? HelpCircle : Info

  return (
    <Tooltip content={content} position={position} widthClass={widthClass} className={className}>
      <span
        className="inline-flex cursor-help items-center justify-center rounded-full p-0.5 text-duo-mute transition-colors hover:bg-duo-mist hover:text-duo-ink focus:outline-none focus:ring-1 focus:ring-duo-green"
        aria-label="Thông tin giải thích"
      >
        <Icon style={{ width: size, height: size }} className="stroke-[2.2]" />
      </span>
    </Tooltip>
  )
}
