'use client'

import { memo, useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { getEntry } from './registry'
import useInView from './useInView'

/* ─────────────────────────────────────────────────────────────
 * One tile. Four shapes behind one frame, so the grid reads as one
 * page rather than four widgets bolted together:
 *
 *   image / video — a framed aspect box
 *   component     — the live component (a playground), framed and padded
 *   note          — no frame at all; the type IS the tile
 *
 * `inert` is what the studio passes: it kills links and freezes the
 * live component so a click selects the tile instead of triggering it.
 * ───────────────────────────────────────────────────────────── */

// A component sizes itself, so `auto` is its default box. A still or a clip
// has to declare a box up front or the grid reflows the moment it decodes.
function boxRatio(item) {
  if (item.ratio && item.ratio !== 'auto') return item.ratio
  return item.kind === 'component' || item.kind === 'note' ? null : '4/3'
}

// One column of a two-column grid: the whole width on a phone, half of the
// window above that.
const SIZES = '(max-width: 640px) 100vw, 50vw'

function MissingComponent({ name }) {
  return (
    <div className="text-ink-secondary text-ui-lg flex min-h-24 items-center justify-center text-center">
      {name ? `No component registered as “${name}”` : 'Pick a component'}
    </div>
  )
}

/* ── Live components mount on approach ─────────────────────────────────
 * A tile's component is not rendered until the tile is near the viewport,
 * and a HEAVY one is thrown away again once it is far past. Nothing on
 * this page should be running a timeline three screens above you.
 *
 *   MOUNT_AT    mount this far out, so the component is settled and its
 *               images decoded before it is ever seen
 *   RELEASE_AT  a heavy component unmounts past this. Deliberately much
 *               further out than MOUNT_AT: the two thresholds can't both
 *               be crossed by one small scroll, so nothing thrashes.
 * ─────────────────────────────────────────────────────────────────── */
const MOUNT_AT = '600px'
const RELEASE_AT = '1400px'
// Longest a tile will wait on its own images before showing regardless.
const READY_CAP = 3000

// Returns [ref, live]. Lifted out of the renderer so the tile's FRAME can see
// readiness too: an empty frame painting its own background is the "black bar"
// problem — a dark box sitting there at the wrong height before its component
// has arrived. Nothing paints until there is something to paint.
function useLiveMount(entry, eager) {
  const ref = useRef(null)
  const heavy = !!entry?.heavy

  // A light component is watched once and then left alone — the observer
  // unhooks itself and the tile keeps its state forever. A heavy one keeps
  // both watchers: near says mount, far says it's safe to let go.
  // An eager tile is at the top of the page and needs no watcher to tell it
  // that: it renders on the server and is already there on first paint.
  const near = useInView(ref, { margin: MOUNT_AT, once: !heavy, skip: eager && !heavy })
  const far = useInView(ref, { margin: RELEASE_AT, skip: !heavy })

  const [live, setLive] = useState(eager)
  // Height the component had when it was released, so the hole it leaves is
  // exactly its own size and the grid doesn't repack around it. A tile with
  // a declared ratio already has a fixed box and never needs this.
  const [hold, setHold] = useState(null)

  // Both observers report false until the first frame they run, so "far away"
  // and "not measured yet" look identical at mount. Nothing is released until
  // the far watcher has said yes at least once — otherwise a tile that is
  // eager AND heavy would tear itself down before its own first paint.
  const wasNear = useRef(false)

  useEffect(() => {
    if (far) wasNear.current = true
    if (near) {
      setLive(true)
      return
    }
    if (heavy && wasNear.current && !far) {
      const h = ref.current?.offsetHeight
      if (h) setHold(h)
      setLive(false)
    }
  }, [near, far, heavy])

  /* ── Mounted is not the same as ready ────────────────────────────────────
   * A component paints its own surface the instant it mounts, and several of
   * these are dark panels. So the moment the chunk lands you get a filled box
   * whose images are still on the wire — a black bar that then reflows as each
   * one decodes. Mounting is only half the condition.
   *
   * So the tile stays invisible until every <img> inside it has finished:
   * decoded, or failed, or run out of patience. A broken or slow asset can
   * never strand a tile — READY_CAP is the hard ceiling, after which it shows
   * whatever it has.
   * ─────────────────────────────────────────────────────────────────────── */
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!live) {
      setReady(false)
      return undefined
    }

    let done = false
    let raf = 0
    const finish = () => {
      if (done) return
      done = true
      cancelAnimationFrame(raf)
      setReady(true)
    }

    // A frame-by-frame settle check rather than load listeners, because there
    // are two different late arrivals to wait on and only one of them fires an
    // event. The component itself is a dynamic import: until its chunk lands it
    // renders nothing, so an empty wrapper is not "ready" no matter what the
    // images say. Polling catches both, plus anything a component mounts later
    // on its own.
    const settle = () => {
      const el = ref.current
      if (el) {
        const hasContent = el.childElementCount > 0 && el.offsetHeight > 8
        const imagesPending = Array.from(el.querySelectorAll('img')).some(
          (img) => !img.complete || !img.naturalWidth,
        )
        if (hasContent && !imagesPending) {
          finish()
          return
        }
      }
      raf = requestAnimationFrame(settle)
    }
    raf = requestAnimationFrame(settle)

    // Nothing waits forever. A hung asset or a chunk that never arrives shows
    // whatever it has rather than leaving a hole in the page.
    const cap = setTimeout(finish, READY_CAP)

    return () => {
      done = true
      cancelAnimationFrame(raf)
      clearTimeout(cap)
    }
  }, [live])

  return [ref, live, ready, hold]
}

function LiveComponent({ entry, name, liveRef, live, ready, hold }) {
  const Entry = entry?.Component
  if (!Entry) return <MissingComponent name={name} />

  return (
    <div
      ref={liveRef}
      className="work-live w-full"
      data-live={ready ? '' : undefined}
      style={live ? undefined : { minHeight: hold ?? undefined }}
    >
      {/* Mounted as a TYPE, not called as a function: <Entry /> keeps its own
          state — a half-scrubbed waveform, a playing clip — across the grid's
          re-measures instead of being rebuilt on each one. */}
      {live ? <Entry /> : null}
    </div>
  )
}

function TileBody({ item, entry, liveRef, live, ready, hold }) {
  const ratio = boxRatio(item)

  if (item.kind === 'component') {
    const body = (
      <LiveComponent
        entry={entry}
        name={item.component}
        liveRef={liveRef}
        live={live}
        ready={ready}
        hold={hold}
      />
    )

    // A component that opens and closes — the album card's tracklist — would
    // otherwise grow its cell on every click and shove the rest of the grid
    // down with it. Giving that tile a declared ratio freezes the slot: the
    // component animates inside a box that never changes size.
    //
    // The box scrolls rather than clips: its height comes from the tile's
    // width, so on a narrow column a component that opens tall would
    // otherwise lose its bottom rows. In the common case nothing overflows
    // and no scrollbar appears.
    if (!ratio) return body
    return (
      <div className="w-full overflow-y-auto" style={{ aspectRatio: ratio }}>
        <div className="flex min-h-full w-full items-center justify-center">
          {body}
        </div>
      </div>
    )
  }

  if (item.kind === 'note') {
    return (
      <div className="flex flex-col gap-3">
        {item.title ? (
          <p className="text-ink text-title-sm md:text-title text-balance">
            {item.title}
          </p>
        ) : null}
        {item.body ? (
          <p className="text-ink-secondary text-body">{item.body}</p>
        ) : null}
      </div>
    )
  }

  if (item.kind === 'video') {
    if (!item.src) {
      return (
        <div
          className="text-ink-tertiary text-ui-lg flex items-center justify-center"
          style={{ aspectRatio: ratio }}
        >
          Drop a video
        </div>
      )
    }
    return (
      <video
        src={item.src}
        poster={item.poster || undefined}
        autoPlay={item.autoplay}
        loop
        muted
        playsInline
        preload="metadata"
        className="block h-full w-full"
        style={{ aspectRatio: ratio, objectFit: item.fit }}
      />
    )
  }

  // image
  if (!item.src) {
    return (
      <div
        className="text-ink-tertiary text-ui-lg flex items-center justify-center"
        style={{ aspectRatio: ratio }}
      >
        Drop an image
      </div>
    )
  }
  return (
    <div className="relative w-full" style={{ aspectRatio: ratio }}>
      <Image
        src={item.src}
        alt={item.alt || item.title || ''}
        fill
        sizes={SIZES}
        className="object-center"
        style={{ objectFit: item.fit }}
      />
    </div>
  )
}

function WorkTile({ item, inert = false, selected = false, eager = false, onReady }) {
  const isComponent = item.kind === 'component'
  const entry = isComponent ? getEntry(item.component) : null
  const [liveRef, live, ready, holdHeight] = useLiveMount(entry, eager)

  // A component tile paints NOTHING until its component is mounted — no fill,
  // no border, no radius edge. Before that it is a hole the right size, so a
  // page of not-yet-arrived tiles reads as empty rather than as a stack of
  // black bars waiting to resize.
  // `shown` is a PAINT gate, never a layout one. The box, its padding and its
  // border box are all present from the first frame — only their colour waits.
  // Gating the layout instead would just move the reflow to the reveal.
  const shown = !isComponent || ready

  // Tell the cell. It is the grid that decides when this actually appears —
  // it holds every tile back until the ones above it are ready too.
  useEffect(() => {
    if (shown) onReady?.()
  }, [shown, onReady])
  const framed = item.frame && item.kind !== 'note'
  const media = item.kind === 'image' || item.kind === 'video'

  // No `squircle-lg` here: that utility pins one radius for every element on
  // the site. A tile's corner is sized to the tile — see --work-radius, set
  // per tile by WorkGrid from its measured box.
  const frame = (
    <div
      className={[
        'work-frame relative overflow-hidden',
        framed ? 'border-line border' : '',
        item.padded ? 'p-5 md:p-6' : '',
        selected ? 'work-frame--selected' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{
        background: shown
          ? item.background || (framed ? 'var(--color-surface-raised)' : 'transparent')
          : 'transparent',
        borderColor: shown ? undefined : 'transparent',
      }}
    >
      <div className={inert && item.kind === 'component' ? 'pointer-events-none' : ''}>
        <TileBody
          item={item}
          entry={entry}
          liveRef={liveRef}
          live={live}
          ready={ready}
          hold={holdHeight}
        />
      </div>
    </div>
  )

  // Nothing is captioned. A tile is the work, so the frame is the whole tile
  // and the whole tile is the link — except for a component, which owns its
  // own clicks and would have them swallowed by an anchor wrapper.
  const links = !!item.href && !inert && item.kind !== 'component'

  const className = [
    'work-tile',
    media ? 'work-tile--media' : '',
    links ? 'work-tile--link' : '',
  ]
    .filter(Boolean)
    .join(' ')

  if (links) {
    return (
      <Anchor href={item.href} className={className} label={item.title || item.alt}>
        {frame}
      </Anchor>
    )
  }

  return <div className={className}>{frame}</div>
}

// `item` is a stable object from the page's data (or the studio's state), so
// this holds: the grid can re-render for a resize without disturbing a tile
// whose component is mid-interaction.
export default memo(WorkTile)

// Internal hrefs go through next/link for client nav; anything else opens
// in a new tab. `label` names the link for screen readers — with the captions
// gone, a media tile's anchor has no text of its own to be announced by.
function Anchor({ href, className, children, label }) {
  if (href.startsWith('/') || href.startsWith('#')) {
    return (
      <Link href={href} className={className} aria-label={label || undefined}>
        {children}
      </Link>
    )
  }
  return (
    <a
      href={href}
      className={className}
      aria-label={label || undefined}
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
    </a>
  )
}
