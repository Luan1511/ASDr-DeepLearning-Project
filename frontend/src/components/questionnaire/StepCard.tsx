import type { ReactNode } from 'react'

/** Numbered section card of the questionnaire entry screens; heading id = `mchat-step-<index>`. */
export function StepCard({ index, title, children }: { index: number; title: string; children: ReactNode }) {
  return (
    <section className="card-duo" aria-labelledby={`mchat-step-${index}`}>
      <div className="divider-duo flex items-center gap-3 px-5 py-4">
        <span className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-full bg-duo-green text-xs font-black text-white">
          {index}
        </span>
        <h2 id={`mchat-step-${index}`} className="text-sm font-extrabold uppercase tracking-wide text-duo-ink">
          {title}
        </h2>
      </div>
      <div className="space-y-3 px-5 py-4">{children}</div>
    </section>
  )
}
