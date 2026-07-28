'use client'

// Read-only tier list. Rows distribute evenly down the available height; items
// scale to row height. Clicking a tile that has a label/note pops a speech
// bubble above it that springs open from its tail (bottom-centre) and grows its
// width to fit the text. Intro + exit handled by AnimatePresence.

import { useState, useRef, useLayoutEffect, useEffect, ViewTransition } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence, useReducedMotion } from 'motion/react'

const GAP = 12 // px between the tile's top edge and the bubble's tail

// Entrance cascade, in seconds. ROW_STAGGER matches the --stagger-sm token the
// rest of the site cascades on; tiles run at half that across the row, and stop
// staggering after TILE_STAGGER_MAX so the tail of a long row doesn't trail the
// rest of the page.
const ROW_STAGGER = 0.04
const TILE_STAGGER = 0.02
const TILE_STAGGER_MAX = 8

export default function TierListView({ tiers, items, slug, coverIds }) {
  // The items shown as fan-out thumbs on the index get a shared
  // view-transition-name, so the browser morphs each thumb into this tile (and
  // back) when navigating in/out. Everything else just cross-fades.
  const coverSet = new Set(coverIds || [])
  // active = { id, text, rect } for the tile whose bubble is showing
  const [active, setActive] = useState(null)
  // widths[i] = pixel width of the first i characters (widths[0] === 0); the
  // typewriter springs the bubble out to widths[typed] as each character lands.
  const [widths, setWidths] = useState(null)
  // Desktop (fine pointer that can hover) opens on hover; touch opens on tap.
  const [canHover, setCanHover] = useState(false)
  const measureRef = useRef(null)

  useEffect(() => {
    const mq = window.matchMedia('(hover: hover) and (pointer: fine)')
    const update = () => setCanHover(mq.matches)
    update()
    mq.addEventListener?.('change', update)
    return () => mq.removeEventListener?.('change', update)
  }, [])

  const show = (e, item) => {
    const text = (item.note || item.label || '').trim()
    if (!text) return
    setWidths(null)
    setActive({ id: item.id, text, rect: e.currentTarget.getBoundingClientRect() })
  }
  // Tap toggles (mobile); hover-enter always shows, hover-leave closes its own.
  const onTap = (e, item) => {
    if (active?.id === item.id) setActive(null)
    else show(e, item)
  }
  const closeIf = (id) => setActive((a) => (a?.id === id ? null : a))

  // Measure every prefix width once on open (one element, n reflows, n is tiny).
  useLayoutEffect(() => {
    const el = measureRef.current
    if (!active || !el) return
    const arr = [0]
    for (let i = 1; i <= active.text.length; i++) {
      el.textContent = active.text.slice(0, i)
      arr.push(Math.ceil(el.getBoundingClientRect().width))
    }
    setWidths(arr)
  }, [active])

  // Dismiss on scroll / resize / Escape — the bubble is anchored to a viewport
  // rect, so once the layout shifts the anchor is stale. On touch we also close
  // on any tap-elsewhere and after a timeout; on hover, mouse-leave handles it.
  useEffect(() => {
    if (!active) return
    const close = () => setActive(null)
    const onKey = (e) => e.key === 'Escape' && close()
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    window.addEventListener('keydown', onKey)
    let t
    if (!canHover) {
      window.addEventListener('pointerdown', close)
      t = setTimeout(close, 5000)
    }
    return () => {
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', close)
      clearTimeout(t)
    }
  }, [active, canHover])

  return (
    <div className="flex h-full w-full flex-col">
      {tiers.map((tier, rowIndex) => {
        const rowItems = items.filter((it) => it.tier === tier.id)
        // The row cascade. The row element itself gets no entrance at all — a
        // cover tile sits inside it, and animating either its transform or its
        // opacity would follow the tile through the morph and spoil the
        // landing (see the entrance comment in globals.css). The delay is
        // passed down instead, so the parts that *can* move arrive on the
        // row's beat while the row itself stays put.
        const rowDelay = rowIndex * ROW_STAGGER
        return (
          <div
            key={tier.id}
            className="flex min-h-0 flex-1 items-stretch border-b border-line last:border-b-0"
          >
            {/* Label — square; uniform width since all rows share equal height */}
            <div
              className="tl-rise flex aspect-square h-full shrink-0 items-center justify-center"
              style={{ backgroundColor: tier.color, '--tl-delay': `${rowDelay}s` }}
            >
              <span className="text-[clamp(1.5rem,5vh,3rem)] leading-none font-bold tracking-tight text-ink">
                {tier.label}
              </span>
            </div>

            {/* Items */}
            <ScrollRow index={rowIndex}>
              {rowItems.map((item, i) => {
                const text = (item.note || item.label || '').trim()
                // A cover tile is a morph target: it flies in from its fan
                // thumb, so it must be sitting at its final position both when
                // the browser measures the incoming page and when the overlay
                // lifts. Every other tile is free to rise, cascading left to
                // right off the row's own delay — capped so a long row doesn't
                // still be arriving seconds later.
                const isCover = coverSet.has(item.id)
                const tile = (
                  <div
                    key={item.id}
                    onClick={canHover || !text ? undefined : (e) => onTap(e, item)}
                    onMouseEnter={canHover && text ? (e) => show(e, item) : undefined}
                    onMouseLeave={canHover ? () => closeIf(item.id) : undefined}
                    style={
                      isCover
                        ? undefined
                        : { '--tl-delay': `${rowDelay + Math.min(i, TILE_STAGGER_MAX) * TILE_STAGGER}s` }
                    }
                    className={`tl-item group relative aspect-square h-[82%] shrink-0 overflow-hidden bg-surface-raised shadow-md ring-1 ring-line ${
                      isCover ? '' : 'tl-rise '
                    }${text && !canHover ? 'cursor-pointer' : ''}`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={item.src}
                      alt={item.label || ''}
                      draggable={false}
                      className="h-full w-full object-cover"
                    />
                  </div>
                )

                // The first few items also appear as the fan thumbs on the
                // index, so those two elements share a name and the browser
                // morphs one into the other across the navigation.
                //
                // Only `share` is set — `enter`/`exit`/`update` are "none", so
                // React hands the browser a view-transition-name *only* when
                // both ends are present in the same navigation. Leaving the
                // page for anywhere else, the tile stays inside the page
                // snapshot and travels with it; an always-on name would lift it
                // out and cross-fade it on its own default timing while the
                // page slid away underneath. See ImageFan.jsx for the other end.
                if (!isCover) return tile

                return (
                  <ViewTransition
                    key={item.id}
                    name={`tl-${slug}-${item.id}`}
                    share="tl-share"
                    enter="none"
                    exit="none"
                    update="none"
                  >
                    {tile}
                  </ViewTransition>
                )
              })}
            </ScrollRow>
          </div>
        )
      })}

      <BubbleLayer active={active} widths={widths} measureRef={measureRef} />
    </div>
  )
}

// A horizontally-scrollable row of items. When it actually overflows and first
// scrolls into view, it plays a one-time "tug" (CSS .tl-hint) to signal there's
// more to the right. Pure-CSS animation; JS only gates when/whether it fires.
function ScrollRow({ children, index }) {
  const scrollRef = useRef(null)
  const trackRef = useRef(null)

  useEffect(() => {
    const sc = scrollRef.current
    const track = trackRef.current
    if (!sc || !track) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return

    let played = false
    const tug = () => {
      if (played) return
      // Only hint when there's a meaningful amount hidden to the right and the
      // user hasn't already scrolled the row themselves.
      if (sc.scrollWidth - sc.clientWidth > 24 && sc.scrollLeft <= 2) {
        played = true
        track.style.setProperty('--hint-delay', `${0.5 + index * 0.12}s`)
        track.classList.add('tl-hint')
        io.disconnect()
      }
    }
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && tug()),
      { threshold: 0.55 },
    )
    io.observe(sc)
    return () => io.disconnect()
  }, [index])

  return (
    <div ref={scrollRef} className="flex flex-1 overflow-x-auto px-2">
      <div ref={trackRef} className="tl-track flex h-full items-center gap-1.5">
        {children}
      </div>
    </div>
  )
}

const PAD = 32 // horizontal padding of .tl-bubble (≈ 0.95rem × 2), added to text width
const TYPE_MS = 80 // delay between characters

function BubbleLayer({ active, widths, measureRef }) {
  const reduce = useReducedMotion()
  if (typeof document === 'undefined') return null

  return createPortal(
    <>
      {/* Hidden twin: prefix widths are read off this before the bubble shows. */}
      {active && !widths ? (
        <span ref={measureRef} className="tl-bubble-text tl-bubble-measure" aria-hidden>
          {active.text}
        </span>
      ) : null}

      <AnimatePresence>
        {active && widths ? (
          <Bubble key={active.id} active={active} widths={widths} reduce={reduce} />
        ) : null}
      </AnimatePresence>
    </>,
    document.body,
  )
}

function Bubble({ active, widths, reduce }) {
  const { text, rect } = active
  // Number of characters revealed so far. The bubble width re-targets to
  // widths[typed] on each tick, so its spring bounces out to each new char.
  const [typed, setTyped] = useState(reduce ? text.length : 1)

  useEffect(() => {
    if (reduce || typed >= text.length) return
    const id = setTimeout(() => setTyped((n) => n + 1), TYPE_MS)
    return () => clearTimeout(id)
  }, [typed, text.length, reduce])

  const w = widths[Math.min(typed, widths.length - 1)] + PAD

  return (
    <motion.div
      className="tl-bubble-anchor"
      style={{
        top: `${rect.top - GAP}px`,
        left: `${rect.left + rect.width / 2}px`,
        transformOrigin: 'bottom center',
      }}
      initial={{ opacity: 0, scale: 0.86, y: 8 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.86, y: 6 }}
      transition={
        reduce ? { duration: 0 } : { type: 'spring', stiffness: 480, damping: 28, mass: 0.8 }
      }
      // Keep the centre-above-tile offset constant while Framer animates scale/y,
      // so the tail stays pinned over the tile centre.
      transformTemplate={(_, generated) => `translate(-50%, -100%) ${generated}`}
    >
      <motion.div
        className="tl-bubble"
        initial={false}
        animate={{ width: w }}
        // Snappy, bouncy spring so each character pops the width out. A small
        // delay lets the character land first, then the width springs to catch
        // up a touch late behind it.
        transition={
          reduce
            ? { duration: 0 }
            : { type: 'spring', stiffness: 700, damping: 17, mass: 0.7, delay: 0.05 }
        }
      >
        <span className="tl-bubble-text">{text.slice(0, typed)}</span>
      </motion.div>
      <span className="tl-bubble-tail" aria-hidden />
    </motion.div>
  )
}
