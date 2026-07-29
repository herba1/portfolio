'use client'

import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { COLUMNS } from './constants'
import WorkTile from './WorkTile'
import useInView from './useInView'

/* ─────────────────────────────────────────────────────────────
 * The grid. TWO EQUAL COLUMNS, one on a phone. Nothing spans.
 *
 * Every tile is one column wide and as tall as its own content. No tile
 * breaks out to full width: a single 1400px-wide image between two rows
 * of small tiles reads as the page falling apart, not as emphasis.
 *
 * CSS grid with a 4px auto-row: every tile is measured after layout and
 * given `grid-row: span N` to match its own height. That is what keeps
 * natural heights without leaving a row's worth of dead air under every
 * short tile, and unlike CSS `columns` it keeps the reading order going
 * left → right instead of down one column and back up.
 * ───────────────────────────────────────────────────────────── */

const ROW = 4 // px — the auto-row unit. Smaller = tighter packing, more spans.

// Gutter. Tight on purpose — the tiles are the page, and a wide gutter
// between two columns reads as two separate pages rather than one grid.
const GAP_WIDE = 16
const GAP_NARROW = 10

// Below this, two columns would put a live component in ~150px and break it,
// so the grid drops to a single column. This is the only breakpoint.
const NARROW_AT = 640

function colsFor(width, max) {
  return Math.min(width < NARROW_AT ? 1 : COLUMNS, max)
}

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

/* ── The reveal ────────────────────────────────────────────────────────
 * ONE gate, and it is hidden by default in static CSS — not switched on
 * after hydration. A rule that only starts hiding once JS has run means the
 * server's HTML paints first and is then yanked away: that is the two-flash
 * bug (content, then blank, then content). `.work-cell` is opacity 0 in the
 * stylesheet itself, and page.js carries a <noscript> that turns it back on
 * for anyone without JS.
 *
 * A cell reveals when THREE things are true:
 *   1. it has been scrolled to,
 *   2. its component is mounted and its images have decoded,
 *   3. every cell BEFORE it has already revealed.
 *
 * Point 3 is what fixes the scattered load order. Readiness arrives in
 * whatever order the network feels like — a tile with no images beats one
 * with five — so without an ordering pass the page assembles at random.
 * Cells report readiness up here and are released strictly in DOM order,
 * one every STEP_MS, which is also where the stagger comes from now.
 *
 * STALL_MS is the escape hatch: if the next cell in line never reports
 * (an asset that hangs, a tile that never mounts), the queue steps over it
 * rather than stranding everything below.
 * ─────────────────────────────────────────────────────────────────── */
const REVEAL_AT = '0px 0px -8% 0px'
const STEP_MS = 45
const STALL_MS = 900

const RevealContext = createContext(null)

// The tiles at the top are on screen before any observer can report on them,
// so they skip the machinery: they render on the server and are live on the
// first paint. Everything after this waits until it is approached.
const EAGER = 4

function radiusFor(width, height) {
  const s = Math.min(width, height)
  if (!s) return RADIUS_MIN
  const r = RADIUS_K * Math.pow(s, RADIUS_P)
  return Math.round(Math.min(RADIUS_MAX, Math.max(RADIUS_MIN, r)))
}

function WorkGrid({
  items,
  // The most columns this grid may use. The live page takes the default two;
  // the studio passes 1 to preview how a single-column read scans.
  columns = COLUMNS,
  inert = false,
  selectedId = null,
  onSelect = null,
  animate = true,
}) {
  const rootRef = useRef(null)
  const [gap, setGap] = useState(GAP_WIDE)
  const [cols, setCols] = useState(COLUMNS)

  /* The release queue. `cursor` is the last index allowed to show; cells at or
     below it are revealed, everything above waits its turn. */
  const readyRef = useRef(new Set())
  const [cursor, setCursor] = useState(-1)
  const [bump, setBump] = useState(0)

  const report = useCallback((index) => {
    readyRef.current.add(index)
    setBump((n) => n + 1)
  }, [])

  // Release the next cell once it is ready. One at a time, one step apart —
  // the cascade IS the stagger, so nothing needs a hand-tuned delay.
  useEffect(() => {
    if (!readyRef.current.has(cursor + 1)) return undefined
    const t = setTimeout(() => setCursor((c) => c + 1), STEP_MS)
    return () => clearTimeout(t)
  }, [cursor, bump])

  // …unless the next one never reports. If anything FURTHER down is ready, the
  // queue is stuck behind a gap, so step over it rather than stranding the page.
  useEffect(() => {
    let blocked = false
    readyRef.current.forEach((i) => {
      if (i > cursor + 1) blocked = true
    })
    if (!blocked) return undefined
    const t = setTimeout(() => setCursor((c) => c + 1), STALL_MS)
    return () => clearTimeout(t)
  }, [cursor, bump])

  // One object for the whole grid, rebuilt only when the cursor moves.
  const queue = useMemo(() => ({ report, cursor }), [report, cursor])

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

  // Container width, not viewport — so the studio's narrow preview pane gets
  // the columns and the gutter it actually has room for.
  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    const ro = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width
      setCols(colsFor(w, columns))
      setGap(w < NARROW_AT ? GAP_NARROW : GAP_WIDE)
    })
    ro.observe(root)
    return () => ro.disconnect()
  }, [columns])

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
  }, [items, cols, gap, measure])

  return (
    <div
      ref={rootRef}
      className="work-grid"
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
        gridAutoRows: `${ROW}px`,
        gridAutoFlow: 'row',
        alignItems: 'start',
        gap: `${gap}px`,
      }}
    >
      <RevealContext.Provider value={queue}>
        {items.map((item, i) => (
          <WorkCell
            key={item.id}
            item={item}
            index={i}
            inert={inert}
            selected={selectedId === item.id}
            onSelect={onSelect}
            animate={animate}
            eager={i < EAGER}
          />
        ))}
      </RevealContext.Provider>
    </div>
  )
}

const WorkCell = memo(function WorkCell({
  item,
  index,
  inert,
  selected,
  onSelect,
  animate,
  eager,
}) {
  const ref = useRef(null)
  const queue = useContext(RevealContext)

  // Scrolled to…
  const inView = useInView(ref, { margin: REVEAL_AT, once: true, skip: !animate })
  // …and its component mounted with its images decoded. WorkTile owns that
  // half and reports it up; a tile with nothing to load reports immediately.
  const [loaded, setLoaded] = useState(false)
  const onReady = useCallback(() => setLoaded(true), [])

  // Tell the grid this cell is ready, once. The grid decides WHEN it shows —
  // strictly after every cell above it, so the page assembles top to bottom
  // instead of in whatever order the network happened to finish.
  const told = useRef(false)
  useEffect(() => {
    if (!animate) return
    if (told.current || !inView || !loaded) return
    told.current = true
    queue?.report(index)
  }, [animate, inView, loaded, index, queue])

  const revealed = !animate || (queue ? index <= queue.cursor : true)

  return (
    <div
      ref={ref}
      data-work-cell=""
      data-selected={selected ? '' : undefined}
      // The animation is keyed off this attribute, not off mounting, so an
      // offscreen tile costs nothing until it is reached.
      data-in={revealed ? '' : undefined}
      onClick={onSelect ? () => onSelect(item.id) : undefined}
      className={animate ? 'work-cell' : undefined}
      /* `grid-row-end` is deliberately NOT in this style object: the
         measured span is written straight to the node, and anything React
         owns here would be reset to its pre-measure value on every
         unrelated re-render (selecting a tile in the studio, say). The
         placeholder span lives in CSS on [data-work-cell] instead. */
      /* One column, always — see ALLOW_FULL_WIDTH in constants. */
      style={{
        gridColumn: 'span 1',
        cursor: onSelect ? 'pointer' : undefined,
      }}
    >
      {/* One measured wrapper per cell — the tile's own margins must not
          live outside it or the span comes out short. */}
      <div>
        <WorkTile
          item={item}
          inert={inert}
          selected={selected}
          eager={eager}
          onReady={onReady}
        />
      </div>
    </div>
  )
})

// The grid re-renders on every gap/column change and, in the studio, on every
// keystroke in the inspector. Memoising it (and WorkTile under it) keeps a
// tile's live component — a playing audio element, a half-dragged waveform —
// from being re-rendered for a change that has nothing to do with it.
export default memo(WorkGrid)
