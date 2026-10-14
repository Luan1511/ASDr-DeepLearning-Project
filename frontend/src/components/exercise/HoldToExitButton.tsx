import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { X } from 'lucide-react'

const RING_RADIUS = 20
const RING_LENGTH = 2 * Math.PI * RING_RADIUS

/**
 * Exit for the parent in kid mode: it must be held (default 1.5 s), so a child
 * tapping around cannot leave the exercise by accident.
 */
export function HoldToExitButton({
  onExit,
  holdMs = 1500,
  label = 'Giữ để thoát',
  className,
}: {
  onExit: () => void
  holdMs?: number
  label?: string
  className?: string
}) {
  const [holding, setHolding] = useState(false)
  const timerRef = useRef<number | null>(null)
  const onExitRef = useRef(onExit)
  useEffect(() => {
    onExitRef.current = onExit
  }, [onExit])
  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    },
    [],
  )

  const begin = () => {
    if (timerRef.current !== null) return
    setHolding(true)
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      setHolding(false)
      onExitRef.current()
    }, holdMs)
  }
  const cancel = () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = null
    setHolding(false)
  }
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      if (!e.repeat) begin()
    }
  }
  const onKeyUp = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') cancel()
  }

  return (
    <button
      type="button"
      aria-label={`${label} (nhấn giữ)`}
      title={label}
      className={['group flex select-none items-center gap-2 rounded-full bg-white/90 py-1 pl-1 pr-3 shadow-chip', className]
        .filter(Boolean)
        .join(' ')}
      style={{ touchAction: 'none' }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        begin()
      }}
      onPointerUp={cancel}
      onPointerCancel={cancel}
      onLostPointerCapture={cancel}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      onBlur={cancel}
      onContextMenu={(e) => e.preventDefault()}
    >
      <span className="relative grid h-11 w-11 place-items-center">
        <svg viewBox="0 0 48 48" className="absolute inset-0 h-full w-full -rotate-90" aria-hidden>
          <circle cx="24" cy="24" r={RING_RADIUS} fill="none" stroke="#E5E5E5" strokeWidth="4" />
          <circle
            cx="24"
            cy="24"
            r={RING_RADIUS}
            fill="none"
            stroke="#166534"
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray={RING_LENGTH}
            strokeDashoffset={holding ? 0 : RING_LENGTH}
            style={{ transition: holding ? `stroke-dashoffset ${holdMs}ms linear` : 'stroke-dashoffset 150ms ease-out' }}
          />
        </svg>
        <X className="h-5 w-5 stroke-[2.5] text-duo-ink" />
      </span>
      <span className="text-xs font-extrabold text-duo-mute group-hover:text-duo-ink">{label}</span>
    </button>
  )
}
