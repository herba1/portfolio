'use client'

import React, { memo, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'

import './tokens.css'

/* ═══════════════════════════════════════════════════════════════════════════
 * "Live in …" — the record deck off CrowdVolt's about page.
 *
 * Ported from
 *   mono-volt/apps/web/app/components/core/static-pages/about/VinylCarousel.tsx
 *   mono-volt/apps/web/app/globals.css                    (@keyframes rotateVinyl)
 *   mono-volt/apps/web/app/(pages)/(core)/(static)/about/page.tsx   (mount site)
 *
 * A finite ring of records. Every city is a square shrink-wrapped SLEEVE (a B&W
 * nightlife photo). The cities before the active one fan out as a LEFT stack,
 * the ones after as a RIGHT stack — always visible, overlapping — and the active
 * record sits centred, scaled up, with a spinning VINYL DISC slid out from
 * behind its right edge. Click a side record, drag across the deck, or arrow-key
 * to bring the next one forward; the cards CSS-transition between stack and
 * centre.
 *
 * Three things are moving at rest, all of them the source's:
 *   1. the centred disc spins at 8s / revolution, linear, forever;
 *   2. its label's lava-lamp blobs slosh on a 3.8s alternating drift;
 *   3. the disc slides out from behind the sleeve over one 4s beat, holds, then
 *      whips back in — landing tucked exactly as the deck advances. The slide IS
 *      the countdown. Touch it and the loop hands over to you; ten seconds idle
 *      and it quietly takes back over.
 *
 * The gloss on the centre sleeve and the card's tilt are one rAF loop LERPing
 * --px/--py toward the cursor at 0.16 — it stops the moment it catches up.
 *
 * ── What changed from the source, and why ─────────────────────────────────
 *
 *  · Layout is CONTAINER-relative, not viewport-relative. The source sizes the
 *    stage off vw and dials the fan down at 768/480px of *window*; a tile is a
 *    third of a window, so those breakpoints would never fire. Card width, stage
 *    height, heading size and the fan spread are all cqw/%, with one container
 *    query at 480px doing what the source's desktop default did.
 *  · The city word was Instrument Serif italic, which this site does not load.
 *    It falls back to the system serif italic — same shape of contrast against
 *    Inter/Geist for "Live in", no new font file.
 *  · The mobile pips are GONE. They were tab buttons; this tile is the
 *    interaction, so it has no control row. That also removes the only reason
 *    the source hid the disc on touch (the pips replaced it as the countdown
 *    indicator) — so the disc renders at every width here. At tile scale it is
 *    ~90px across rather than ~330px, which is nowhere near the compositor
 *    pressure that made them drop it. The pointer gloss and the rotateY tilt are
 *    still off under (hover: none), exactly as over there.
 *  · Sleeve art is a plain <img> at 480px-wide WebP (next/image is not in play
 *    here and the records never paint larger than ~150px).
 *  · The drag threshold is 44px, not 70px — a tile is a quarter of the width the
 *    original deck had to cross.
 *  · Colour, radius, hairline and type all read the tokens in ./tokens.css. The
 *    per-city accents are the source's own data and are kept verbatim; the disc's
 *    engraved text is var(--explore-text-muted), which IS the source's
 *    rgba(255,255,255,.6) to the digit.
 *
 * Everything that runs is torn down on unmount: the rAF, both observers, the
 * ResizeObserver, the fonts.ready promise (flag-guarded) and all three timers.
 * Under prefers-reduced-motion nothing loops — the spin, the label drift, the
 * countdown and the intro all stop, and the disc simply rests out.
 * ═══════════════════════════════════════════════════════════════════════════ */

const CITIES = [
  { city: 'New York', accent: '#3B6BFF', image: '/monovolt/abt6.webp' },
  { city: 'Los Angeles', accent: '#FF6B4A', image: '/monovolt/abt1.webp' },
  { city: 'San Francisco', accent: '#15C2B0', image: '/monovolt/abt10.webp' },
  { city: 'Miami', accent: '#FF3FA4', image: '/monovolt/abt7.webp' },
  { city: 'Chicago', accent: '#9710FF', image: '/monovolt/abt5.webp' },
]

const AUTO_ADVANCE_MS = 4000 // hands-off cadence between cities
const RESUME_AFTER_MS = 10000 // idle time before the loop takes back over
const DRAG_PX = 44 // travel that counts as "next record"

// Per-character heading switch timing (seconds). Outgoing chars stagger out, the
// incoming word waits the whole exit, then staggers in — so one word fully leaves
// before the other arrives.
const CHAR_EXIT_STAGGER = 0.012 // keep in sync with the [data-prev] char delay
const CHAR_EXIT_DUR = 0.26

// Split every city into characters ONCE at module load — the words never change,
// so there is no reason to re-derive these arrays on every render.
const CITY_CHARS = CITIES.map((c) => Array.from(c.city))

// useLayoutEffect warns when a tree is rendered on the server; the measurement it
// guards is a no-op there anyway.
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect

const VinylCarouselDemo = memo(function VinylCarouselDemo() {
  const uid = useId().replace(/:/g, '') // textPath ids must be unique per mount
  const n = CITIES.length

  const [idx, setIdx] = useState(0)
  const [prevIdx, setPrevIdx] = useState(null)
  // Signed shortest step of the last change (e.g. +1, -1, +2). The seam-crossing
  // card in the deck reads this to know which way the ring turned, so it can
  // teleport to the far side instead of sliding across the whole stage.
  const [step, setStep] = useState(1)
  // Heading geometry — measured ONCE (and on resize), not per switch. The
  // "Live in <city>" phrase is centred with a TRANSFORM (translateX) instead of
  // an animated slot width: the slot is zero-width, every city word is
  // permanently mounted, and the whole line slides by -(live + activeWord)/2 to
  // stay centred. Sliding a transform is GPU-composited; animating width was a
  // per-frame layout reflow — the jump.
  const [dims, setDims] = useState({ live: 0, words: [] })
  const [isIn, setIsIn] = useState(false) // intro: true once scrolled into view

  const idxRef = useRef(0)
  const rootRef = useRef(null)
  const h2Ref = useRef(null)
  const liveRef = useRef(null)
  const wordRefs = useRef([])
  const drag = useRef({ down: false, startX: 0, moved: false })
  const centerRef = useRef(null)
  const stageRef = useRef(null)
  const rafRef = useRef(null)
  // Pointer gloss + tilt: the cursor sets a TARGET, a rAF loop LERPs the live
  // value toward it (eased follow) and writes --px/--py on the stage. The gloss
  // gradient and the card tilt both read those vars. Pure CSS paint/transform —
  // no per-frame filter recompute.
  const target = useRef({ x: 0.5, y: 0.5 })
  const cur = useRef({ x: 0.5, y: 0.5 })
  const looping = useRef(false)
  const alive = useRef(true)

  // Auto-loop: hands-off the deck advances on its own ("auto"); ANY interaction
  // switches to "manual", and after 10s idle it quietly resumes.
  const [mode, setMode] = useState('auto')
  const modeRef = useRef('auto') // avoid stale closures + redundant setState
  const [tick, setTick] = useState(0) // bump to re-arm the loop when a beat is skipped
  const lastInteract = useRef(-Infinity)
  const onScreen = useRef(false)

  // Stamp the time on every interaction (cheap, ref-only so pointermove is free)
  // and flip to manual ONCE per burst — never setState on every mouse move.
  const markInteract = useCallback(() => {
    lastInteract.current = performance.now()
    if (modeRef.current !== 'manual') {
      modeRef.current = 'manual'
      setMode('manual')
    }
  }, [])

  // Single source of truth for navigation — refs keep the drag/keyboard handlers
  // free of stale `idx` closures.
  const change = useCallback(
    (next) => {
      // Endless ring — WRAP instead of clamp, so arrow/drag/auto all loop past
      // either end (clamping dead-stopped nav at the first/last city).
      const wrapped = ((next % n) + n) % n
      if (wrapped === idxRef.current) return
      // Shortest signed path around the ring: clicking a far card (or wrapping
      // last→first) advances the SHORT way, and the deck below uses this sign to
      // teleport the seam-crossing card the right direction.
      let d = wrapped - idxRef.current
      if (d > n / 2) d -= n
      else if (d < -n / 2) d += n
      setStep(d)
      setPrevIdx(idxRef.current)
      idxRef.current = wrapped
      setIdx(wrapped)
    },
    [n],
  )

  // Measure "Live in" + every city word ONCE, then only on resize. The per-switch
  // slide reads these cached widths; it never touches the DOM.
  useIsoLayoutEffect(() => {
    let cancelled = false
    const measure = () => {
      if (cancelled) return
      setDims({
        live: liveRef.current?.offsetWidth ?? 0,
        words: wordRefs.current.map((el) => el?.offsetWidth ?? 0),
      })
    }
    measure()
    // Re-measure once the real italic actually loads — a fallback face is a
    // different width, and the h2 box does not change on a font swap, so the
    // ResizeObserver alone would leave the phrase off-centre.
    if (document.fonts?.ready) document.fonts.ready.then(measure).catch(() => {})
    const ro = new ResizeObserver(measure)
    if (h2Ref.current) ro.observe(h2Ref.current)
    return () => {
      cancelled = true
      ro.disconnect()
    }
  }, [])

  // Retire the outgoing word after its staggered per-char exit completes, so it
  // is fully gone before we drop it back to the idle waiting state.
  useEffect(() => {
    if (prevIdx === null) return
    const t = setTimeout(() => setPrevIdx(null), 750)
    return () => clearTimeout(t)
  }, [prevIdx, idx])

  // Eased follow loop — runs only while the value has not caught up to target.
  const runLerp = useCallback(() => {
    if (looping.current || !alive.current) return
    looping.current = true
    const frame = () => {
      if (!alive.current) {
        looping.current = false
        return
      }
      const t = target.current
      const c = cur.current
      c.x += (t.x - c.x) * 0.16
      c.y += (t.y - c.y) * 0.16
      const stage = stageRef.current
      if (stage) {
        stage.style.setProperty('--px', c.x.toFixed(4))
        stage.style.setProperty('--py', c.y.toFixed(4))
      }
      if (Math.abs(t.x - c.x) > 0.0008 || Math.abs(t.y - c.y) > 0.0008) {
        rafRef.current = requestAnimationFrame(frame)
      } else {
        looping.current = false
      }
    }
    rafRef.current = requestAnimationFrame(frame)
  }, [])

  const onPointerDown = useCallback((e) => {
    // Just arm drag-tracking. Pausing happens on a real act — a card click, a
    // drag that crosses the threshold, or an arrow key — not on bare press/hover.
    drag.current = { down: true, startX: e.clientX, moved: false }
  }, [])

  const onPointerMove = useCallback(
    (e) => {
      // 1) gloss/tilt tracking only — HOVERING never pauses the loop. The cursor
      //    just steers the highlight; the auto-show keeps running underneath it.
      //    MOUSE ONLY: on touch there is no hover, and writing --px/--py every
      //    touchmove would repaint the screen-blended gloss each frame — stealing
      //    exactly the frames the drag-to-change gesture needs to stay smooth.
      if (e.pointerType === 'mouse') {
        const card = centerRef.current
        if (card) {
          const rc = card.getBoundingClientRect()
          target.current.x = Math.min(1, Math.max(0, (e.clientX - rc.left) / rc.width))
          target.current.y = Math.min(1, Math.max(0, (e.clientY - rc.top) / rc.height))
          runLerp()
        }
      }
      // 2) drag-to-advance — a held-pointer drag IS a real interaction
      if (!drag.current.down) return
      const dx = e.clientX - drag.current.startX
      if (Math.abs(dx) > DRAG_PX) {
        markInteract()
        change(idxRef.current + (dx < 0 ? 1 : -1))
        drag.current.startX = e.clientX
        drag.current.moved = true
      }
    },
    [change, runLerp, markInteract],
  )

  const endDrag = useCallback(() => {
    drag.current.down = false
  }, [])

  const onPointerLeave = useCallback(() => {
    drag.current.down = false
    target.current = { x: 0.5, y: 0.5 } // ease back to centre
    runLerp()
  }, [runLerp])

  const onKeyDown = useCallback(
    (e) => {
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        markInteract()
        change(idxRef.current + 1)
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        markInteract()
        change(idxRef.current - 1)
      }
    },
    [change, markInteract],
  )

  // Intro: reveal once, and only once the tile is meaningfully on screen.
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setIsIn(true)
          io.disconnect()
        }
      },
      { threshold: 0, rootMargin: '0px 0px -12% 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  // Track on-screen-ness for the life of the tile (the intro IO above disconnects
  // after one shot) so the auto-loop never cycles records nobody can see.
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const io = new IntersectionObserver(
      ([entry]) => {
        onScreen.current = !!entry?.isIntersecting
      },
      { threshold: 0.3 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  // While idle, a manual burst hands control back: once 10s pass with no
  // interaction we flip to auto, which (re)starts the countdown below.
  useEffect(() => {
    if (mode !== 'manual') return
    const id = setInterval(() => {
      if (performance.now() - lastInteract.current >= RESUME_AFTER_MS) {
        modeRef.current = 'auto'
        setMode('auto')
      }
    }, 500)
    return () => clearInterval(id)
  }, [mode])

  // The countdown to the next city. One timer, re-armed on each switch (idx) so
  // the disc slide (var(--tick), same idx-keyed restart) stays perfectly in phase
  // with it — the disc lands tucked exactly as this fires. Holds — re-arming
  // without advancing — while off-screen or tab-hidden. Disabled for
  // reduced-motion and until the tile has scrolled in.
  useEffect(() => {
    if (!isIn || mode !== 'auto') return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const t = setTimeout(() => {
      if (!onScreen.current || document.hidden) {
        setTick((v) => v + 1) // skip this beat, keep the loop alive
        return
      }
      change(idxRef.current + 1)
    }, AUTO_ADVANCE_MS)
    return () => clearTimeout(t)
  }, [isIn, mode, idx, tick, change])

  // The grid unmounts this tile once it is far off screen. Nothing may outlive
  // it. (The flag is re-armed on the way IN as well as cleared on the way out,
  // so StrictMode's mount → unmount → mount does not leave the lerp dead.)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      looping.current = false
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [])

  const activeCity = CITIES[idx]
  // Centre the phrase by sliding the line left by half its total width. Only the
  // active word's cached width feeds this — pure transform, no layout.
  const headShift = -(dims.live + (dims.words[idx] ?? 0)) / 2
  // Per-character switch: the outgoing word fully flies out (staggered) BEFORE
  // the incoming word drops in. The incoming chars wait out the exit — its
  // length × stagger + the char duration — then stagger in.
  const enterBase =
    prevIdx != null ? CITY_CHARS[prevIdx].length * CHAR_EXIT_STAGGER + CHAR_EXIT_DUR : 0

  return (
    <section
      ref={rootRef}
      aria-label="Cities CrowdVolt lives in"
      className={`mv-scope vinyl${isIn ? ' is-in' : ''}`}
      style={{ '--accent': activeCity.accent, '--tick': `${AUTO_ADVANCE_MS}ms` }}
    >
      {/* Heading — the line slides so "Live in" stays centred as the city word
          changes width, and the word itself swaps character by character. */}
      <header className="header">
        <h2 ref={h2Ref} className="h2">
          <span className="line" style={{ transform: `translateX(${headShift}px)` }}>
            <span ref={liveRef} className="liveText">
              Live in&nbsp;
            </span>
            <span className="wordslot">
              {CITIES.map((c, i) => (
                <span
                  key={c.city}
                  ref={(el) => {
                    wordRefs.current[i] = el
                  }}
                  className="word"
                  data-active={i === idx}
                  data-prev={i === prevIdx}
                  aria-label={c.city}
                  aria-hidden={i !== idx}
                  style={{
                    '--accent': c.accent,
                    '--enter-base': i === idx ? `${enterBase}s` : '0s',
                  }}
                >
                  {CITY_CHARS[i].map((ch, ci) => (
                    <span key={ci} aria-hidden className="char" style={{ '--ci': ci }}>
                      {/* the clip lives on the static inner fill; the wrapper does
                          the transform (Safari background-clip + transform bug) */}
                      <span className="char__fill">{ch === ' ' ? ' ' : ch}</span>
                    </span>
                  ))}
                </span>
              ))}
            </span>
          </span>
        </h2>
      </header>

      {/* Deck */}
      <div
        ref={stageRef}
        role="group"
        tabIndex={0}
        aria-label="Drag or use arrow keys to change city"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={onPointerLeave}
        onKeyDown={onKeyDown}
        className="stage"
        style={{ '--px': 0.5, '--py': 0.5 }}
      >
        {CITIES.map((c, i) => {
          // Circular rank: shortest signed distance around the ring (−half…+half),
          // so the SAME balanced fan shows at every position and the deck loops
          // forever instead of rewinding the whole stack after the last city.
          const wrapRank = (center) => {
            let rr = i - center
            if (rr > n / 2) rr -= n
            else if (rr < -n / 2) rr += n
            return rr
          }
          const r = wrapRank(idx) // <0 left stack, 0 centre, >0 right stack
          const abs = Math.abs(r)
          const isCenter = r === 0
          const side = r < 0 ? -1 : 1
          // The one far-edge card that crosses the seam each step (far-left →
          // far-right as the deck advances) must NOT slide across the whole stage —
          // teleport it instantly. The eye is on the centre; that dim edge card
          // swapping sides is invisible, but a slide there is an ugly streak.
          const prevR = prevIdx != null ? wrapRank(prevIdx) : r
          const seam = prevIdx != null && Math.abs(prevR - step) > n / 2

          // Stacks live on the SAME z-plane as each other — no receding into the
          // distance. They just fan sideways with a constant rotation and a wide
          // gap so they never step on one another. Centre pops forward a touch.
          const sc = isCenter ? 1 : Math.max(0.58, 0.72 - (abs - 1) * 0.05)
          const dim = isCenter ? 0 : Math.min(0.6, 0.32 + (abs - 1) * 0.13)

          // Position lives on the card (reposition transition); the pointer tilt
          // lives on an inner wrapper so the two never fight over `transform`.
          // The fan distance and the side tilt come from custom properties so a
          // CONTAINER query can widen the spread on a roomier tile — JS only
          // supplies the side (±1) and the rank.
          const x = `calc(${side} * (var(--gap-base) + ${abs - 1} * var(--gap-step)))`
          // Depth ordering, NOT z-index. Each card sits at its own translateZ —
          // centre forward, every rank stepped back — so in the preserve-3d
          // context the browser paints them by real depth. That ordering is
          // CONTINUOUS: a card rising forward crosses the others smoothly instead
          // of z-index's one-frame flip (the glitch, and the dark disc peeking
          // through at the swap).
          const z = isCenter ? 'var(--cz)' : `calc(${-abs} * var(--zstep))`
          const rotY = `calc(${-side} * var(--rot))` // constant tilt per side
          const transform = isCenter
            ? `translate(-50%, -50%) translateY(-2%) translateZ(${z})`
            : `translate(-50%, -50%) translateY(-2%) translateX(${x}) translateZ(${z}) rotateY(${rotY}) scale(${sc})`
          const tilt = isCenter
            ? 'rotateY(calc((var(--px) - 0.5) * 15deg)) rotateX(calc((0.5 - var(--py)) * 11deg))'
            : 'none'

          return (
            <button
              key={c.city}
              type="button"
              aria-label={`Show ${c.city}`}
              aria-current={isCenter}
              onClick={() => {
                markInteract()
                if (drag.current.moved) return // ignore the click that ends a drag
                change(i)
              }}
              ref={isCenter ? centerRef : null}
              data-center={isCenter}
              className="card"
              style={{
                transform,
                // Teleport (no slide) only for the card wrapping across the seam;
                // every other card keeps its eased reposition transition.
                transition: seam ? 'none' : undefined,
                cursor: isCenter ? 'default' : 'pointer',
                '--accent': c.accent,
              }}
            >
              <div className="card__intro" style={{ '--enter-delay': `${abs * 0.09}s` }}>
                {/* lift = hover raise (sides); tilt = pointer tilt (centre) */}
                <div className="card__lift">
                  <div className="card__tilt" style={isCenter ? { transform: tilt } : undefined}>
                    {/* VINYL DISC — behind the sleeve; in auto mode it slides out
                        over the countdown (the slide IS the timer); fully out =
                        next city. */}
                    <div className="disc" data-center={isCenter} data-auto={isIn && isCenter && mode === 'auto'} aria-hidden>
                      <div className="disc__spin">
                        <div className="disc__label" />
                        {/* city printed around the label radius — subtle, rotates */}
                        <svg className="disc__text" viewBox="0 0 100 100">
                          <defs>
                            <path
                              id={`vinyl-ring-${uid}-${i}`}
                              fill="none"
                              d="M50,50 m-11,0 a11,11 0 1,1 22,0 a11,11 0 1,1 -22,0"
                            />
                          </defs>
                          <text
                            style={{
                              fill: 'var(--explore-text-muted)',
                              fontSize: '2.4px',
                              fontWeight: 500,
                              letterSpacing: '0.3px',
                            }}
                          >
                            <textPath href={`#vinyl-ring-${uid}-${i}`} startOffset="0">
                              {`${c.city} · `.repeat(3)}
                            </textPath>
                          </text>
                        </svg>
                        <div className="disc__hole" />
                      </div>
                      {/* fixed soft sheen — angular reflection, stays put as it spins */}
                      <div className="disc__sheen" />
                    </div>

                    {/* SLEEVE */}
                    <div className="sleeve">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={c.image}
                        alt={`${c.city} — CrowdVolt`}
                        className="sleeve__art"
                        draggable={false}
                        loading="lazy"
                        decoding="async"
                      />
                      {/* shrink-wrap gloss: soft pointer-tracked highlight on the
                          centre, nothing on the stacked sides */}
                      <div className="sleeve__wrap" data-center={isCenter} aria-hidden />
                      {/* depth dim for stacked cards */}
                      <div className="sleeve__dim" aria-hidden style={{ opacity: dim }} />
                    </div>
                  </div>
                </div>
              </div>
            </button>
          )
        })}
      </div>

      <style jsx>{`
        /* One shared easing + entrance timing so the whole tile moves as one:
           ease-out-weighted in-out — gentle accel, strong soft settle. */
        .vinyl {
          --ease: cubic-bezier(0.5, 0, 0.1, 1);
          --enter-dur: 0.7s;
          position: relative;
          overflow: hidden;
          width: 100%;
          min-width: 0;
          min-height: 246px;
          display: flex;
          flex-direction: column;
          justify-content: center;
          padding: 14px 0 18px;
          border-radius: var(--explore-radius);
          background: var(--explore-bg);
          font-family: var(--mv-font);
          color: var(--explore-text);
          /* the whole layout is sized off THIS box, not the window — a tile is a
             third of a viewport, so vw would have been meaningless here */
          container-type: inline-size;
          /* Force grayscale smoothing for ALL text in the tile. When a card is
             composited onto a GPU layer during a transform the browser cannot use
             subpixel antialiasing and silently drops to grayscale — text dims;
             released, it snaps back — a brightness POP with no animation. Pinning
             grayscale means the AA mode never changes, so nothing can pop. */
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
        }

        /* ---------- heading ---------- */
        .header {
          position: relative;
          z-index: 2;
          display: flex;
          justify-content: center;
          padding: 0 12px;
          margin-bottom: clamp(8px, 2.4cqw, 18px);
        }
        /* Intro: the heading rises with the same curve, a beat after the records.
           The intro transform lives on the .h2 box; the per-switch centring slide
           lives on the inner .line — separate elements so they never fight. */
        .h2 {
          position: relative;
          display: block;
          width: 100%;
          height: 1em;
          margin: 0;
          font-size: clamp(19px, 5.4cqw, 32px);
          font-weight: 400;
          line-height: 1;
          opacity: 0;
          transform: translateY(18px);
          transition:
            opacity var(--enter-dur) var(--ease),
            transform var(--enter-dur) var(--ease);
          transition-delay: 0.3s;
        }
        .is-in .h2 {
          opacity: 1;
          transform: translateY(0);
        }
        /* left:50% + translateX(-(live + word)/2) keeps "Live in <city>" centred
           as the word changes width — a GPU transform, never a layout reflow. */
        .line {
          position: absolute;
          left: 50%;
          bottom: 0;
          display: inline-flex;
          /* baseline — NOT flex-end. The italic word's fill carries a
             padding-bottom (to fill descenders), which makes its box taller;
             box-bottom alignment would ride it up. */
          align-items: baseline;
          white-space: nowrap;
          will-change: transform;
          transition: transform 0.55s cubic-bezier(0.22, 1, 0.36, 1);
        }
        .liveText {
          display: inline-block;
          font-family: var(--font-inter), var(--mv-font);
          font-weight: 500;
          letter-spacing: -0.03em;
          color: var(--explore-text);
        }
        /* Zero-width grid: every city word stacks in the SAME cell so they overlap
           and overflow the 0-width track — the slot never adds layout width, and a
           grid preserves the words' baseline (absolute positioning would not). */
        .wordslot {
          display: inline-grid;
          grid-template-columns: 0;
          width: 0;
        }
        .word {
          grid-row: 1;
          grid-column: 1;
          justify-self: start;
          line-height: 1;
          white-space: nowrap;
        }
        /* The transform lives on .char; the gradient text-clip lives on the INNER
           .char__fill, which never transforms. Safari intermittently drops the fill
           of a -webkit-background-clip:text element while a transform animates on
           that same element — keep the clip on a static child. */
        .char {
          display: inline-block;
          white-space: pre;
          opacity: 0;
          transform: translateY(0.62em);
          transition:
            opacity 0.36s var(--ease),
            transform 0.36s var(--ease);
          will-change: transform, opacity;
        }
        .word[data-active='true'] .char {
          opacity: 1;
          transform: translateY(0);
          transition:
            opacity 0.42s var(--ease),
            transform 0.42s var(--ease);
          transition-delay: calc(var(--enter-base, 0s) + var(--ci) * 0.016s);
        }
        .word[data-prev='true'] .char {
          opacity: 0;
          transform: translateY(-0.62em);
          transition:
            opacity 0.26s var(--ease),
            transform 0.26s var(--ease);
          transition-delay: calc(var(--ci) * 0.012s);
        }
        .char__fill {
          display: inline-block;
          /* Instrument Serif italic in the source; the system serif italic here. */
          font-family: ui-serif, Georgia, 'Times New Roman', serif;
          font-style: italic;
          font-weight: 300;
          /* background-clip:text only paints WITHIN this box. Italic glyphs
             overhang their advance width and descenders drop below the line — both
             would render transparent, the "cut off" look. Pad the paint box out,
             then cancel it with equal negative margins so the layout advance (and
             the per-char spacing) is unchanged. */
          padding: 0.16em 0.22em 0.28em;
          margin: -0.16em -0.22em -0.28em;
          /* Static vertical wash — accent across the top melting into white. No
             animated background-position (per-frame paint) and no drop-shadow.
             Motion here lives on the spinning disc and its drifting label. */
          background-image: linear-gradient(
            to bottom,
            var(--accent, var(--explore-accent)) 0%,
            color-mix(in oklab, var(--accent, var(--explore-accent)) 76%, #fff 24%) 32%,
            color-mix(in oklab, var(--accent, var(--explore-accent)) 26%, #fff 74%) 62%,
            var(--explore-text) 100%
          );
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
          -webkit-text-fill-color: transparent;
        }

        /* ---------- stage ---------- */
        .stage {
          position: relative;
          z-index: 1;
          width: 100%;
          height: clamp(150px, 46cqw, 214px);
          perspective: 900px;
          /* preserve-3d (not just perspective) is what makes the child cards paint
             by real depth instead of DOM order — required for translateZ to do the
             stacking. */
          transform-style: preserve-3d;
          touch-action: pan-y;
          user-select: none;
          outline: none;
          /* Fan-out distance of the side records (% of a card's own width) plus the
             side tilt. A narrow tile dials both down so the outer vinyls do not
             fling off the edges and the switch is not a big, hard 3D swing. */
          --gap-base: 86%;
          --gap-step: 38%;
          --rot: 40deg;
          /* Per-rank depth step — orders the stack by translateZ instead of
             z-index, so the swap crosses smoothly with nothing peeking through.
             Kept modest: any Z gap at all is enough to order them. */
          --cz: 26px;
          --zstep: 14px;
        }
        @container (min-width: 480px) {
          .stage {
            --gap-base: 106%;
            --gap-step: 46%;
            --rot: 48deg;
            --cz: 34px;
            --zstep: 18px;
          }
        }
        .stage:focus-visible {
          outline: 2px solid var(--explore-hairline-strong);
          outline-offset: -2px;
          border-radius: var(--explore-radius);
        }

        /* ---------- card ---------- */
        .card {
          position: absolute;
          left: 50%;
          top: 50%;
          width: clamp(88px, 38cqw, 150px);
          aspect-ratio: 1;
          transform-style: preserve-3d;
          transition: transform 0.62s var(--ease);
          will-change: transform;
          background: none;
          border: 0;
          padding: 0;
          outline-offset: 8px;
          -webkit-tap-highlight-color: transparent;
        }
        .card:focus-visible {
          outline: 2px solid color-mix(in srgb, var(--accent, var(--explore-accent)) 80%, white);
        }
        /* intro layer — staggered slide-in from the right + up, once on scroll;
           same curve and duration as the heading so they read as one motion */
        .card__intro {
          position: absolute;
          inset: 0;
          transform-style: preserve-3d;
          opacity: 0;
          transform: translate3d(36px, 20px, 0);
          transition:
            transform var(--enter-dur) var(--ease),
            opacity var(--enter-dur) var(--ease);
          transition-delay: var(--enter-delay, 0s);
        }
        .is-in .card__intro {
          opacity: 1;
          transform: translate3d(0, 0, 0);
        }
        /* lift = hover raise on the side records; the transition is matched to the
           reposition so clicking a raised card eases back DOWN, never snaps */
        .card__lift {
          position: absolute;
          inset: 0;
          transform-style: preserve-3d;
          transition: transform 0.5s var(--ease);
        }
        @media (hover: hover) {
          .card[data-center='false']:hover .card__lift {
            transform: translateY(-12px);
          }
        }
        /* tilt = pointer tilt on the centre record only — snappy follow */
        .card__tilt {
          position: absolute;
          inset: 0;
          transform-style: preserve-3d;
          transition: transform 0.2s ease-out;
          will-change: transform;
        }

        /* ---------- sleeve ---------- */
        .sleeve {
          position: absolute;
          inset: 0;
          border-radius: 5px;
          overflow: hidden;
          z-index: 2;
          transform: translateZ(1px);
          background: var(--explore-surface);
          box-shadow:
            0 2px 5px rgba(0, 0, 0, 0.32),
            0 10px 24px -18px rgba(0, 0, 0, 0.45),
            inset 0 0 0 1px var(--explore-hairline);
        }
        .sleeve__art {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          object-fit: cover;
          filter: contrast(1.04) brightness(0.98) saturate(1.05);
          /* Feather the photo's bottom into transparency — the deck is overflow-
             clipped, so a fanned sleeve gets hard-cut at the bottom and reads as a
             sharp grain band. The sleeve behind it is the surface token, so fading
             the photo dissolves the band. Masked on the <img> leaf: Chromium drops
             masks on the translateZ'd sleeve container but honours them here. */
          -webkit-mask-image: linear-gradient(to bottom, #000 66%, transparent 97%);
          mask-image: linear-gradient(to bottom, #000 66%, transparent 97%);
        }
        /* One gloss for every card — a soft pointer-tracked radial highlight,
           hidden on the stacked cards and FADED in on the active one (no instant
           background swap, so no stripe snapping in and out). */
        .sleeve__wrap {
          position: absolute;
          inset: 0;
          pointer-events: none;
          mix-blend-mode: screen;
          background: radial-gradient(
            62% 62% at calc(var(--px, 0.5) * 100%) calc(var(--py, 0.5) * 100%),
            rgba(255, 255, 255, 0.22) 0%,
            rgba(255, 255, 255, 0.09) 34%,
            rgba(255, 255, 255, 0.02) 56%,
            transparent 74%
          );
          opacity: 0;
          transition: opacity 0.45s var(--ease);
        }
        .sleeve__wrap[data-center='true'] {
          opacity: 1;
        }
        /* Opacity is set INLINE, not through a custom property: an unregistered
           var() cannot be interpolated, so the stacked cards' darkening snapped
           instead of easing. A real number on a standard property eases cleanly. */
        .sleeve__dim {
          position: absolute;
          inset: 0;
          background: #04040a;
          transition: opacity 0.6s ease;
          pointer-events: none;
        }

        /* ---------- vinyl disc ---------- */
        .disc {
          position: absolute;
          top: 50%;
          left: 50%;
          width: 82%;
          aspect-ratio: 1;
          border-radius: 50%;
          z-index: 1;
          transform: translate(-50%, -50%) translateZ(-1px);
          /* Retract immediately when leaving centre. Only transform transitions —
             the drop-shadow is a static filter and rides along on the composited
             layer as the disc slides. */
          transition: transform 0.45s cubic-bezier(0.5, 0, 0.75, 0);
          filter: drop-shadow(6px 5px 11px rgba(0, 0, 0, 0.42));
        }
        /* MANUAL MODE (centred, no countdown): the disc still pops out and rests
           there — the signature look. When the auto animation is removed (you
           interact), transform reverts to this and the disc eases out to rest.
           Scoped under .is-in so a not-yet-revealed card stays tucked and its first
           auto countdown emerges cleanly from behind the sleeve. */
        .is-in .disc[data-center='true'] {
          transform: translate(-50%, -50%) translateX(54%) translateZ(-1px);
          transition: transform 0.7s cubic-bezier(0.22, 1, 0.36, 1) 0.08s;
        }
        /* AUTO MODE: the disc IS the countdown. Over one beat (var(--tick)) it
           slides slowly out from behind the sleeve, holds fully out for a moment,
           then WHIPS back in — landing tucked exactly as the deck advances, so the
           switch happens at the handoff and the next card's disc emerges from a
           clean tucked start. It restarts on each switch because the incoming
           centre card gains [data-auto] fresh. */
        .disc[data-center='true'][data-auto='true'] {
          animation: discEmerge var(--tick, 4000ms) both;
        }
        @keyframes discEmerge {
          0% {
            transform: translate(-50%, -50%) translateZ(-1px);
            animation-timing-function: cubic-bezier(0.22, 0.61, 0.36, 1); /* slow settling slide-out */
          }
          88% {
            transform: translate(-50%, -50%) translateX(54%) translateZ(-1px);
            animation-timing-function: linear; /* brief hold, fully out */
          }
          94% {
            transform: translate(-50%, -50%) translateX(54%) translateZ(-1px);
            animation-timing-function: cubic-bezier(0.6, 0, 0.85, 0.2); /* whip back in */
          }
          100% {
            transform: translate(-50%, -50%) translateZ(-1px);
          }
        }
        .disc__spin {
          position: absolute;
          inset: 0;
          border-radius: 50%;
          overflow: hidden;
          background:
            repeating-radial-gradient(
              circle at 50% 50%,
              #0c0c0c 0px,
              #0c0c0c 1px,
              #1b1b1b 2px,
              #050505 3px
            ),
            radial-gradient(circle at 50% 50%, var(--explore-surface) 0%, #000 78%);
          /* Spin only the centred record — the rest are paused behind their
             sleeves, so we never animate four hidden discs.
             NO will-change: it would permanently promote this layer (which sits
             BELOW the opaque sleeve), forcing the sleeve and its dark box-shadow
             into an implicit layer that desyncs during a card move — the "black
             outline" artifact. The running spin composites on its own anyway. */
          animation: rotateVinyl 8s linear infinite;
          animation-play-state: paused;
        }
        .disc[data-center='true'] .disc__spin {
          animation-play-state: running;
        }
        @keyframes rotateVinyl {
          0% {
            transform: rotate(0deg);
          }
          100% {
            transform: rotate(360deg);
          }
        }
        .disc__label {
          position: absolute;
          inset: 34%;
          border-radius: 50%;
          /* Lava-lamp accent: a BRIGHT blob (layer 2) and a DEEP blob (layer 3)
             slosh past each other in opposite directions over the accent base
             (layer 4) — big amplitude, high contrast, so the motion reads even at
             this size. Layer 1 is the fixed off-centre highlight that orbits with
             the spin. */
          background-image:
            radial-gradient(circle at 34% 28%, rgba(255, 255, 255, 0.4), transparent 46%),
            radial-gradient(
              closest-side,
              color-mix(in oklab, var(--accent, var(--explore-accent)) 48%, #fff 52%) 0%,
              color-mix(in oklab, var(--accent, var(--explore-accent)) 45%, transparent) 50%,
              transparent 78%
            ),
            radial-gradient(
              closest-side,
              color-mix(in oklab, var(--accent, var(--explore-accent)) 96%, #000 4%) 0%,
              color-mix(in oklab, var(--accent, var(--explore-accent)) 60%, transparent) 52%,
              transparent 80%
            ),
            radial-gradient(
              circle at 50% 50%,
              color-mix(in oklab, var(--accent, var(--explore-accent)) 86%, #fff 14%),
              color-mix(in oklab, var(--accent, var(--explore-accent)) 46%, #000 54%)
            );
          background-repeat: no-repeat;
          background-size: 100% 100%, 95% 95%, 88% 88%, 100% 100%;
          background-position: 34% 28%, 6% 28%, 92% 76%, 50% 50%;
          box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.3);
          /* The one background-position animation left in the tile (a paint, not a
             transform). Confined to one tiny element AND paused on the four
             off-centre labels — only the centred label actually paints. */
          animation: labelDrift 3.8s ease-in-out infinite alternate;
          animation-play-state: paused;
        }
        .disc[data-center='true'] .disc__label {
          animation-play-state: running;
        }
        @keyframes labelDrift {
          from {
            background-position: 34% 28%, 6% 28%, 92% 76%, 50% 50%;
          }
          to {
            background-position: 34% 28%, 94% 82%, 8% 22%, 50% 50%;
          }
        }
        .disc__text {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
        }
        .disc__hole {
          position: absolute;
          inset: 47.5%;
          border-radius: 50%;
          background: #050505;
          box-shadow: inset 0 0 2px 1px rgba(255, 255, 255, 0.2);
        }
        /* soft, broad angular reflection — no hard line */
        .disc__sheen {
          position: absolute;
          inset: 0;
          border-radius: 50%;
          background: conic-gradient(
            from 165deg at 50% 50%,
            transparent 0deg,
            rgba(255, 255, 255, 0.025) 30deg,
            rgba(255, 255, 255, 0.085) 58deg,
            rgba(255, 255, 255, 0.025) 88deg,
            transparent 135deg,
            transparent 215deg,
            rgba(255, 255, 255, 0.02) 248deg,
            rgba(255, 255, 255, 0.06) 270deg,
            rgba(255, 255, 255, 0.02) 295deg,
            transparent 335deg
          );
          mix-blend-mode: screen;
          pointer-events: none;
        }

        /* ============================================================
           TOUCH — one override block, placed AFTER every base rule so source
           order lets it win (@media adds no specificity). There is no hover to
           track and no cursor to tilt toward, so both come off; the deck keeps
           its translateZ depth ordering and its spinning disc.
           ============================================================ */
        @media (hover: none) {
          .stage {
            --rot: 0deg; /* rotateY is the costly per-frame resample */
          }
          .card {
            transition: transform 0.7s cubic-bezier(0.22, 1, 0.36, 1);
          }
          .card__tilt {
            will-change: auto;
          }
          .sleeve__wrap {
            display: none; /* pointer gloss — mouse only */
          }
          .disc__sheen {
            mix-blend-mode: normal;
            opacity: 0.6;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .card,
          .card__lift,
          .card__tilt,
          .card__intro,
          .h2,
          .line,
          .char {
            transition: none;
          }
          .card__intro,
          .h2 {
            opacity: 1;
            transform: none;
          }
          /* no continuous spin, no drifting label */
          .disc__spin,
          .disc__label {
            animation: none;
          }
          /* show only the active word's chars, no stagger; the line keeps its
             centring transform (positioning, not motion) */
          .char {
            transition-delay: 0s;
          }
          .word[data-active='true'] .char {
            opacity: 1;
            transform: none;
          }
          .word:not([data-active='true']) .char {
            opacity: 0;
          }
          /* No auto-loop in reduced motion, so the centred disc just rests out.
             The second selector ties the auto rule's specificity so the
             animation:none actually wins (this block is later in source
             order). */
          .disc[data-center='true'],
          .disc[data-center='true'][data-auto='true'] {
            animation: none;
            transform: translate(-50%, -50%) translateX(54%) translateZ(-1px);
          }
        }
      `}</style>
    </section>
  )
})

export default VinylCarouselDemo
