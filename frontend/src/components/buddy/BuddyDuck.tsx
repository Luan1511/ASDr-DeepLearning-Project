import type { CSSProperties } from 'react'

/**
 * A flock of cartoon ducks (original drawing, sunglasses for the meme look)
 * while a song is playing. Each duck waddles back and forth next to Bin on its
 * own path and pace, bobs to the beat and now and then hops with a "Quạc!".
 * Purely decorative.
 */

/**
 * Hand-picked so the flock looks scattered (no Math.random during render):
 * walk range in % of the stage, seconds per round trip, start offset, size,
 * height above the floor, and the hop rhythm.
 */
const FLOCK = [
  { from: 4, to: 58, walk: 11, delay: 0, size: 120, lift: 0, hop: 3.6 },
  { from: 30, to: 76, walk: 9, delay: -3.5, size: 84, lift: 30, hop: 2.9 },
  { from: 12, to: 46, walk: 12.5, delay: -7, size: 70, lift: 54, hop: 4.4 },
  { from: 48, to: 82, walk: 8.5, delay: -1.5, size: 92, lift: 12, hop: 3.2 },
  { from: 0, to: 34, walk: 10, delay: -5.5, size: 64, lift: 70, hop: 5 },
  { from: 60, to: 86, walk: 13, delay: -9, size: 78, lift: 42, hop: 3.9 },
]

/** One duck drawing (also a picture Bin can show, see BuddyProps). */
export function DuckSvg({ size }: { size: number }) {
  return (
    <svg className="bob" viewBox="0 0 140 140" width={size} height={size}>
      <ellipse cx="70" cy="132" rx="38" ry="6" fill="#172B6B" opacity="0.12" />
      {/* feet */}
      <path d="M52 118 l-12 10 h22 z M80 118 l-6 10 h22 z" fill="#F59E0B" />
      {/* body */}
      <ellipse cx="68" cy="96" rx="44" ry="30" fill="#FDE047" />
      <path d="M104 86 q22 -8 26 -22 q-6 18 -22 30 z" fill="#FACC15" />
      {/* wing */}
      <path className="wing" d="M52 92 q20 -16 40 0 q-18 18 -40 0 z" fill="#FACC15" stroke="#EAB308" strokeWidth="2" />
      {/* head */}
      <circle cx="46" cy="52" r="26" fill="#FDE047" />
      <path d="M38 28 q6 -12 12 -2" stroke="#EAB308" strokeWidth="3" fill="none" strokeLinecap="round" />
      {/* beak */}
      <path d="M18 56 q-14 2 -14 8 q12 6 24 0 z" fill="#FB923C" />
      <path d="M6 63 q11 4 22 -1" stroke="#EA580C" strokeWidth="1.5" fill="none" />
      {/* sunglasses */}
      <path d="M24 44 h44" stroke="#111827" strokeWidth="3" strokeLinecap="round" />
      <rect x="26" y="42" width="18" height="11" rx="4" fill="#111827" />
      <rect x="48" y="42" width="18" height="11" rx="4" fill="#111827" />
      <path d="M29 45 l6 0" stroke="white" strokeWidth="2" strokeLinecap="round" opacity="0.8" />
      {/* blush */}
      <ellipse cx="58" cy="62" rx="5" ry="3" fill="#FB7185" opacity="0.5" />
    </svg>
  )
}

export function BuddyDuck() {
  return (
    <div aria-hidden="true" className="buddy-duck pointer-events-none absolute bottom-6 left-0 right-0 z-10 h-56">
      <style>{`
        .buddy-duck .walk { position: absolute; left: calc(var(--from) * 1%);
          animation: duck-walk var(--walk) ease-in-out var(--delay) infinite; }
        .buddy-duck .turn { animation: duck-turn var(--walk) steps(1) var(--delay) infinite; transform-origin: center; }
        .buddy-duck .hop { animation: duck-hop var(--hop) ease-in-out var(--delay) infinite; }
        .buddy-duck .bob { animation: duck-bob 0.5s ease-in-out infinite alternate; transform-origin: 50% 90%; }
        .buddy-duck .wing { animation: duck-wing 0.25s ease-in-out infinite alternate; transform-origin: 70px 92px; }
        .buddy-duck .quack { position: absolute; left: 60%; top: -18px; opacity: 0; font-weight: 900; color: #172B6B;
          background: white; border-radius: 14px; padding: 2px 10px; box-shadow: 0 2px 0 rgba(23,43,107,.15);
          animation: duck-quack var(--hop) ease-in-out var(--delay) infinite; white-space: nowrap; font-size: 14px; }
        .buddy-duck .note { position: absolute; font-size: 22px; color: #1E3F9E; opacity: 0; animation: duck-note 2.4s ease-out infinite; }
        @keyframes duck-walk { 0%, 100% { left: calc(var(--from) * 1%); } 45%, 50% { left: calc(var(--to) * 1%); } }
        @keyframes duck-turn { 0% { transform: scaleX(1); } 48% { transform: scaleX(-1); } 97% { transform: scaleX(1); } }
        @keyframes duck-hop { 0%, 70%, 100% { transform: translateY(0); } 80% { transform: translateY(-34px) rotate(-8deg); } 90% { transform: translateY(0) rotate(4deg); } }
        @keyframes duck-bob { from { transform: rotate(-6deg) translateY(0); } to { transform: rotate(6deg) translateY(-6px); } }
        @keyframes duck-wing { from { transform: rotate(0deg); } to { transform: rotate(-28deg); } }
        @keyframes duck-quack { 0%, 72% { opacity: 0; transform: translateY(6px) scale(.8); } 78%, 92% { opacity: 1; transform: translateY(0) scale(1); } 100% { opacity: 0; } }
        @keyframes duck-note { 0% { opacity: 0; transform: translate(0, 0) rotate(0); } 20% { opacity: 1; } 100% { opacity: 0; transform: translate(26px, -90px) rotate(25deg); } }
        @media (prefers-reduced-motion: reduce) {
          .buddy-duck .walk, .buddy-duck .turn, .buddy-duck .hop, .buddy-duck .wing, .buddy-duck .note { animation: none; }
          .buddy-duck .bob { animation-duration: 1.4s; }
          .buddy-duck .quack { animation-duration: 6s; }
        }
      `}</style>
      <span className="note" style={{ left: '20%', top: '10%', animationDelay: '0s' }}>♪</span>
      <span className="note" style={{ left: '48%', top: '0%', animationDelay: '0.8s' }}>♫</span>
      <span className="note" style={{ left: '72%', top: '12%', animationDelay: '1.6s' }}>♪</span>
      {FLOCK.map(({ from, to, walk, delay, size, lift, hop }, i) => (
        <div
          key={i}
          className="walk"
          style={{ bottom: lift, width: size, '--from': from, '--to': to, '--walk': `${walk}s`, '--delay': `${delay}s`, '--hop': `${hop}s` } as CSSProperties}
        >
          <div className="turn">
            <div className="hop">
              {i % 2 === 0 && <span className="quack">Quạc!</span>}
              <DuckSvg size={size} />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
