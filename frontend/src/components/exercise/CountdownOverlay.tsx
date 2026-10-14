import { useEffect, useRef, useState } from 'react'

const STEPS: Array<{ text: string; ms: number; big: boolean }> = [
  { text: 'Chuẩn bị nào!', ms: 1200, big: false },
  { text: '3', ms: 1000, big: true },
  { text: '2', ms: 1000, big: true },
  { text: '1', ms: 1000, big: true },
  { text: 'Bắt đầu!', ms: 700, big: false },
]

/** "Chuẩn bị nào!" → 3 → 2 → 1 → "Bắt đầu!", then `onDone` (once). */
export function CountdownOverlay({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0)
  const onDoneRef = useRef(onDone)
  useEffect(() => {
    onDoneRef.current = onDone
  }, [onDone])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (step < STEPS.length - 1) setStep(step + 1)
      else onDoneRef.current()
    }, STEPS[step].ms)
    return () => window.clearTimeout(timer)
  }, [step])

  const current = STEPS[step]
  return (
    <div className="absolute inset-0 z-20 grid place-items-center bg-white/60 backdrop-blur-[2px]">
      <div
        key={step}
        role="status"
        aria-live="assertive"
        className={[
          'rounded-[2rem] bg-white px-10 py-6 text-center font-black text-duo-green shadow-card-hover',
          current.big ? 'text-8xl tabular-nums md:text-9xl' : 'text-4xl md:text-6xl',
        ].join(' ')}
      >
        {current.text}
      </div>
    </div>
  )
}
