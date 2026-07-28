'use client'

import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { COLUMNS } from './constants'
import WorkTile from './WorkTile'

/* ─────────────────────────────────────────────────────────────
 * The masonry. TWO COLUMNS, at every width.
 *
 * CSS grid with a 4px auto-row: every tile is measured after layout and
 * given `grid-row: span N` to match its own height. That's what buys
 * variable heights AND full-width tiles at the same time — plain CSS
 * `columns` gives you the first but makes the second impossible, and a
 * fixed-row grid gives you the second but crops the first.
 *
 * Three things here are deliberate, and all three are about legibility:
 *
 *   1. The column count does NOT respond to width. Every column is the
 *      same width at every size, so the eye learns one rhythm and keeps
 *      it. A grid that silently reflows 3 → 2 → 1 asks you to re-read it
 *      at every breakpoint.
 *   2. No `grid-auto-flow: dense`. Dense lets a later tile jump backwards
 *      into a hole an earlier full-width tile left, so what you read no
 *      longer matches the order the tiles are in. An honest gap beats a
 *      scrambled sequence.
 *   3. Only the GAP is responsive — tiles on a phone need less gutter,
 *      not fewer columns.
 * ───────────────────────────────────────────────────────────── */

const ROW = 4 // px — the auto-row unit. Smaller = tighter packing, more spans.

// Gutter. Big tiles want air; a phone has none to spare.
const GAP_WIDE = 32
const GAP_NARROW = 14
const NARROW_AT = 640

/* ── Corner radius as a function of tile size ──────────────────────────
 * A fixed radius is wrong at both ends: it swallows a small tile and
 * disappears on a big one. So the radius is derived from the tile's own
 * measured box — and derived SUBLINEARLY, because scaling it linearly
 * makes a large tile look like a lozenge.
 *
 *   r = K · s^P,  s = min(width, height)
 *
 * P = 0.43 is the compression. It puts a 200px tile at ~18px, a 450px
 * tile at ~25px and a 950px tile at ~34px: the corner keeps growing, but
 * at less than half the rate the tile does. The clamps stop a thumbnail
 * from going circular and a hero from going soft.
 * ─────────────────────────────────────────────────────────────────── */
const RADIUS_K = 1.8
const RADIUS_P = 0.43
const RADIUS_MIN = 12
const RADIUS_MAX = 34

function radiusFor(width, height) {
  const s = Math.min(width, height)
  if (!s) return RADIUS_MIN
  const r = RADIUS_K * Math.pow(s, RADIUS_P)
  return Math.round(Math.min(RADIUS_MAX, Math.max(RADIUS_MIN, r)))
}

export default function WorkGrid({
  items,
  // Fixed at two on the live page. The studio passes 1 to preview how a
  // single-column read scans; nothing else should override it.
  columns = COLUMNS,
  inert = false,
  selectedId = null,
  onSelect = null,
  animate = true,
}) {
  const rootRef = useRef(null)
  const [gap, setGap] = useState(GAP_WIDE)

  // One pass per cell: size its corner from its own box, then turn its
  // height into a row span. Writing the radius costs nothing extra here and
  // guarantees it is recomputed on exactly the events that change the box —
  // a column-count change, an image decoding, a component animating open.
  const measure = useCallback(
    (cell) => {
      const inner = cell.firstElementChild
      if (!inner) return

      const box = cell.querySelector('.work-frame')
      if (box) {
        const { width, height } = box.getBoundingClientRect()
        box.style.setProperty('--work-radius', `${radiusFor(width, height)}px`)
      }

      const h = inner.getBoundingClientRect().height
      const span = Math.max(1, Math.ceil((h + gap) / (ROW + gap)))
      cell.style.gridRowEnd = `span ${span}`
    },
    [gap],
  )

  // Track container width → gutter only. The column count never moves.
  // Container width, not viewport, so the studio's narrow preview pane gets
  // the gutter it actually has room for.
  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    const ro = new ResizeObserver(([entry]) => {
      setGap(entry.contentRect.width < NARROW_AT ? GAP_NARROW : GAP_WIDE)
    })
    ro.observe(root)
    return () => ro.disconnect()
  }, [])

  // Measure every cell, and keep measuring as content settles: a component
  // animating open, an image decoding, a webfont swapping in.
  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    const cells = Array.from(root.querySelectorAll('[data-work-cell]'))
    const remeasure = () => cells.forEach(measure)

    const ro = new ResizeObserver(remeasure)
    cells.forEach((cell) => {
      measure(cell)
      if (cell.firstElementChild) ro.observe(cell.firstElementChild)
    })

    // aspect-ratio boxes don't change size on decode, so the observer alone
    // would miss a late-loading tile that has no declared ratio.
    const media = Array.from(root.querySelectorAll('img, video'))
    media.forEach((m) => {
      m.addEventListener('load', remeasure)
      m.addEventListener('loadedmetadata', remeasure)
    })

    let cancelled = false
    document.fonts?.ready.then(() => {
      if (!cancelled) remeasure()
    })

    return () => {
      cancelled = true
      ro.disconnect()
      media.forEach((m) => {
        m.removeEventListener('load', remeasure)
        m.removeEventListener('loadedmetadata', remeasure)
      })
    }
  }, [items, columns, gap, measure])

  return (
    <div
      ref={rootRef}
      className="work-grid"
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        gridAutoRows: `${ROW}px`,
        gridAutoFlow: 'row',
        alignItems: 'start',
        gap: `${gap}px`,
      }}
    >
      {items.map((item, i) => (
        <div
          key={item.id}
          data-work-cell=""
          data-selected={selectedId === item.id ? '' : undefined}
          onClick={onSelect ? () => onSelect(item.id) : undefined}
          className={animate ? 'work-cell' : undefined}
          /* `grid-row-end` is deliberately NOT in this style object: the
             measured span is written straight to the node, and anything React
             owns here would be reset to its pre-measure value on every
             unrelated re-render (selecting a tile in the studio, say). The
             placeholder span lives in CSS on [data-work-cell] instead. */
          style={{
            gridColumn: `span ${Math.min(item.span, columns)}`,
            animationDelay: animate ? `${0.05 + i * 0.05}s` : undefined,
            cursor: onSelect ? 'pointer' : undefined,
          }}
        >
          {/* One measured wrapper per cell — the tile's own margins must not
              live outside it or the span comes out short. */}
          <div>
            <WorkTile item={item} inert={inert} selected={selectedId === item.id} />
          </div>
        </div>
      ))}
    </div>
  )
}
