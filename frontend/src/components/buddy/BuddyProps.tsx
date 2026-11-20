import type { ReactNode } from 'react'
import type { BuddyProp } from '../../lib/buddy/types'
import { DuckSvg } from './BuddyDuck'

/**
 * Pictures Bin shows next to itself while it talks about something
 * ("Nhà em có con mèo à?" → a cat walks by). Original drawings in the style
 * of the dancing duck; each one has its own little motion. Decorative only.
 */

type Motion = 'walk' | 'drive' | 'bounce' | 'spin' | 'rain' | 'twinkle' | 'pulse' | 'sway' | 'bob'
type Place = 'ground' | 'sky'

const S = 120

const ART: Record<BuddyProp, { motion: Motion; place: Place; draw: () => ReactNode }> = {
  house: {
    motion: 'bob', place: 'ground', draw: () => (
      <svg viewBox="0 0 140 140" width={S} height={S}>
        <ellipse cx="70" cy="132" rx="50" ry="6" fill="#172B6B" opacity="0.12" />
        <rect x="28" y="62" width="84" height="66" rx="6" fill="#FDE68A" />
        <path d="M18 66 L70 22 L122 66 Z" fill="#F87171" />
        <rect x="92" y="30" width="12" height="24" fill="#B45309" />
        <rect x="58" y="92" width="24" height="36" rx="4" fill="#B45309" />
        <circle cx="76" cy="111" r="2" fill="#FDE68A" />
        <rect x="36" y="76" width="18" height="16" rx="3" fill="#93C5FD" />
        <rect x="86" y="76" width="18" height="16" rx="3" fill="#93C5FD" />
        <circle className="smoke" cx="98" cy="22" r="6" fill="#E5E7EB" />
      </svg>
    ),
  },
  cat: {
    motion: 'walk', place: 'ground', draw: () => (
      <svg viewBox="0 0 140 140" width={S} height={S}>
        <ellipse cx="70" cy="132" rx="40" ry="6" fill="#172B6B" opacity="0.12" />
        <path className="tail" d="M108 100 q24 -6 20 -34" stroke="#FB923C" strokeWidth="8" fill="none" strokeLinecap="round" />
        <ellipse cx="74" cy="104" rx="36" ry="24" fill="#FDBA74" />
        <rect x="50" y="116" width="10" height="14" rx="5" fill="#FDBA74" />
        <rect x="84" y="116" width="10" height="14" rx="5" fill="#FDBA74" />
        <circle cx="44" cy="70" r="26" fill="#FDBA74" />
        <path d="M24 56 l4 -24 l16 16 z M64 56 l-4 -24 l-16 16 z" fill="#FDBA74" />
        <path d="M27 52 l2 -12 l8 8 z M61 52 l-2 -12 l-8 8 z" fill="#FDA4AF" />
        <circle cx="35" cy="68" r="3.5" fill="#111827" />
        <circle cx="53" cy="68" r="3.5" fill="#111827" />
        <path d="M44 74 l-3 3 h6 z" fill="#FB7185" />
        <path d="M44 77 q-4 5 -8 2 M44 77 q4 5 8 2" stroke="#111827" strokeWidth="1.5" fill="none" />
        <path d="M20 74 h12 M20 79 h12 M56 74 h12 M56 79 h12" stroke="#7C2D12" strokeWidth="1" />
      </svg>
    ),
  },
  dog: {
    motion: 'walk', place: 'ground', draw: () => (
      <svg viewBox="0 0 140 140" width={S} height={S}>
        <ellipse cx="70" cy="132" rx="40" ry="6" fill="#172B6B" opacity="0.12" />
        <path className="tail" d="M108 96 q16 -10 14 -26" stroke="#A16207" strokeWidth="8" fill="none" strokeLinecap="round" />
        <ellipse cx="74" cy="104" rx="36" ry="22" fill="#D6A15A" />
        <rect x="50" y="114" width="10" height="16" rx="5" fill="#D6A15A" />
        <rect x="86" y="114" width="10" height="16" rx="5" fill="#D6A15A" />
        <circle cx="42" cy="72" r="26" fill="#E7B76E" />
        <ellipse cx="22" cy="68" rx="9" ry="18" fill="#A16207" />
        <ellipse cx="62" cy="68" rx="9" ry="18" fill="#A16207" />
        <circle cx="34" cy="70" r="3.5" fill="#111827" />
        <circle cx="50" cy="70" r="3.5" fill="#111827" />
        <ellipse cx="42" cy="82" rx="6" ry="4" fill="#111827" />
        <path d="M42 86 v4 q-2 6 4 6" stroke="#111827" strokeWidth="1.5" fill="none" />
        <path d="M44 90 q2 8 6 6" fill="#FB7185" />
      </svg>
    ),
  },
  duck: { motion: 'walk', place: 'ground', draw: () => <DuckSvg size={S} /> },
  flower: {
    motion: 'sway', place: 'ground', draw: () => (
      <svg viewBox="0 0 140 140" width={S} height={S}>
        <ellipse cx="70" cy="132" rx="26" ry="5" fill="#172B6B" opacity="0.12" />
        <path d="M70 130 V64" stroke="#22C55E" strokeWidth="6" strokeLinecap="round" />
        <path d="M70 104 q-24 -6 -28 -22 q22 2 28 22 z M70 96 q22 -8 26 -24 q-22 4 -26 24 z" fill="#4ADE80" />
        <g className="petals">
          {[0, 60, 120, 180, 240, 300].map((a) => (
            <ellipse key={a} cx="70" cy="34" rx="11" ry="17" fill="#F472B6" transform={`rotate(${a} 70 50)`} />
          ))}
        </g>
        <circle cx="70" cy="50" r="12" fill="#FDE047" />
        <circle cx="66" cy="48" r="1.8" fill="#111827" />
        <circle cx="74" cy="48" r="1.8" fill="#111827" />
        <path d="M65 53 q5 4 10 0" stroke="#111827" strokeWidth="1.5" fill="none" />
      </svg>
    ),
  },
  sun: {
    motion: 'spin', place: 'sky', draw: () => (
      <svg viewBox="0 0 140 140" width={S} height={S}>
        <g className="rays">
          {Array.from({ length: 12 }, (_, i) => (
            <path key={i} d="M70 6 l6 18 h-12 z" fill="#FDBA2D" transform={`rotate(${i * 30} 70 70)`} />
          ))}
        </g>
        <circle cx="70" cy="70" r="34" fill="#FDE047" />
        <circle cx="58" cy="66" r="4" fill="#111827" />
        <circle cx="82" cy="66" r="4" fill="#111827" />
        <path d="M56 80 q14 12 28 0" stroke="#111827" strokeWidth="3" fill="none" strokeLinecap="round" />
        <ellipse cx="50" cy="78" rx="5" ry="3" fill="#FB7185" opacity="0.5" />
        <ellipse cx="90" cy="78" rx="5" ry="3" fill="#FB7185" opacity="0.5" />
      </svg>
    ),
  },
  rain: {
    motion: 'rain', place: 'sky', draw: () => (
      <svg viewBox="0 0 140 140" width={S} height={S}>
        <g className="cloud">
          <path d="M30 70 q-18 0 -18 -16 q0 -16 18 -16 q4 -20 26 -20 q18 0 24 14 q6 -6 16 -6 q20 0 20 20 q14 2 14 14 q0 10 -14 10 z" fill="#E0E7FF" stroke="#C7D2FE" strokeWidth="3" />
          <circle cx="56" cy="50" r="3" fill="#111827" />
          <circle cx="78" cy="50" r="3" fill="#111827" />
          <path d="M60 60 q7 5 14 0" stroke="#111827" strokeWidth="2" fill="none" />
        </g>
        {[34, 58, 82, 106].map((x, i) => (
          <path key={x} className="drop" style={{ animationDelay: `${i * 0.25}s` }} d={`M${x} 80 q-5 9 0 12 q5 -3 0 -12 z`} fill="#60A5FA" />
        ))}
      </svg>
    ),
  },
  star: {
    motion: 'twinkle', place: 'sky', draw: () => (
      <svg viewBox="0 0 140 140" width={S} height={S}>
        <path d="M70 12 l16 36 l40 4 l-30 26 l9 40 l-35 -21 l-35 21 l9 -40 l-30 -26 l40 -4 z" fill="#FDE047" stroke="#FACC15" strokeWidth="4" strokeLinejoin="round" />
        <circle cx="60" cy="68" r="3.5" fill="#111827" />
        <circle cx="80" cy="68" r="3.5" fill="#111827" />
        <path d="M62 80 q8 7 16 0" stroke="#111827" strokeWidth="2.5" fill="none" strokeLinecap="round" />
        <path className="sparkle" d="M118 18 l3 8 l8 3 l-8 3 l-3 8 l-3 -8 l-8 -3 l8 -3 z" fill="#FDE047" />
      </svg>
    ),
  },
  heart: {
    motion: 'pulse', place: 'sky', draw: () => (
      <svg viewBox="0 0 140 140" width={S} height={S}>
        <path d="M70 120 C20 86 10 60 26 38 C40 20 62 26 70 44 C78 26 100 20 114 38 C130 60 120 86 70 120 Z" fill="#FB7185" />
        <ellipse cx="46" cy="46" rx="8" ry="5" fill="white" opacity="0.5" transform="rotate(-30 46 46)" />
        <circle cx="58" cy="68" r="3.5" fill="#111827" />
        <circle cx="82" cy="68" r="3.5" fill="#111827" />
        <path d="M60 80 q10 8 20 0" stroke="#111827" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      </svg>
    ),
  },
  ball: {
    motion: 'bounce', place: 'ground', draw: () => (
      <svg viewBox="0 0 140 140" width={S * 0.8} height={S * 0.8}>
        <circle cx="70" cy="70" r="46" fill="#60A5FA" />
        <path d="M24 70 h92" stroke="white" strokeWidth="8" />
        <path d="M70 24 q-28 46 0 92" stroke="#F87171" strokeWidth="8" fill="none" />
        <path d="M70 24 q28 46 0 92" stroke="#FDE047" strokeWidth="8" fill="none" />
        <ellipse cx="52" cy="46" rx="10" ry="6" fill="white" opacity="0.45" transform="rotate(-30 52 46)" />
      </svg>
    ),
  },
  car: {
    motion: 'drive', place: 'ground', draw: () => (
      // Drawn facing right; mirrored so it drives forward (right to left) like the train.
      <svg viewBox="0 0 160 110" width={S * 1.2} height={S * 0.82} style={{ transform: 'scaleX(-1)' }}>
        <ellipse cx="80" cy="104" rx="64" ry="5" fill="#172B6B" opacity="0.12" />
        <path d="M14 78 v-18 q0 -10 10 -12 l20 -4 l18 -22 q4 -4 10 -4 h40 q6 0 10 6 l14 22 h10 q10 0 10 12 v20 z" fill="#EF4444" />
        <path d="M60 42 l14 -16 h18 v16 z M98 42 v-16 h12 l10 16 z" fill="#BFDBFE" />
        <rect x="140" y="62" width="8" height="6" rx="2" fill="#FDE047" />
        <g className="wheel" style={{ transformOrigin: '42px 84px' }}><circle cx="42" cy="84" r="14" fill="#1F2937" /><circle cx="42" cy="84" r="5" fill="#D1D5DB" /><path d="M42 72 v24" stroke="#9CA3AF" strokeWidth="2" /></g>
        <g className="wheel" style={{ transformOrigin: '118px 84px' }}><circle cx="118" cy="84" r="14" fill="#1F2937" /><circle cx="118" cy="84" r="5" fill="#D1D5DB" /><path d="M118 72 v24" stroke="#9CA3AF" strokeWidth="2" /></g>
      </svg>
    ),
  },
  train: {
    motion: 'drive', place: 'ground', draw: () => (
      <svg viewBox="0 0 220 120" width={S * 1.7} height={S * 0.92}>
        <ellipse cx="110" cy="114" rx="96" ry="5" fill="#172B6B" opacity="0.12" />
        <circle className="smoke" cx="40" cy="14" r="8" fill="#E5E7EB" />
        <rect x="30" y="24" width="16" height="22" fill="#374151" />
        <rect x="14" y="44" width="80" height="48" rx="8" fill="#2563EB" />
        <rect x="58" y="30" width="36" height="30" rx="4" fill="#1D4ED8" />
        <rect x="64" y="36" width="24" height="16" rx="3" fill="#BFDBFE" />
        <path d="M6 92 l8 -14 h4 v14 z" fill="#FDE047" />
        <rect x="104" y="50" width="80" height="42" rx="8" fill="#F59E0B" />
        <rect x="114" y="58" width="22" height="16" rx="3" fill="#FEF3C7" />
        <rect x="150" y="58" width="22" height="16" rx="3" fill="#FEF3C7" />
        <path d="M94 80 h10" stroke="#374151" strokeWidth="4" />
        {[32, 74, 124, 166].map((cx) => (
          <g key={cx} className="wheel" style={{ transformOrigin: `${cx}px 98px` }}>
            <circle cx={cx} cy="98" r="12" fill="#1F2937" /><circle cx={cx} cy="98" r="4" fill="#D1D5DB" /><path d={`M${cx} 86 v24`} stroke="#9CA3AF" strokeWidth="2" />
          </g>
        ))}
      </svg>
    ),
  },
}

/** The picture of `prop`; re-mount (change `key`) to play its entrance again. */
export function BuddyPropPicture({ prop }: { prop: BuddyProp }) {
  const { motion, place, draw } = ART[prop]
  return (
    <div aria-hidden="true" className={`buddy-prop pointer-events-none absolute left-0 right-0 z-10 ${place === 'sky' ? 'top-6 h-40' : 'bottom-6 h-44'}`}>
      <style>{`
        .buddy-prop .holder { position: absolute; bottom: 0; animation: prop-in .5s ease-out both; }
        .buddy-prop.place-ground .holder { left: 12%; }
        .buddy-prop .m-walk { animation: prop-walk 6s ease-in-out infinite; }
        .buddy-prop .m-walk .inner { animation: prop-turn 6s steps(1) infinite, prop-bob .45s ease-in-out infinite alternate; transform-origin: 50% 90%; }
        .buddy-prop .m-drive { animation: prop-drive 5s linear infinite; }
        .buddy-prop .m-bounce { animation: prop-bounce .9s cubic-bezier(.3,0,.7,1) infinite alternate; }
        .buddy-prop .m-spin .rays { animation: prop-rot 8s linear infinite; transform-origin: 70px 70px; }
        .buddy-prop .m-spin .inner { animation: prop-glow 2s ease-in-out infinite alternate; }
        .buddy-prop .m-rain .cloud { animation: prop-bob 1.2s ease-in-out infinite alternate; }
        .buddy-prop .m-rain .drop { animation: prop-drop 1s ease-in infinite; }
        .buddy-prop .m-twinkle .inner { animation: prop-twinkle 1.6s ease-in-out infinite; transform-origin: center; }
        .buddy-prop .m-twinkle .sparkle { animation: prop-twinkle 0.9s ease-in-out infinite; transform-origin: 118px 29px; }
        .buddy-prop .m-pulse .inner { animation: prop-pulse 0.9s ease-in-out infinite; transform-origin: center; }
        .buddy-prop .m-pulse { animation: prop-float 3s ease-in-out infinite alternate; }
        .buddy-prop .m-sway .inner { animation: prop-sway 2.4s ease-in-out infinite alternate; transform-origin: 50% 95%; }
        .buddy-prop .m-sway .petals { animation: prop-rot 10s linear infinite; transform-origin: 70px 50px; }
        .buddy-prop .m-bob .inner { animation: prop-bob 1.6s ease-in-out infinite alternate; }
        .buddy-prop .tail { animation: prop-wag .4s ease-in-out infinite alternate; transform-origin: 108px 98px; }
        .buddy-prop .wheel { animation: prop-rot .6s linear infinite; }
        .buddy-prop .smoke { animation: prop-smoke 1.6s ease-out infinite; }
        .buddy-prop .bob { animation: prop-bob .5s ease-in-out infinite alternate; }
        .buddy-prop .wing { animation: prop-wing .25s ease-in-out infinite alternate; transform-origin: 70px 92px; }
        @keyframes prop-in { from { opacity: 0; transform: translateY(16px) scale(.8); } to { opacity: 1; transform: none; } }
        @keyframes prop-walk { 0%, 100% { left: 6%; } 45%, 50% { left: 60%; } }
        @keyframes prop-turn { 0% { transform: scaleX(1); } 48% { transform: scaleX(-1); } 97% { transform: scaleX(1); } }
        @keyframes prop-drive { from { left: 100%; } to { left: -45%; } }
        @keyframes prop-bounce { from { transform: translateY(0); } to { transform: translateY(-70px) rotate(90deg); } }
        @keyframes prop-rot { to { transform: rotate(360deg); } }
        @keyframes prop-glow { from { filter: drop-shadow(0 0 0 #FDE047); } to { filter: drop-shadow(0 0 14px #FDE047); } }
        @keyframes prop-bob { from { transform: translateY(0); } to { transform: translateY(-6px); } }
        @keyframes prop-drop { from { transform: translateY(0); opacity: 1; } to { transform: translateY(40px); opacity: 0; } }
        @keyframes prop-twinkle { 0%, 100% { transform: scale(1) rotate(0); } 50% { transform: scale(1.12) rotate(8deg); } }
        @keyframes prop-pulse { 0%, 100% { transform: scale(1); } 30% { transform: scale(1.12); } 50% { transform: scale(.96); } }
        @keyframes prop-float { from { transform: translateY(0); } to { transform: translateY(-18px); } }
        @keyframes prop-sway { from { transform: rotate(-8deg); } to { transform: rotate(8deg); } }
        @keyframes prop-wag { from { transform: rotate(-10deg); } to { transform: rotate(14deg); } }
        @keyframes prop-smoke { from { transform: translate(0, 0) scale(.6); opacity: .9; } to { transform: translate(-10px, -24px) scale(1.4); opacity: 0; } }
        @keyframes prop-wing { from { transform: rotate(0deg); } to { transform: rotate(-28deg); } }
        @media (prefers-reduced-motion: reduce) {
          .buddy-prop * { animation-duration: 3s !important; }
          .buddy-prop .m-walk, .buddy-prop .m-drive { animation: none; left: 30%; }
        }
      `}</style>
      <div className={`holder m-${motion}`} style={place === 'sky' ? { left: '18%' } : undefined}>
        <div className="inner">{draw()}</div>
      </div>
    </div>
  )
}

/** For tests: every picture in the catalogue has a drawing. */
export const BUDDY_PROP_ART = ART
