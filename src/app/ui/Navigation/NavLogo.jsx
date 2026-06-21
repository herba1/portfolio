'use client'

import Link from 'next/link'

/* ─────────────────────────────────────────────
 * "herbart" nav logo
 *
 * Each letter is its own little creature with a
 * distinct motion signature — not 7 variations of
 * the same drift. Personality comes from THREE
 * things working together:
 *
 *   1. the keyframe shape   (what it does)
 *   2. transform-origin     (where it pivots from)
 *   3. rest rhythm + speed  (when / how often)
 *
 *   h  jumper   — anticipate, leap, land-squash   (origin: bottom)
 *   e  wiggler  — side-to-side shimmy + roll
 *   r  twitcher — nervous bursts, long calm
 *   b  spinner  — occasional 3D barrel-roll
 *   a  breather — continuous squash & stretch     (origin: bottom)
 *   r  swinger  — damped pendulum                 (origin: top)
 *   t  wobbler  — teeters left/right, nearly tips  (origin: bottom)
 *
 * Different cycle lengths keep them out of sync, so
 * the word never "pulses" as one block — letters act
 * up independently, the way a crowd fidgets.
 *
 * Agentation curves:
 *   Bounce:  cubic-bezier(0.34, 1.56, 0.64, 1)  (entry + hover)
 *   In-out:  cubic-bezier(0.7, 0, 0.3, 1)       (all idle loops, --ease)
 * ───────────────────────────────────────────── */

const LETTERS = [
  { ch: 'h', idle: 'nl-jump',   dur: 2.4, origin: 'bottom center' },
  { ch: 'e', idle: 'nl-wiggle', dur: 1.8, origin: 'center center' },
  { ch: 'r', idle: 'nl-twitch', dur: 3.0, origin: 'center center' },
  { ch: 'b', idle: 'nl-spin',   dur: 3.2, origin: 'center center' },
  { ch: 'a', idle: 'nl-squash', dur: 2.0, origin: 'bottom center' },
  { ch: 'r', idle: 'nl-sway',   dur: 2.4, origin: 'top center'    },
  { ch: 't', idle: 'nl-wobble', dur: 2.6, origin: 'bottom center' },
]

export default function NavLogo({ className = '' }) {
  return (
    <Link href="/" className={`nav__logo block ${className}`} onClick={() => {
      document.documentElement.classList.add("navigating");
      setTimeout(() => document.documentElement.classList.remove("navigating"), 600);
    }}>
      <svg
        viewBox="0 0 68 22"
        width={68}
        height={22}
        fill="currentColor"
        className="overflow-visible nl-svg"
        aria-label="herbart"
      >
        <style>{`
          .nl {
            font-size: 14px;
            font-weight: 400;
            opacity: 0;
            transform-box: fill-box;
            transform-origin: var(--origin, center center);
            /* custom symmetric in-out — slow at the extremes, quick
               through the middle, so every move darts then settles
               instead of mushily floating. tune this one value to
               re-feel every letter at once. */
            --ease: cubic-bezier(0.7, 0, 0.3, 1);
            will-change: transform, opacity;
            animation:
              nl-in 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) var(--d) forwards,
              var(--idle) var(--dur) var(--ease) var(--id) infinite;
          }

          @keyframes nl-in {
            from { opacity: 0; transform: translateY(6px) scale(0.5) rotate(8deg); }
            to   { opacity: 1; transform: none; }
          }

          /* ── h · the jumper ──────────────────────────
             squash to anticipate, stretch into the leap,
             flatten hard on landing, settle. origin sits
             on the baseline so it never floats. */
          @keyframes nl-jump {
            0%   { transform: translateY(0)     scaleX(1)    scaleY(1);    }
            8%   { transform: translateY(0.5px) scaleX(1.12) scaleY(0.84); }
            24%  { transform: translateY(-3.2px) scaleX(0.92) scaleY(1.14); }
            36%  { transform: translateY(-3.4px) scaleX(0.96) scaleY(1.06); }
            50%  { transform: translateY(0)     scaleX(1.16) scaleY(0.8);  }
            60%  { transform: translateY(0)     scaleX(0.97) scaleY(1.05); }
            70%  { transform: translateY(0)     scaleX(1)    scaleY(1);    }
            100% { transform: translateY(0)     scaleX(1)    scaleY(1);    }
          }

          /* ── e · the wiggler ─────────────────────────
             can't sit still — shimmies horizontally with
             a little roll, amplitude decaying out. */
          @keyframes nl-wiggle {
            0%   { transform: translateX(0)      rotate(0deg);    }
            15%  { transform: translateX(-1.6px) rotate(-4deg);   }
            30%  { transform: translateX(1.6px)  rotate(4deg);    }
            45%  { transform: translateX(-1.2px) rotate(-3deg);   }
            60%  { transform: translateX(0.9px)  rotate(2deg);    }
            74%  { transform: translateX(-0.4px) rotate(-1deg);   }
            85%  { transform: translateX(0)      rotate(0deg);    }
            100% { transform: translateX(0)      rotate(0deg);    }
          }

          /* ── r · the twitcher ────────────────────────
             nervous energy: two quick stutter-bursts with
             a long dead-still stretch between them. */
          @keyframes nl-twitch {
            0%   { transform: translate(0,0)            rotate(0deg);    }
            4%   { transform: translate(0.4px,-0.5px)   rotate(3deg);    }
            8%   { transform: translate(-0.4px,0.2px)   rotate(-2.5deg); }
            12%  { transform: translate(0.3px,-0.2px)   rotate(1.5deg);  }
            16%  { transform: translate(0,0)            rotate(0deg);    }
            58%  { transform: translate(0,0)            rotate(0deg);    }
            62%  { transform: translate(-0.5px,-0.4px)  rotate(-3deg);   }
            66%  { transform: translate(0.5px,0.2px)    rotate(2.5deg);  }
            70%  { transform: translate(-0.2px,0)       rotate(-1deg);   }
            74%  { transform: translate(0,0)            rotate(0deg);    }
            100% { transform: translate(0,0)            rotate(0deg);    }
          }

          /* ── b · the spinner ─────────────────────────
             show-off: sits still, then does one clean 3D
             barrel-roll. perspective gives it real depth
             instead of a flat horizontal squash. */
          @keyframes nl-spin {
            0%   { transform: perspective(100px) rotateY(0deg);   }
            42%  { transform: perspective(100px) rotateY(0deg);   }
            72%  { transform: perspective(100px) rotateY(360deg); }
            100% { transform: perspective(100px) rotateY(360deg); }
          }

          /* ── a · the breather ────────────────────────
             calm and alive — a slow continuous squash &
             stretch, no rest. origin on baseline so it
             "sits" while it breathes. */
          @keyframes nl-squash {
            0%   { transform: scaleX(1)    scaleY(1);    }
            25%  { transform: scaleX(0.9)  scaleY(1.1);  }
            50%  { transform: scaleX(1.12) scaleY(0.88); }
            75%  { transform: scaleX(0.96) scaleY(1.04); }
            100% { transform: scaleX(1)    scaleY(1);    }
          }

          /* ── r · the swinger ─────────────────────────
             hinged at the top like it's hanging from a
             string; swings and settles (damped). */
          @keyframes nl-sway {
            0%   { transform: rotate(0deg);    }
            20%  { transform: rotate(8deg);    }
            44%  { transform: rotate(-6.5deg); }
            64%  { transform: rotate(4deg);    }
            82%  { transform: rotate(-2deg);   }
            100% { transform: rotate(0deg);    }
          }

          /* ── t · the wobbler ─────────────────────────
             top-heavy drunk: teeters way over one way,
             catches itself, lurches the other. pivots on
             the baseline like a bowling pin. */
          @keyframes nl-wobble {
            0%   { transform: rotate(0deg)  translateX(0);     }
            16%  { transform: rotate(9deg)  translateX(1px);   }
            30%  { transform: rotate(5deg)  translateX(0.6px); }
            50%  { transform: rotate(-8deg) translateX(-1px);  }
            64%  { transform: rotate(-4deg) translateX(-0.6px);}
            80%  { transform: rotate(3deg)  translateX(0.3px); }
            100% { transform: rotate(0deg)  translateX(0);     }
          }


          @media (prefers-reduced-motion: reduce) {
            .nl { animation: none !important; opacity: 1 !important; transform: none !important; }
          }
        `}</style>

        {LETTERS.map(({ ch, idle, dur, origin }, i) => {
          const entryDelay = 0.15 + i * 0.05
          const idleDelay = entryDelay + 0.4

          return (
            <text
              key={i}
              x={2 + i * 9.2}
              y={16}
              className="nl"
              style={{
                '--d': `${entryDelay.toFixed(2)}s`,
                '--id': `${idleDelay.toFixed(2)}s`,
                '--idle': idle,
                '--dur': `${dur}s`,
                '--origin': origin,
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
