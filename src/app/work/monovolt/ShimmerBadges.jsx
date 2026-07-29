'use client'

import { memo, useCallback, useEffect, useRef, useState } from 'react'

import './tokens.css'

/* ═══════════════════════════════════════════════════════════════════════════
 * The CrowdVolt badge / pill family, ported from
 *   mono-volt/apps/web/app/components/core/home-explore/hero/shimmerPill.module.css
 *   mono-volt/apps/web/app/components/core/home-explore/hero/HeroDatePills.tsx
 *   mono-volt/apps/web/app/components/core/home-explore/hero/HeroNoticeBadge.tsx
 *   mono-volt/apps/web/app/components/core/home-explore/CityDropdown.tsx
 *   mono-volt/apps/web/app/components/core/events/TrendingMiniStrip.tsx
 *
 * THE EFFECT, unchanged from the source
 * ────────────────────────────────────────────────────────────────────────────
 * A narrow cyan → pink → gold light-band rides a mostly-neutral gradient and is
 * swept ONCE across the pill by animating `background-position` from 100% to 0%.
 * Two surfaces share the same wave on the same clock:
 *   1. a masked `::before` that IS the 1px hairline ring (padding + mask
 *      exclude-composite, so only the edge paints — the pill itself carries no
 *      border, which is why nothing resizes between states),
 *   2. the label, via `background-clip: text`.
 *
 * The band is deliberately WIDE (30%–70% of a 400%-wide image): at rest the
 * whole coloured span sits fully past the visible window — no edge peek — yet
 * during the sweep it stays on screen for most of the travel, so it reads as a
 * continuous glide rather than a flash. The label's gradient base is exactly its
 * resting colour, so the gradient appearing and disappearing is imperceptible;
 * only the moving band is visible.
 *
 * WHY A CLASS AND NOT `:hover`
 * ────────────────────────────────────────────────────────────────────────────
 * `play` is added on pointer-enter / focus and removed on `animationend` — never
 * bound to `:hover`. A sweep therefore always runs to completion even if the
 * pointer leaves mid-wave, and re-fires cleanly on the next entry. Re-entering
 * while a sweep is in flight is ignored, so it never restarts or stutters.
 *
 * WHAT CHANGED HERE, AND WHY
 * ────────────────────────────────────────────────────────────────────────────
 *   - The source drives `play` through `classList` on the raw node (zero
 *     re-render). Here it is React state, because this tile also runs an ambient
 *     cycle and because styled-jsx scopes its selectors to rendered classNames.
 *     Seven elements re-rendering twice a sweep is free, and it makes teardown
 *     provable — which matters, since the /work grid unmounts this tile.
 *   - Every sweep also arms a backstop timeout (duration + 260ms). `animationend`
 *     is the primary release; the timeout only ever fires if the tab was hidden
 *     mid-sweep and the event was never delivered, so a badge can't stick.
 *   - A slow ambient cycle lights one badge every 1.2s. Touch screens have no
 *     hover, so without it the whole effect would be invisible on a phone; it
 *     runs everywhere so the tile feels alive at rest, and a real hover still
 *     lands instantly on top of it.
 *   - Motion (layout springs), the date store, the calendar popover, analytics
 *     and the horizontal scroll-glide are all gone. This is the badge language,
 *     not the filter row.
 *   - Phosphor's CalendarBlank / X are redrawn as inline strokes at the size they
 *     actually render, so there is no icon dependency and no second file.
 *   - The resale notice reads "Prices set by sellers"; the real line ("Prices may
 *     be set above or below face value by the seller.") is `whitespace-nowrap`
 *     and would be wider than this tile.
 *
 * Colours come from `.mv-scope` in ./tokens.css wherever a token exists — the
 * neutral ring base IS `--explore-hairline`, and the accent badges sweep the
 * brand ramp `--graphic-dupe-1/2/3` rather than the hero's cyan/pink/gold.
 * ═══════════════════════════════════════════════════════════════════════════ */

/* Kept verbatim from shimmerPill.module.css so the JS backstop and the CSS stay
   on the same clock: --shimmer-dur: 0.9s. */
const SWEEP_MS = 900
const RELEASE_GRACE_MS = 260

/* One badge every 1.2s — slow enough to read as ambient rather than as a loop. */
const AMBIENT_MS = 1200

/* Icons carry their size as attributes rather than a class: they are declared
   outside the component that owns the <style jsx> block, so styled-jsx's scope
   hash would never reach them. */
const NO_SHRINK = { flex: 'none', display: 'block' }

const CalendarIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.4"
    strokeLinecap="round"
    style={NO_SHRINK}
    aria-hidden="true"
  >
    <rect x="2" y="3.3" width="12" height="10.4" rx="2.2" />
    <path d="M2 6.6h12" />
    <path d="M5.4 2v2.5M10.6 2v2.5" />
  </svg>
)

const XIcon = () => (
  <svg
    width="13"
    height="13"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.1"
    strokeLinecap="round"
    style={NO_SHRINK}
    aria-hidden="true"
  >
    <path d="M3.8 3.8l8.4 8.4M12.2 3.8l-8.4 8.4" />
  </svg>
)

/* Every badge treatment found on the homepage, in the order they cluster.
 *   pill     — the hero date shortcut at rest: no border, the masked ring IS the
 *              hairline. The one the shimmer was written for.
 *   selected — the same pill switched on: solid white on black. Faithfully has
 *              NO ring and NO sweep; it is the state the sweep resolves against,
 *              and the pair is the point.
 *   small    — the header city pill. Identical treatment one size down (12px);
 *              the source draws its edge as a real 1px border, which is exactly
 *              what the ring paints at rest, so the sweep is a pure superset.
 *   ghost    — "Clear filter": no surface, no ring, faint until hovered. It
 *              sweeps the LABEL only, which is the ring and text surfaces being
 *              genuinely independent rather than a special case.
 *   timer    — the countdown chip off the trending cards: 6px radius, not a
 *              pill, black/65 over the artwork, with its glowing live dot.
 *   light    — the resale notice: the one light badge on a dark page.
 */
const BADGES = [
  { id: 'this-weekend', label: 'This weekend', kind: 'pill', tag: 'button', sweep: true },
  { id: 'next-weekend', label: 'Next weekend', kind: 'pill selected', tag: 'button', sweep: false },
  { id: 'custom', label: 'Custom', kind: 'pill', tag: 'button', sweep: true, icon: 'calendar' },
  { id: 'city', label: 'New York', kind: 'pill small', tag: 'button', sweep: true },
  { id: 'clear', label: 'Clear filter', kind: 'ghost', tag: 'button', sweep: true, icon: 'x' },
  { id: 'timer', label: '2H 40M', kind: 'timer', tag: 'span', sweep: true, dot: true },
  { id: 'notice', label: 'Prices set by sellers', kind: 'light', tag: 'span', sweep: true },
]

const SWEEPERS = BADGES.filter((b) => b.sweep).map((b) => b.id)

const ShimmerBadgesDemo = memo(function ShimmerBadgesDemo() {
  /* Which badges are mid-sweep. A Set rather than a single id because a real
     hover can land while the ambient cycle is lighting a different badge, and
     both should run. Membership IS "in progress" — exactly like the source's
     class check — so a re-hover mid-sweep is a no-op instead of a restart. */
  const [playing, setPlaying] = useState(() => new Set())

  /* Read in event handlers, so it never re-creates the callbacks. */
  const reducedRef = useRef(false)
  /* id -> backstop timeout. Cleared on release and on unmount. */
  const timersRef = useRef(new Map())
  const [ambient, setAmbient] = useState(false)

  const release = useCallback((id) => {
    const timers = timersRef.current
    const t = timers.get(id)
    if (t !== undefined) {
      clearTimeout(t)
      timers.delete(id)
    }
    setPlaying((prev) => {
      if (!prev.has(id)) return prev
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }, [])

  const play = useCallback(
    (id) => {
      if (reducedRef.current) return
      setPlaying((prev) => {
        // Already sweeping? Let the current pass finish — no restart, no stutter.
        if (prev.has(id)) return prev
        const next = new Set(prev)
        next.add(id)
        return next
      })
      const timers = timersRef.current
      if (!timers.has(id)) {
        timers.set(
          id,
          setTimeout(() => {
            timersRef.current.delete(id)
            release(id)
          }, SWEEP_MS + RELEASE_GRACE_MS),
        )
      }
    },
    [release],
  )

  /* prefers-reduced-motion: no sweeps, no ambient cycle. Watched rather than
     read once, so toggling the OS setting takes effect without a reload. */
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => {
      reducedRef.current = mq.matches
      setAmbient(!mq.matches)
    }
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  /* The ambient cycle. Steps one badge at a time so it reads as a slow pass
     around the cluster rather than a chorus. */
  useEffect(() => {
    if (!ambient) return undefined
    let i = 0
    const tick = setInterval(() => {
      play(SWEEPERS[i % SWEEPERS.length])
      i += 1
    }, AMBIENT_MS)
    return () => clearInterval(tick)
  }, [ambient, play])

  /* Hard teardown: the /work grid lazy-mounts and UNMOUNTS this tile, so every
     backstop still in flight has to go with it. */
  useEffect(() => {
    const timers = timersRef.current
    return () => {
      timers.forEach((t) => clearTimeout(t))
      timers.clear()
    }
  }, [])

  return (
    <div className="mv-scope cluster" role="group" aria-label="CrowdVolt badges and pills">
      {BADGES.map((b) => {
        const on = playing.has(b.id)
        // `play` sits in the rendered className (not classList, as the source
        // does) so styled-jsx's scope hash is already on the element and
        // `.badge.play::before` matches.
        const className = `badge ${b.kind}${on ? ' play' : ''}`
        // Both the ring and the label run the same-duration animation, so two
        // animationend events arrive; the first releases and the second no-ops.
        const onAnimationEnd = () => release(b.id)
        const enter = () => {
          if (b.sweep) play(b.id)
        }

        const inner = (
          <>
            {b.dot ? <span className="dot" aria-hidden /> : null}
            {b.icon === 'calendar' ? <CalendarIcon /> : null}
            {b.icon === 'x' ? <XIcon /> : null}
            {b.sweep ? (
              <span className={on ? 'label sweep' : 'label'}>{b.label}</span>
            ) : (
              b.label
            )}
          </>
        )

        // Written as two literal branches rather than a dynamic tag so
        // styled-jsx statically sees the element and scopes it.
        return b.tag === 'button' ? (
          <button
            key={b.id}
            type="button"
            className={className}
            aria-pressed={b.kind.includes('selected') ? true : undefined}
            onPointerEnter={enter}
            onFocus={enter}
            onAnimationEnd={onAnimationEnd}
          >
            {inner}
          </button>
        ) : (
          <span
            key={b.id}
            className={className}
            onPointerEnter={enter}
            onAnimationEnd={onAnimationEnd}
          >
            {inner}
          </span>
        )
      })}

      <style jsx>{`
        /* Transparent on purpose — the tile owns the dark surface. This
           overrides .mv-scope's own background without touching its tokens. */
        .cluster {
          width: 100%;
          min-width: 0;
          background: transparent;
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          align-content: center;
          justify-content: center;
          gap: 10px;
          min-height: 132px;
          padding: 16px 10px;
          font-family: var(--mv-font);
        }

        /* ── The shared pill ───────────────────────────────────────────────
           No border on ANY state: the masked ::before is the hairline at rest
           and the wave carrier on hover, so the box never changes size between
           on and off. Sizing is the source's px-4 py-2 / 14px / -0.025em. */
        .badge {
          /* Hero morph shimmer palette (HeroTextEngine DEFAULTS.shimmerA/B/C). */
          --sa: #6ee7ff;
          --sb: #ff9ecb;
          --sc: #ffd76e;
          /* The neutral the band rides over — the resting hairline itself. */
          --ring-base: var(--explore-hairline);
          /* The label's gradient base is its resting colour, so swapping the
             gradient in and out is invisible. */
          --label-base: rgba(255, 255, 255, 0.8);
          --shimmer-dur: 0.9s;
          --shimmer-ring: 1px;
          /* easeOutCubic: quick in, glides to a settle — snappy but smooth for
             a sweep this short. */
          --shimmer-ease: cubic-bezier(0.33, 1, 0.68, 1);

          position: relative;
          flex: 0 0 auto;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          white-space: nowrap;
          margin: 0;
          border: 0;
          border-radius: 9999px;
          padding: 8px 16px;
          background: rgba(255, 255, 255, 0.04);
          -webkit-backdrop-filter: blur(12px);
          backdrop-filter: blur(12px);
          font-family: inherit;
          font-size: 14px;
          font-weight: 500;
          line-height: 1.2;
          letter-spacing: -0.025em;
          color: var(--label-base);
          cursor: pointer;
          -webkit-tap-highlight-color: transparent;
          transition:
            background-color 0.15s ease-out,
            color 0.15s ease-out;
        }

        .badge:focus-visible {
          outline: 2px solid var(--explore-accent);
          outline-offset: 2px;
        }

        /* THE one border. inset:0 with no real border means this pseudo's box
           equals the border-box, so the 1px ring lands exactly on the true outer
           edge. The mask exclude-composite punches out the content box, leaving
           only the edge painted. Resting gradient shows just its neutral base;
           the coloured band lives off-window until a sweep brings it through. */
        .badge::before {
          content: '';
          position: absolute;
          inset: 0;
          border-radius: inherit;
          padding: var(--shimmer-ring);
          background-image: linear-gradient(
            100deg,
            var(--ring-base) 0 30%,
            var(--sa) 40%,
            var(--sb) 50%,
            var(--sc) 60%,
            var(--ring-base) 70% 100%
          );
          background-repeat: no-repeat;
          background-size: 400% 100%;
          background-position: 100% 0;
          -webkit-mask:
            linear-gradient(#000 0 0) content-box,
            linear-gradient(#000 0 0);
          mask:
            linear-gradient(#000 0 0) content-box,
            linear-gradient(#000 0 0);
          -webkit-mask-composite: xor;
          mask-composite: exclude;
          pointer-events: none;
        }

        .badge.play::before {
          animation: mv-pill-shimmer var(--shimmer-dur) var(--shimmer-ease) both;
        }

        /* ── The label ─────────────────────────────────────────────────────
           At rest the label is left COMPLETELY alone — plain inherited colour,
           no gradient, no clip. Painting the gradient at rest stacks it behind
           the semi-transparent fill and reads brighter, which made the hover
           look like a subtle dim. So the clip exists ONLY during the sweep. */
        .label {
          position: relative;
          z-index: 1;
        }

        .label.sweep {
          background-image: linear-gradient(
            100deg,
            var(--label-base) 0 30%,
            var(--sa) 40%,
            var(--sb) 50%,
            var(--sc) 60%,
            var(--label-base) 70% 100%
          );
          background-repeat: no-repeat;
          background-size: 400% 100%;
          background-position: 100% 0;
          -webkit-background-clip: text;
          background-clip: text;
          -webkit-text-fill-color: transparent;
          animation: mv-pill-shimmer var(--shimmer-dur) var(--shimmer-ease) both;
        }

        /* One pass, left to right. 100% → 0% is the coverage-safe range: outside
           it the gradient stops covering the box and the band parks. Rest = 100%
           (band off the left, hidden); the sweep carries the wide band fully
           across and it exits off the right at 0%, settling back to the bare
           neutral base. */
        @keyframes mv-pill-shimmer {
          from {
            background-position: 100% 0;
          }
          to {
            background-position: 0% 0;
          }
        }

        /* ── Variants ──────────────────────────────────────────────────────── */

        /* Selected date pill. Solid white, no ring, no sweep — the state the
           shimmer resolves back against. Same padding and font as the resting
           pill, so toggling never shifts the row. */
        .selected {
          background: #ffffff;
          color: #000000;
          -webkit-backdrop-filter: none;
          backdrop-filter: none;
        }
        .selected::before {
          display: none;
        }

        /* Header city pill — the same treatment one size down. */
        .small {
          padding: 4px 12px;
          font-size: 12px;
        }

        /* "Clear filter" — no surface and no ring, faint until hovered. Sweeps
           the label only. */
        .ghost {
          gap: 4px;
          padding: 8px 12px;
          background: transparent;
          -webkit-backdrop-filter: none;
          backdrop-filter: none;
          --label-base: rgba(255, 255, 255, 0.5);
        }
        .ghost::before {
          display: none;
        }

        /* Countdown chip off the trending cards. 6px radius rather than a pill,
           and the ring base is transparent so the band has clean ends and there
           is no hairline at rest — the chip sits on artwork, not on the page. */
        .timer {
          gap: 4px;
          border-radius: 6px;
          padding: 3px 7px;
          background: rgba(0, 0, 0, 0.65);
          -webkit-backdrop-filter: blur(4px);
          backdrop-filter: blur(4px);
          font-size: 10px;
          font-weight: 600;
          line-height: 1.1;
          letter-spacing: 0.08em;
          font-variant-numeric: tabular-nums;
          --label-base: #ffffff;
          --ring-base: transparent;
          --sa: var(--graphic-dupe-1);
          --sb: var(--graphic-dupe-2);
          --sc: var(--graphic-dupe-3);
        }

        .dot {
          flex: none;
          width: 4px;
          height: 4px;
          border-radius: 9999px;
          background: rgba(255, 255, 255, 0.9);
          box-shadow: 0 0 6px rgba(255, 255, 255, 0.6);
        }

        /* The resale notice — the one light badge, and the one that sweeps the
           brand ramp instead of the hero palette, since cyan on #f4f4f5 would
           vanish. Its ring base is the source's black/5 border. */
        .light {
          padding: 6px 12px;
          background: #f4f4f5;
          -webkit-backdrop-filter: none;
          backdrop-filter: none;
          box-shadow:
            0 10px 15px -3px rgba(0, 0, 0, 0.1),
            0 4px 6px -4px rgba(0, 0, 0, 0.1);
          --label-base: #18181b;
          --ring-base: rgba(0, 0, 0, 0.06);
          --sa: var(--graphic-dupe-1);
          --sb: var(--graphic-dupe-2);
          --sc: var(--graphic-dupe-3);
        }

        /* Hover surface changes are gated so a touch tap can't latch them on;
           the sweep itself is pointer-agnostic and fires on tap too. */
        @media (hover: hover) {
          .badge:hover {
            background: rgba(255, 255, 255, 0.08);
          }
          .selected:hover {
            background: #ffffff;
          }
          .ghost:hover {
            background: transparent;
            color: rgba(255, 255, 255, 0.8);
          }
          .timer:hover {
            background: rgba(0, 0, 0, 0.65);
          }
          .light:hover {
            background: #f4f4f5;
          }
        }

        /* Narrow tiles: shed the padding rather than the badges. */
        @media (max-width: 340px) {
          .cluster {
            gap: 8px;
            padding: 14px 6px;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .badge.play::before,
          .label.sweep {
            animation: none;
          }
        }
      `}</style>
    </div>
  )
})

export default ShimmerBadgesDemo
