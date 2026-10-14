/**
 * Dashed whole-body outline with a floor line, drawn over the camera preview so
 * the parent can place the camera far enough to see the child from head to feet.
 */
export function FramingGuide({ label = 'Đứng vào trong khung, thấy cả đầu và bàn chân' }: { label?: string }) {
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      <svg viewBox="0 0 160 90" preserveAspectRatio="xMidYMid meet" className="h-full w-full">
        <g fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="0.9" strokeDasharray="2.4 1.8" strokeLinecap="round">
          <circle cx="80" cy="17" r="6" />
          <path d="M73 26 Q80 23 87 26 L90 50 Q80 53 70 50 Z" />
          <path d="M73 27 L64 46" />
          <path d="M87 27 L96 46" />
          <path d="M75 51 L73 79" />
          <path d="M85 51 L87 79" />
        </g>
        <line x1="52" y1="81" x2="108" y2="81" stroke="rgba(255,200,0,0.95)" strokeWidth="1" strokeLinecap="round" />
      </svg>
      <div className="absolute inset-x-0 top-2 flex justify-center px-2">
        <span className="rounded-full bg-black/55 px-3 py-1 text-center text-[11px] font-extrabold text-white">{label}</span>
      </div>
    </div>
  )
}
