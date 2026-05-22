import type { VideoScreening } from '../lib/types'

function Bar({ label, value }: { label: string; value: number }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100)
  return (
    <div>
      <div className="flex items-center justify-between text-xs text-slate-600">
        <span>{label}</span>
        <span className="tabular-nums">{pct}%</span>
      </div>
      <div className="mt-2 h-2 rounded-full bg-slate-100">
        <div className="h-2 rounded-full bg-indigo-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

export function BehaviorChart({ screening }: { screening: VideoScreening }) {
  const r = screening.result
  if (!r) return null
  return (
    <div className="space-y-4">
      <Bar label="Giao tiếp mắt" value={r.eyeContactScore} />
      <Bar label="Vận động/điệu bộ" value={r.motorPatternScore} />
      <Bar label="Phản hồi tương tác" value={r.responseBehaviorScore} />
      <Bar label="Hành vi lặp lại" value={r.repetitiveBehaviorScore} />
    </div>
  )
}
