'use client'

import { createContext, memo, useCallback, useContext, useEffect, useRef, useState } from 'react'

import './tokens.css'

/* ═══════════════════════════════════════════════════════════════════════════
 * HoloSticker — ported from
 *   mono-volt/apps/web/app/components/core/ui/HoloSticker.tsx
 *
 * Any SVG becomes a draggable holographic sticker. The wrapper is deliberately
 * NOT coupled to the artwork: you hand it a `src`, it supplies the behaviour and
 * the foil and stays out of the way.
 *
 * What it adds, and only this:
 *   - a staggered entrance pop-in, revealed on scroll-into-view (not on mount),
 *   - drag-and-drop with a springy pickup "lift",
 *   - a holographic sheen MASKED to the artwork's own alpha (`mask-image:
 *     url(src)`), so the iridescence paints only on the graphic — no background,
 *     no border, no shape of its own. The art owns its colour; the wrapper just
 *     makes it shimmer.
 *
 * <HoloStickerLayer> is the shared lighting/reveal context. It eases the cursor
 * into --hx/--hy, tracks its own progress through the viewport into --hs, and
 * flips a context flag once it scrolls into view. Both vars inherit down to
 * every sticker inside it, which is what makes the whole set light as one sheet.
 *
 * ── Two deliberate changes from the source, both forced by living in a /work
 *    grid tile rather than floating over a promo card ──
 *
 *   1. The layer is `position: relative` with its own height instead of
 *      `absolute inset-0`. Over there it was an overlay stretched across a card
 *      that already had a size; here it is the box, so it has to carry one.
 *   2. The drag is CLAMPED to the layer's rect. Over there the stickers were
 *      meant to break out of the card; here nothing may escape the tile. The
 *      release-outside spring-back is kept and still fires — it tests the
 *      POINTER against the box, which can leave even when the sticker cannot.
 *
 * ── Cleanup ── this grid lazy-mounts and UNMOUNTS its tiles, so every rAF,
 * window listener and IntersectionObserver here is torn down on unmount. See
 * the two effects in HoloStickerLayer: both return a full teardown, and the
 * pointer effect also strips the custom properties it wrote.
 * ═══════════════════════════════════════════════════════════════════════════ */

const HoloPlayContext = createContext(true)

function HoloStickerLayer({ children, className = '' }) {
  const ref = useRef(null)
  const [play, setPlay] = useState(false)

  // Reveal once the layer scrolls into view (runs regardless of reduced motion).
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setPlay(true)
          io.disconnect()
        }
      },
      { threshold: 0.15 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  // Cursor → eased --hx/--hy sheen vars. Skipped under reduced motion.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    let tx = 0
    let ty = 0
    let cx = 0
    let cy = 0
    let raf = 0
    let running = false
    let visible = true
    // Latched on teardown so a tick already queued for this frame can't write
    // to a detached node after the effect has been cleaned up.
    let dead = false

    const tick = () => {
      if (dead) return
      cx += (tx - cx) * 0.12
      cy += (ty - cy) * 0.12
      el.style.setProperty('--hx', cx.toFixed(4))
      el.style.setProperty('--hy', cy.toFixed(4))
      if (Math.abs(tx - cx) > 0.001 || Math.abs(ty - cy) > 0.001) {
        raf = requestAnimationFrame(tick)
      } else {
        running = false
      }
    }
    const start = () => {
      if (running || !visible || dead) return
      running = true
      raf = requestAnimationFrame(tick)
    }
    const onMove = (e) => {
      const r = el.getBoundingClientRect()
      if (!r.width || !r.height) return
      tx = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / (r.width / 2)))
      ty = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height / 2)) / (r.height / 2)))
      start()
    }
    window.addEventListener('pointermove', onMove, { passive: true })

    // Scroll progress (-1..1): the layer's position through the viewport. Drives
    // the foil even when the pointer is still, so it shimmers as you scroll past.
    const onScroll = () => {
      const r = el.getBoundingClientRect()
      const vh = window.innerHeight || 1
      const center = r.top + r.height / 2
      const p = (vh / 2 - center) / (vh / 2 + r.height / 2)
      el.style.setProperty('--hs', Math.max(-1, Math.min(1, p)).toFixed(4))
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()

    const io = new IntersectionObserver(
      ([entry]) => {
        visible = !!entry?.isIntersecting
        if (visible) start()
      },
      { threshold: 0 },
    )
    io.observe(el)

    return () => {
      dead = true
      cancelAnimationFrame(raf)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('scroll', onScroll)
      io.disconnect()
      el.style.removeProperty('--hx')
      el.style.removeProperty('--hy')
      el.style.removeProperty('--hs')
    }
  }, [])

  return (
    <div ref={ref} className={`holo-layer ${className}`}>
      <HoloPlayContext.Provider value={play}>{children}</HoloPlayContext.Provider>

      <style jsx>{`
        /* The source layer was an absolutely-positioned overlay (inset 0) across
           a card that already had a size. In a grid tile it IS the sized thing,
           so it holds its own height — and it clips, so a dragged sticker can
           never paint outside the tile. */
        .holo-layer {
          position: relative;
          width: 100%;
          /* A row of three, not a poster. The source floated these over a tall
             promo card; here they sit side by side in a band just tall enough
             to hold them and be dragged around in. */
          min-height: 150px;
          overflow: hidden;
          border-radius: var(--explore-radius, 0.75rem);
          pointer-events: none;
          touch-action: pan-y;
        }
      `}</style>
    </div>
  )
}

function HoloSticker({
  src,
  alt = '',
  // Placement inside the layer, as a plain style object ({ left, top, ... }).
  // The source took Tailwind offset classes; a style object keeps the sticker
  // free of any utility framework, per the port's constraints.
  at,
  rotate = 0,
  depth = 1,
  delay = 0,
  size = 80,
  width,
  holographic = true,
  maskToArt = true,
  parallax = false,
  draggable = true,
}) {
  const play = useContext(HoloPlayContext)

  const [off, setOff] = useState({ x: 0, y: 0 })
  const [held, setHeld] = useState(false)
  // True while springing back to origin after a release outside the box.
  const [returning, setReturning] = useState(false)
  const dragOrigin = useRef(null)
  // Drag limits, measured once per pickup so the move handler never re-measures.
  const bounds = useRef(null)

  const style = {
    '--rot': `${rotate}deg`,
    '--depth': depth,
    '--delay': `${delay}s`,
    '--holo-mask': `url("${src}")`,
    ...at,
    width,
    height: size,
    transform:
      off.x || off.y
        ? `translate(${off.x}px, ${off.y}px)`
        : returning
          ? 'translate(0px, 0px)'
          : undefined,
    transition: returning ? 'transform 0.55s cubic-bezier(0.22, 1, 0.36, 1)' : undefined,
    touchAction: draggable ? 'none' : undefined,
  }

  const onPointerDown = draggable
    ? (e) => {
        e.stopPropagation()
        const el = e.currentTarget
        setReturning(false)

        // Clamp window, in translate space. The sticker's UNTRANSLATED corner is
        // its current rect minus the offset already applied, so the whole thing
        // resolves from one measurement and stays correct mid-drag.
        const r = el.getBoundingClientRect()
        const box = el.parentElement?.getBoundingClientRect()
        if (box && box.width && box.height) {
          const baseL = r.left - off.x
          const baseT = r.top - off.y
          bounds.current = {
            minX: box.left - baseL,
            maxX: box.right - (baseL + r.width),
            minY: box.top - baseT,
            maxY: box.bottom - (baseT + r.height),
          }
        } else {
          bounds.current = null
        }

        dragOrigin.current = { x: e.clientX - off.x, y: e.clientY - off.y }
        setHeld(true)
        el.setPointerCapture(e.pointerId)
      }
    : undefined

  const onPointerMove = draggable
    ? (e) => {
        if (!dragOrigin.current) return
        let x = e.clientX - dragOrigin.current.x
        let y = e.clientY - dragOrigin.current.y
        const b = bounds.current
        if (b) {
          // Skip an axis the sticker cannot fit on rather than snapping it.
          if (b.maxX >= b.minX) x = Math.min(b.maxX, Math.max(b.minX, x))
          if (b.maxY >= b.minY) y = Math.min(b.maxY, Math.max(b.minY, y))
        }
        setOff({ x, y })
      }
    : undefined

  const onPointerUp = draggable
    ? (e) => {
        dragOrigin.current = null
        bounds.current = null
        setHeld(false)
        const el = e.currentTarget
        if (el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId)
        // Released with the POINTER outside the box (the layer fills it)? Spring
        // the sticker back to where it started instead of stranding it loose.
        const box = el.parentElement?.getBoundingClientRect()
        const outside =
          !!box &&
          (e.clientX < box.left ||
            e.clientX > box.right ||
            e.clientY < box.top ||
            e.clientY > box.bottom)
        if (outside) {
          setReturning(true)
          setOff({ x: 0, y: 0 })
        }
      }
    : undefined

  const onTransitionEnd = (e) => {
    if (e.target === e.currentTarget && e.propertyName === 'transform') setReturning(false)
  }

  return (
    <div
      className={`holo-sticker ${draggable ? 'is-draggable' : ''} ${held ? 'is-held' : ''}`}
      style={style}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onTransitionEnd={onTransitionEnd}
    >
      <div className={`holo-pop ${play ? 'is-playing' : ''}`}>
        <div className="holo-lift">
          <div className={`holo-tilt ${parallax ? 'is-parallax' : ''}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="holo-art" src={src} alt={alt} draggable={false} />
            {holographic && (
              <>
                <span className={`holo-rainbow ${maskToArt ? 'is-masked' : ''}`} aria-hidden />
                <span className={`holo-glare ${maskToArt ? 'is-masked' : ''}`} aria-hidden />
              </>
            )}
          </div>
        </div>
      </div>

      <style jsx>{`
        .holo-sticker {
          position: absolute;
        }
        .is-draggable {
          pointer-events: auto;
          cursor: grab;
        }
        .is-held {
          cursor: grabbing;
          z-index: 2;
        }
        .holo-pop {
          height: 100%;
          opacity: 0;
          transform: rotate(var(--rot, 0deg));
        }
        .holo-pop.is-playing {
          animation: holo-pop 0.7s cubic-bezier(0.34, 1.56, 0.64, 1) var(--delay, 0s) both;
        }
        /* Springy pickup lift. */
        .holo-lift {
          height: 100%;
          transform: scale(1);
          transition: transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
        }
        .is-held .holo-lift {
          transform: scale(1.14);
        }
        .holo-tilt {
          position: relative;
          height: 100%;
          perspective: 600px;
        }
        .holo-tilt.is-parallax {
          transform: rotateX(calc((var(--hy, 0) + var(--hs, 0)) * -10deg * var(--depth, 1)))
            rotateY(calc(var(--hx, 0) * 10deg * var(--depth, 1)));
          transition: transform 0.12s linear;
          will-change: transform;
        }
        .holo-art {
          display: block;
          height: 100%;
          width: auto;
          filter: drop-shadow(0 2px 5px rgba(0, 0, 0, 0.18));
        }
        .is-held .holo-art {
          filter: drop-shadow(0 8px 14px rgba(0, 0, 0, 0.26));
        }
        .holo-rainbow,
        .holo-glare {
          position: absolute;
          inset: 0;
          pointer-events: none;
        }
        /* When masked, the foil only paints on the graphic — never a rectangle
           behind it — so it conforms to any SVG silhouette (reusable). */
        .is-masked {
          -webkit-mask: var(--holo-mask) center / contain no-repeat;
          mask: var(--holo-mask) center / contain no-repeat;
        }
        /* Iridescent foil — its position is driven by the pointer (--hx/--hy) and
           scroll progress (--hs), so the colours slide as you move or scroll. The
           band of spectrum sweeps fully across the art over the pointer's range. */
        .holo-rainbow {
          background: linear-gradient(
            110deg,
            var(--graphic-dupe-1, #ff0000) 0%,
            var(--explore-accent, #fe5600) 20%,
            #ffd98a 38%,
            #8ff0cf 50%,
            #8fc9ff 62%,
            var(--graphic-dupe-3, #ffb37a) 80%,
            var(--graphic-dupe-1, #ff0000) 100%
          );
          /* Smaller than the art so SEVERAL hues span it at once = iridescent, not
             a flat one-colour wash. Position driven by pointer + scroll. */
          background-size: 150% 100%;
          background-position: calc(50% + (var(--hx, 0) + var(--hs, 0)) * 42%) 50%;
          /* normal blend so the foil reads on ANY artwork colour (incl. white art,
             where screen/color-dodge would wash out). Kept subtle. */
          opacity: 0.22;
        }
        /* Moving highlight that tracks the pointer + scroll — the glint that sells
           the foil. Screen over the (now tinted) art reads as a bright spot. */
        .holo-glare {
          background: radial-gradient(
            60% 60% at calc(50% + var(--hx, 0) * 42%)
              calc(50% + (var(--hy, 0) + var(--hs, 0)) * 42%),
            rgba(255, 252, 245, 0.28),
            rgba(255, 252, 245, 0) 75%
          );
          mix-blend-mode: screen;
          opacity: 0.22;
        }

        @keyframes holo-pop {
          0% {
            opacity: 0;
            transform: scale(0.2) rotate(calc(var(--rot, 0deg) - 16deg));
          }
          60% {
            opacity: 1;
            transform: scale(1.1) rotate(calc(var(--rot, 0deg) + 3deg));
          }
          100% {
            opacity: 1;
            transform: scale(1) rotate(var(--rot, 0deg));
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .holo-pop {
            opacity: 1;
          }
          .holo-pop.is-playing {
            animation: none;
          }
          .holo-lift,
          .holo-tilt.is-parallax {
            transition: none;
          }
        }
      `}</style>
    </div>
  )
}

/* ── The playground ────────────────────────────────────────────────────────
 * The three stickers CrowdVolt's promo banner wears, arranged so they sit
 * inside the tile instead of breaking out of a card. Pick them up and throw
 * them around; drop one with the pointer past the edge and it springs home.
 * ─────────────────────────────────────────────────────────────────────── */

const STICKERS = [
  {
    src: '/monovolt/holo-crowdvolt-logo.svg',
    alt: 'CrowdVolt',
    at: { left: '17%', top: 56 },
    rotate: -7,
    delay: 0.05,
    width: 132,
    size: 40,
    parallax: true,
    depth: 0.8,
  },
  {
    src: '/monovolt/holo-dj.svg',
    alt: 'DJ',
    at: { left: '42%', top: 18 },
    rotate: 8,
    delay: 0.18,
    size: 104,
    parallax: true,
  },
  {
    src: '/monovolt/holo-crowdvolt-figures.svg',
    alt: 'Crowd',
    at: { left: '66%', top: 30 },
    rotate: -5,
    delay: 0.31,
    size: 92,
    parallax: true,
    depth: 1.15,
  },
]

const StickersDemo = memo(function StickersDemo() {
  // No controls. The foil is on, the pop-in plays when the tile is reached,
  // and the only interaction is the one the component was built for: pick a
  // sticker up and move it.
  return (
    <div className="mv-scope stickers">
      <HoloStickerLayer>
        {STICKERS.map((s) => (
          <HoloSticker key={s.src} {...s} />
        ))}
      </HoloStickerLayer>

      <style jsx>{`
        /* Self-contained panel: the tile can drop this in anywhere on the light
           page and it still reads as a mono-volt surface. */
        .stickers {
          display: flex;
          width: 100%;
          min-width: 0;
          flex-direction: column;
          border-radius: var(--explore-radius);
          background: var(--explore-bg);
        }
      `}</style>
    </div>
  )
})

export default StickersDemo
