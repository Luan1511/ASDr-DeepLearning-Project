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
    <div className={['rounded-2xl bg-white shadow-sm ring-1 ring-slate-200', className].filter(Boolean).join(' ')}>
      {(title || right) && (
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div className="text-sm font-semibold text-slate-900">{title}</div>
          {right}
        </div>
      )}
      <div className="px-5 py-4">{children}</div>
    </div>
  )
}
