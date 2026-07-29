'use client'

import { memo } from 'react'

import './tokens.css'

/* ═══════════════════════════════════════════════════════════════════════════
 * The way out. A square panel that is nothing but a door to the real thing:
 * the CrowdVolt wordmark on their surface, over a slow sweep of their own
 * brand ramp (--graphic-dupe-1/2/3, the same three stops the holographic foil
 * and the rainbow title sweep through).
 *
 * The artwork is the holographic wordmark SVG, so it carries its own colour;
 * the sweep behind it is masked to a soft radial so it reads as light moving
 * under the mark rather than a gradient rectangle.
 * ═══════════════════════════════════════════════════════════════════════════ */

function SiteLinkDemo() {
  return (
    <a
      className="mv-scope door"
      href="https://crowdvolt.com"
      target="_blank"
      rel="noopener noreferrer"
    >
      <span className="wash" aria-hidden />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="mark" src="/monovolt/holo-crowdvolt-logo.svg" alt="CrowdVolt" />
      <span className="go">
        crowdvolt.com
        <span className="arrow" aria-hidden>
          ↗
        </span>
      </span>

      <style jsx>{`
        .door {
          position: relative;
          display: flex;
          aspect-ratio: 1 / 1;
          width: 100%;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 22px;
          overflow: hidden;
          border-radius: var(--explore-radius);
          background: var(--explore-bg);
          text-decoration: none;
          isolation: isolate;
        }

        /* The brand ramp, drifting. Bigger than the box so several hues are in
           frame at once, and masked to a soft radial so it never shows an edge. */
        .wash {
          position: absolute;
          inset: -30%;
          z-index: 0;
          background: linear-gradient(
            110deg,
            var(--graphic-dupe-1) 0%,
            var(--explore-accent) 28%,
            var(--graphic-dupe-3) 52%,
            var(--explore-accent-bright) 74%,
            var(--graphic-dupe-1) 100%
          );
          background-size: 220% 220%;
          opacity: 0.22;
          filter: blur(28px);
          -webkit-mask-image: radial-gradient(60% 60% at 50% 45%, #000, transparent 78%);
          mask-image: radial-gradient(60% 60% at 50% 45%, #000, transparent 78%);
          animation: door-drift 14s ease-in-out infinite;
        }

        @keyframes door-drift {
          0%,
          100% {
            background-position: 0% 50%;
          }
          50% {
            background-position: 100% 50%;
          }
        }

        .mark {
          position: relative;
          z-index: 1;
          display: block;
          width: min(64%, 260px);
          height: auto;
          transition: transform 0.5s cubic-bezier(0.22, 1, 0.36, 1);
        }

        .go {
          position: relative;
          z-index: 1;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-family: var(--mv-font);
          font-size: 15px;
          font-weight: 500;
          letter-spacing: -0.01em;
          color: var(--explore-text);
        }

        .arrow {
          color: var(--explore-accent);
          transition: transform 0.35s cubic-bezier(0.22, 1, 0.36, 1);
        }

        @media (hover: hover) {
          .door:hover .mark {
            transform: scale(1.04);
          }
          .door:hover .arrow {
            transform: translate(3px, -3px);
          }
          .door:hover .wash {
            opacity: 0.34;
          }
        }

        .wash {
          transition: opacity 0.5s ease-out;
        }

        .door:focus-visible {
          outline: 2px solid var(--explore-accent);
          outline-offset: 2px;
        }

        @media (prefers-reduced-motion: reduce) {
          .wash {
            animation: none;
          }
          .mark,
          .arrow,
          .wash {
            transition: none;
          }
          .door:hover .mark,
          .door:hover .arrow {
            transform: none;
          }
        }
      `}</style>
    </a>
  )
}

export default memo(SiteLinkDemo)
