'use client'

import Link from 'next/link'

/* ─────────────────────────────────────────────
 * "herbart" nav logo
 *
 * Each letter has ONE combined idle keyframe
 * (not 3 separate ones) for smooth compositing.
 * Multiple waypoints per cycle create organic,
 * loopy motion — drift, tilt, scale, all in
 * a single transform per frame.
 *
 * Middle letters (b, a) get a slow 3D rotateY
 * spin via a separate keyframe (no conflict
 * since it uses a wrapper <g>).
 *
 * Agentation curves:
 *   Snap:   cubic-bezier(0.22, 1, 0.36, 1)
 *   Bounce: cubic-bezier(0.34, 1.56, 0.64, 1)
 * ───────────────────────────────────────────── */

const LETTERS = [...'herbart']

export default function NavLogo({ className = '' }) {
  return (
    <Link href="/" className={`nav__logo block ${className}`}>
      <svg
        viewBox="0 0 68 22"
        width={68}
        height={22}
        fill="currentColor"
        className="overflow-visible"
        aria-label="herbart"
      >
        <style>{`
          .nl {
            font-size: 14px;
            font-weight: 500;
            opacity: 0;
            transform-box: fill-box;
            transform-origin: center center;
            will-change: transform, opacity;
            animation:
              nl-in 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) var(--d) forwards,
              var(--idle) var(--dur) ease-in-out var(--id) infinite;
          }

          @keyframes nl-in {
            from { opacity: 0; transform: translateY(6px) scale(0.5) rotate(8deg); }
            to   { opacity: 1; transform: none; }
          }

          /* 7 unique idle loops — one per letter */

          @keyframes nl-0 {
            0%   { transform: translateY(0) rotate(0deg) scale(1); }
            15%  { transform: translateY(-1.2px) rotate(-2deg) scale(1.02); }
            35%  { transform: translateY(0.5px) rotate(1.5deg) scale(0.98); }
            55%  { transform: translateY(-0.8px) rotate(-1deg) scale(1.01); }
            75%  { transform: translateY(0.3px) rotate(2deg) scale(0.99); }
            100% { transform: translateY(0) rotate(0deg) scale(1); }
          }

          @keyframes nl-1 {
            0%   { transform: translateY(0) rotate(0deg) scale(1); }
            20%  { transform: translateY(1px) rotate(2.5deg) scale(1.03); }
            40%  { transform: translateY(-1.5px) rotate(-1deg) scale(0.97); }
            60%  { transform: translateY(0.6px) rotate(1.8deg) scale(1.01); }
            80%  { transform: translateY(-0.4px) rotate(-2deg) scale(1); }
            100% { transform: translateY(0) rotate(0deg) scale(1); }
          }

          @keyframes nl-2 {
            0%   { transform: translateY(0) rotate(0deg) scale(1); }
            18%  { transform: translateY(-1.6px) rotate(3deg) scale(0.96); }
            42%  { transform: translateY(0.8px) rotate(-2deg) scale(1.04); }
            65%  { transform: translateY(-0.5px) rotate(1deg) scale(0.99); }
            85%  { transform: translateY(1.1px) rotate(-1.5deg) scale(1.02); }
            100% { transform: translateY(0) rotate(0deg) scale(1); }
          }

          @keyframes nl-3 {
            0%   { transform: translateY(0) rotate(0deg) scale(1) rotateY(0deg); }
            25%  { transform: translateY(0.7px) rotate(-1.5deg) scale(1.02) rotateY(12deg); }
            50%  { transform: translateY(-1px) rotate(2deg) scale(0.98) rotateY(0deg); }
            75%  { transform: translateY(0.4px) rotate(-0.8deg) scale(1.01) rotateY(-8deg); }
            100% { transform: translateY(0) rotate(0deg) scale(1) rotateY(0deg); }
          }

          @keyframes nl-4 {
            0%   { transform: translateY(0) rotate(0deg) scale(1) rotateX(0deg); }
            22%  { transform: translateY(-1.3px) rotate(2.5deg) scale(0.97) rotateX(8deg); }
            48%  { transform: translateY(1.1px) rotate(-1.8deg) scale(1.03) rotateX(-5deg); }
            70%  { transform: translateY(-0.6px) rotate(1deg) scale(0.99) rotateX(3deg); }
            100% { transform: translateY(0) rotate(0deg) scale(1) rotateX(0deg); }
          }

          @keyframes nl-5 {
            0%   { transform: translateY(0) rotate(0deg) scale(1); }
            17%  { transform: translateY(1.4px) rotate(-3deg) scale(1.04); }
            38%  { transform: translateY(-0.9px) rotate(2deg) scale(0.96); }
            58%  { transform: translateY(0.5px) rotate(-1.2deg) scale(1.02); }
            82%  { transform: translateY(-1.1px) rotate(1.8deg) scale(0.98); }
            100% { transform: translateY(0) rotate(0deg) scale(1); }
          }

          @keyframes nl-6 {
            0%   { transform: translateY(0) rotate(0deg) scale(1); }
            20%  { transform: translateY(-0.9px) rotate(2deg) scale(1.03); }
            45%  { transform: translateY(1.3px) rotate(-2.5deg) scale(0.97); }
            68%  { transform: translateY(-0.4px) rotate(1.5deg) scale(1.01); }
            88%  { transform: translateY(0.7px) rotate(-1deg) scale(0.99); }
            100% { transform: translateY(0) rotate(0deg) scale(1); }
          }

          /* hover */
          svg:hover .nl {
            animation-play-state: running, paused;
            transition: transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
            transform: translateY(-2px) rotate(var(--hr)) scale(1.08);
          }

          @media (prefers-reduced-motion: reduce) {
            .nl { animation: none !important; opacity: 1 !important; }
          }
        `}</style>

        {LETTERS.map((ch, i) => {
          const entryDelay = 0.15 + i * 0.05;
          const idleDelay = entryDelay + 0.5;
          // each letter: different cycle duration (3.5–6s) for async feel
          const durations = [4.2, 3.6, 5.1, 4.8, 3.9, 5.5, 4.0];
          const hoverRot = (i % 2 === 0 ? -1 : 1) * (2 + i * 0.7);

          return (
            <text
              key={i}
              x={2 + i * 9.2}
              y={16}
              className="nl"
              style={{
                '--d': `${entryDelay.toFixed(2)}s`,
                '--id': `${idleDelay.toFixed(2)}s`,
                '--idle': `nl-${i}`,
                '--dur': `${durations[i]}s`,
                '--hr': `${hoverRot.toFixed(1)}deg`,
              }}
            >
              {ch}
            </text>
          )
        })}
      </svg>
    </Link>
  )
}
