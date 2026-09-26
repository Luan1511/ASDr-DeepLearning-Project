import React from 'react'

export function Card({
  title,
  right,
  children,
  className,
}: {
  title?: string
  right?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={['card-duo', className].filter(Boolean).join(' ')}>
      {(title || right) && (
        <div className="divider-duo flex items-center justify-between px-5 py-4">
          <div className="text-sm font-extrabold uppercase tracking-wide text-duo-ink">{title}</div>
          {right}
        </div>
      )}
      <div className="px-5 py-4">{children}</div>
    </div>
  )
}
