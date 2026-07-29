'use client'

import { memo, useCallback, useEffect, useRef, useState } from 'react'

import './tokens.css'

/* ═══════════════════════════════════════════════════════════════════════════
 * NavHoverDemo — ported from CrowdVolt's desktop Explore nav flyout.
 *
 * Source files:
 *   mono-volt/apps/web/app/components/core/home-explore/ExploreNavTrigger.tsx
 *   mono-volt/apps/web/app/components/core/home-explore/ExploreNavShade.tsx
 *   mono-volt/apps/web/app/hooks/core/home-explore/useExploreFlyout.ts
 *   mono-volt/apps/web/app/components/core/ui/frost-bar.tsx
 *   mono-volt/apps/web/app/components/core/header/Header.tsx        (L222–233)
 *   mono-volt/apps/web/app/globals.css                              (L3271–3395)
 *
 * The thing worth porting is the IDEA over there: the menu is not a floating
 * card that appears under the bar — the BAR ITSELF GROWS. One frosted surface
 * (their <FrostBar/>) covers the bar row via a spacer and then extends downward
 * over the revealed panel, so bar and panel are a single sheet of glass: one
 * blur, one tint, one bottom hairline, no seam. Behind it a separate scrim
 * blurs and dims the page, so the menu reads as a focused layer.
 *
 * Two details in the original that are easy to get wrong and are preserved here
 * verbatim:
 *
 *   1. The reveal is a grid-template-rows 0fr → 1fr height wipe inside
 *      overflow:hidden — NOT clip-path and NOT transform. Either of those
 *      severs the frost's backdrop-filter and the blur dies mid-animation.
 *   2. The page scrim's backdrop-filter is applied ONLY while open. Chromium
 *      disables the first backdrop-filter in a stack when a second one is
 *      painting, so an always-on scrim would kill the bar's own frost.
 *
 * ── Changes forced by living in a /work grid tile ──────────────────────────
 *
 *   • The real one has ONE trigger (the city pill), so it never had to handle
 *     moving between adjacent nav items. A tile wants a nav, so this has four.
 *     They share ONE container: the outer wipe stays open across a switch and
 *     each panel carries its own nested 0fr↔1fr wipe (the same trick their
 *     inline calendar uses). Both run on identical timing, so the collapsing
 *     panel and the expanding one sum to a clean interpolation of the two
 *     heights — the container morphs between them instead of jumping.
 *   • Their scrim is `position: fixed` over the viewport. Here everything is
 *     absolute inside a `position: relative; overflow: hidden` box — nothing
 *     escapes the tile and nothing can reach the real site's nav.
 *   • Their trigger is desktop-only (mobile gets a separate click drawer).
 *     A tile has no such fallback, so hover-open is gated on
 *     `pointerType === 'mouse'` and touch gets tap-to-toggle on the same items.
 *
 * ── Cleanup ── the grid lazy-mounts and UNMOUNTS tiles, so both hover-intent
 * timers are held in refs and cleared on unmount, and the Escape / outside-tap
 * document listeners are only bound while open and removed on teardown.
 * ═══════════════════════════════════════════════════════════════════════════ */

/* ── Hover intent, from useExploreFlyout.ts ────────────────────────────────
 * These three numbers are the whole feel of the menu and are unchanged.       */

/** A beat before opening, so a cursor merely passing through doesn't trip it. */
const OPEN_DELAY = 70
/** Grace before closing, so you can cross the seam between bar and panel. */
const CLOSE_DELAY = 180
/** After a hover-open people reflexively CLICK the item — it reads as a
 *  dropdown — which would toggle it straight back shut and feel like it never
 *  opened. Swallow that one click for a beat. A later, intentional click still
 *  closes it. */
const CLICK_GRACE = 1000

/* ── The frost surface, from frost-bar.tsx ─────────────────────────────────
 * Andreas Larsen's asymmetric scrim curve — a 12-stop eased ramp, front-loaded
 * so the top edge tapers instead of banding. Tint and blur sit on ONE element:
 * the gradient paints over the blurred backdrop so the stops are authoritative.
 * A tint layer *behind* the blur looks right in Chrome, but Safari won't pull a
 * sibling into the backdrop and the blur washes the opaque top edge out.
 * [pct, alpha], solid at 0% easing to transparent at 100%.
 * ─────────────────────────────────────────────────────────────────────────── */
const SCRIM_STOPS = [
  [0, 1],
  [19, 0.738],
  [34, 0.541],
  [47, 0.382],
  [56.5, 0.278],
  [65, 0.194],
  [73, 0.126],
  [80.2, 0.075],
  [86.1, 0.042],
  [91, 0.021],
  [95.2, 0.008],
  [100, 0],
]

// Same call the shade makes over there: blur 12, tint --explore-bg, body
// opacity 0.84, solid at the very top, ramping over the top 12px.
const FROST_OPACITY = 0.84
const FROST_TOP_OPACITY = 1
const FROST_FADE = '12px'

const frostBackground = () => {
  const at = (o) =>
    `color-mix(in srgb, var(--explore-bg, #0d0d0d) ${(o * 100).toFixed(2)}%, transparent)`
  const ramp = SCRIM_STOPS.map(([pct, alpha]) => {
    const op = FROST_OPACITY + (FROST_TOP_OPACITY - FROST_OPACITY) * alpha
    return `${at(op)} calc(${FROST_FADE} * ${pct / 100})`
  })
  return `linear-gradient(to bottom, ${ramp.join(', ')}, ${at(FROST_OPACITY)} ${FROST_FADE}, ${at(
    FROST_OPACITY,
  )} 100%)`
}

const FROST_BG = frostBackground()

/* ── Menu content ──────────────────────────────────────────────────────────
 * Two eyebrowed sections of pills per panel — the shape of the real filter
 * shade (Where / When), carried across to the other three menus so the shared
 * container has a consistent height to morph between. Static copy: the nav
 * items are the only live controls in this tile, the pills are just cargo.
 * ─────────────────────────────────────────────────────────────────────────── */
const ITEMS = [
  {
    key: 'events',
    label: 'Events',
    groups: [
      { heading: 'Where', pills: ['Chicago', 'New York', 'Miami', 'Los Angeles'], selected: 0 },
      { heading: 'When', pills: ['Tonight', 'This weekend', 'Next weekend'], selected: -1 },
    ],
  },
  {
    key: 'artists',
    label: 'Artists',
    groups: [
      { heading: 'Trending', pills: ['Anyma', 'Sara Landry', 'Fred again..'], selected: -1 },
      { heading: 'Sounds', pills: ['House', 'Techno', 'Drum & bass', 'Trance'], selected: 1 },
    ],
  },
  {
    key: 'venues',
    label: 'Venues',
    groups: [
      { heading: 'Tonight', pills: ['Radius', 'Concord', 'Prysm', 'Spybar'], selected: -1 },
      { heading: 'Nearby', pills: ['Detroit', 'Milwaukee', 'Nashville'], selected: -1 },
    ],
  },
  {
    key: 'sell',
    label: 'Sell',
    groups: [
      { heading: 'Your tickets', pills: ['List a ticket', 'Listings', 'Payouts'], selected: -1 },
      { heading: 'Guides', pills: ['Seller fees', 'Getting paid'], selected: -1 },
    ],
  },
]

/* The page under the menu — it exists so the blur has something to act on. The
   card art is a multi-stop ramp through the brand tokens, which is what makes
   the 6px scrim blur legible at tile scale. */
const CARDS = [
  { art: 'a', title: 'Sunset Terrace', meta: 'Sat · from $45' },
  { art: 'b', title: 'Radius Warehouse', meta: 'Sat · from $62' },
  { art: 'c', title: 'Concord Hall', meta: 'Sun · from $38' },
]

function NavHoverDemo() {
  const [open, setOpen] = useState(false)
  const [activeKey, setActiveKey] = useState(ITEMS[0].key)

  const rootRef = useRef(null)
  const openTimer = useRef(null)
  const closeTimer = useRef(null)
  // Which item the pending open-timer is aimed at. Sliding across the bar
  // before the delay elapses re-aims it rather than restarting it, so the
  // 70ms intent beat is measured from when you first entered the bar.
  const pendingKey = useRef(null)
  // Timestamp until which a click on the open menu is ignored. 0 = no guard.
  const clickGuard = useRef(0)

  const clearOpenT = useCallback(() => {
    if (openTimer.current) {
      clearTimeout(openTimer.current)
      openTimer.current = null
    }
    pendingKey.current = null
  }, [])

  const clearCloseT = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }, [])

  // Unmount teardown for both intent timers — this tile gets unmounted by the
  // grid and a fired timer would setState on a dead component.
  useEffect(() => () => {
    clearOpenT()
    clearCloseT()
  }, [clearOpenT, clearCloseT])

  /** Pointer entered a nav item — open after the intent delay. */
  const hoverOpen = useCallback(
    (key) => {
      clearCloseT()
      // Already open: this is a move between adjacent items. Switch straight
      // away — a second intent delay here would feel like lag, not care.
      if (open) {
        clearOpenT()
        setActiveKey(key)
        return
      }
      if (openTimer.current) {
        pendingKey.current = key
        return
      }
      pendingKey.current = key
      openTimer.current = setTimeout(() => {
        openTimer.current = null
        const target = pendingKey.current
        pendingKey.current = null
        clickGuard.current = Date.now() + CLICK_GRACE
        if (target) setActiveKey(target)
        setOpen(true)
      }, OPEN_DELAY)
    },
    [open, clearCloseT, clearOpenT],
  )

  /** Pointer left the nav group — close after the grace delay. */
  const hoverClose = useCallback(() => {
    clearOpenT()
    if (closeTimer.current) return
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null
      setOpen(false)
    }, CLOSE_DELAY)
  }, [clearOpenT])

  /** Pointer (re-)entered the panel — abort a pending open/close. */
  const cancelClose = useCallback(() => {
    clearOpenT()
    clearCloseT()
  }, [clearOpenT, clearCloseT])

  /** Click / tap on a nav item. Also the whole story on touch, where there is
   *  no hover to open with. */
  const toggle = useCallback(
    (key) => {
      clearOpenT()
      clearCloseT()
      if (open && key === activeKey) {
        // Reflexive click right after a hover-open — keep it open.
        if (Date.now() < clickGuard.current) return
        clickGuard.current = 0
        setOpen(false)
        return
      }
      clickGuard.current = 0
      setActiveKey(key)
      setOpen(true)
    },
    [open, activeKey, clearOpenT, clearCloseT],
  )

  // Escape + tap-outside. Anything tagged data-nh-group (the bar row and the
  // panel) counts as inside — same containment test the original runs against
  // data-cv-explore-flyout. Bound only while open; removed on close/unmount.
  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape') {
        clearOpenT()
        clearCloseT()
        setOpen(false)
      }
    }
    const onDown = (e) => {
      const t = e.target
      if (!(t instanceof Element) || !t.closest('[data-nh-group]')) {
        clearOpenT()
        clearCloseT()
        setOpen(false)
      }
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onDown)
    }
  }, [open, clearOpenT, clearCloseT])

  const onItemEnter = (key) => (e) => {
    // Touch fires pointerenter too, immediately before the click that toggles.
    // Letting it through would open on the enter and close on the click.
    if (e.pointerType === 'mouse') hoverOpen(key)
  }

  return (
    <div
      ref={rootRef}
      className="mv-scope nh-root"
      onPointerLeave={hoverClose}
      aria-label="CrowdVolt nav flyout"
    >
      {/* ── The page underneath. Its only job is to be blurred. ───────────── */}
      <div className="nh-page" aria-hidden="true">
        <div className="nh-page-head">
          <span className="nh-page-title">This weekend</span>
          <span className="nh-page-link">See all</span>
        </div>
        <div className="nh-cards">
          {CARDS.map((c) => (
            <div key={c.title} className="nh-card">
              <div className={`nh-art nh-art-${c.art}`} />
              <div className="nh-card-title">{c.title}</div>
              <div className="nh-card-meta">{c.meta}</div>
            </div>
          ))}
        </div>
        <div className="nh-rule" />
        <div className="nh-page-foot">
          <span className="nh-page-title nh-page-title-sm">Popular in Chicago</span>
        </div>
      </div>

      {/* ── The scrim. Blurs + dims the page so the menu reads as a focused
             layer. Opacity/visibility only (no layout), and the backdrop-filter
             is attached ONLY while open — see the header note. ────────────── */}
      <div className="nh-backdrop" data-open={open ? 'true' : 'false'} aria-hidden="true" />

      {/* ── The shade: bar surface and panel as ONE sheet of glass. ───────── */}
      <div className="nh-shade" data-open={open ? 'true' : 'false'}>
        <div className="nh-frost" style={{ background: FROST_BG }} aria-hidden="true" />

        {/* Reserves the bar row; the bar's real content paints above it. */}
        <div className="nh-bar-spacer" aria-hidden="true" />

        <div
          data-nh-group
          className="nh-clip"
          onPointerEnter={cancelClose}
          onPointerLeave={hoverClose}
        >
          <div className="nh-clip-inner">
            {ITEMS.map((item) => {
              const isActive = item.key === activeKey
              return (
                <div key={item.key} className="nh-panel" data-active={isActive ? 'true' : 'false'}>
                  <div className="nh-panel-inner">
                    <div
                      className="nh-panel-content"
                      role="group"
                      aria-label={item.label}
                      aria-hidden={!open || !isActive}
                    >
                      {item.groups.map((g) => (
                        <div key={g.heading} className="nh-group">
                          <div className="nh-eyebrow">{g.heading}</div>
                          <div className="nh-pills">
                            {g.pills.map((p, i) => (
                              <span
                                key={p}
                                className="nh-pill"
                                data-selected={i === g.selected ? 'true' : 'false'}
                              >
                                {p}
                              </span>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* ── The bar row itself, above the glass. ──────────────────────────── */}
      <div data-nh-group className="nh-bar" onPointerLeave={hoverClose}>
        <span className="nh-logo" aria-hidden="true">
          <svg viewBox="0 0 12 16" focusable="false">
            <path d="M7.4 0 1 9h3.3l-.7 7L11 6.6H7.1L7.4 0Z" fill="currentColor" />
          </svg>
        </span>

        <nav className="nh-items" aria-label="Primary">
          {ITEMS.map((item) => {
            const isOpenItem = open && item.key === activeKey
            return (
              <button
                key={item.key}
                type="button"
                className="nh-item"
                aria-haspopup="true"
                aria-expanded={isOpenItem}
                data-open={isOpenItem ? 'true' : 'false'}
                onPointerEnter={onItemEnter(item.key)}
                onClick={() => toggle(item.key)}
              >
                {item.label}
                <svg className="nh-caret" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
                  <path
                    d="M3 4.75 6 7.75l3-3"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            )
          })}
        </nav>

        <span className="nh-login" aria-hidden="true">
          Log in
        </span>
      </div>

      <style jsx>{`
        /* ── The tile box. Everything is absolute inside this; nothing is
              fixed, so nothing can escape into the page. ─────────────────── */
        .nh-root {
          position: relative;
          overflow: hidden;
          width: 100%;
          min-width: 0;
          height: 300px;
          border-radius: var(--explore-radius);
          background: var(--explore-bg);
          font-family: var(--mv-font);
          color: var(--explore-text);
        }

        /* ── The page behind the glass ─────────────────────────────────── */
        .nh-page {
          position: absolute;
          inset: 0;
          z-index: 0;
          padding: 60px 14px 0;
        }
        .nh-page-head {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 10px;
          margin-bottom: 12px;
        }
        .nh-page-title {
          font-size: 19px;
          line-height: 1.15;
          font-weight: 700;
          letter-spacing: -0.02em;
        }
        .nh-page-title-sm {
          font-size: 15px;
          letter-spacing: -0.015em;
        }
        .nh-page-link {
          flex-shrink: 0;
          font-size: 12px;
          letter-spacing: -0.01em;
          color: var(--explore-accent);
        }
        .nh-cards {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 10px;
        }
        .nh-card {
          min-width: 0;
        }
        .nh-art {
          height: 66px;
          margin-bottom: 7px;
          border-radius: 8px;
          border: 1px solid var(--explore-hairline);
        }
        /* Multi-stop eased ramps through the brand triad — a flat two-stop fade
           turns to mud the moment the 6px scrim blur hits it. */
        .nh-art-a {
          background: linear-gradient(
            152deg,
            var(--graphic-dupe-1) 0%,
            #ff2e00 28%,
            var(--graphic-dupe-2) 58%,
            #ff8a3d 82%,
            var(--graphic-dupe-3) 100%
          );
        }
        .nh-art-b {
          background: linear-gradient(
            152deg,
            #2a1b4d 0%,
            #4b2a6b 24%,
            #8a3a72 52%,
            #d64a4a 78%,
            var(--graphic-dupe-2) 100%
          );
        }
        .nh-art-c {
          background: linear-gradient(
            152deg,
            #0f2b3d 0%,
            #17475e 26%,
            #2f7a86 55%,
            #7fb89b 80%,
            #e7d9a8 100%
          );
        }
        .nh-card-title {
          font-size: 12px;
          line-height: 1.25;
          font-weight: 600;
          letter-spacing: -0.01em;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .nh-card-meta {
          margin-top: 2px;
          font-size: 11px;
          line-height: 1.3;
          color: var(--explore-text-muted);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .nh-rule {
          height: 1px;
          margin: 16px 0 12px;
          background: var(--explore-hairline);
        }

        /* ── The scrim ─────────────────────────────────────────────────────
           Absolute, not fixed (their version covers the viewport; this one
           covers the tile). Sits below the shade so the bar and the growing
           panel paint over it un-blurred. */
        .nh-backdrop {
          position: absolute;
          inset: 0;
          z-index: 1;
          opacity: 0;
          visibility: hidden;
          pointer-events: none;
          background: rgba(0, 0, 0, 0.28);
          transition:
            opacity 0.4s cubic-bezier(0.22, 1, 0.36, 1),
            visibility 0.4s;
        }
        .nh-backdrop[data-open='true'] {
          opacity: 1;
          visibility: visible;
          -webkit-backdrop-filter: blur(6px);
          backdrop-filter: blur(6px);
        }

        /* ── The shade ─────────────────────────────────────────────────────
           One surface covering the bar row (via the spacer) and the revealed
           panel: one blur, one tint, one bottom hairline, no seam. */
        .nh-shade {
          position: absolute;
          inset-inline: 0;
          top: 0;
          z-index: 2;
        }
        .nh-frost {
          position: absolute;
          inset: 0;
          pointer-events: none;
          border-bottom: 1px solid var(--explore-hairline);
          -webkit-backdrop-filter: blur(12px);
          backdrop-filter: blur(12px);
        }
        .nh-bar-spacer {
          height: 46px;
        }

        /* The reveal: a grid-template-rows height wipe inside overflow:hidden.
           NOT clip-path, NOT transform — either severs the frost's
           backdrop-filter and the blur dies mid-animation. Exits faster (and on
           an accelerating curve) than it enters. */
        .nh-clip {
          display: grid;
          grid-template-rows: 0fr;
          pointer-events: none;
          transition: grid-template-rows 0.26s cubic-bezier(0.4, 0, 1, 1);
        }
        .nh-shade[data-open='true'] .nh-clip {
          grid-template-rows: 1fr;
          pointer-events: auto;
          transition: grid-template-rows 0.44s cubic-bezier(0.22, 1, 0.36, 1);
        }
        .nh-clip-inner {
          position: relative;
          min-height: 0;
          overflow: hidden;
        }

        /* Per-item panels stacked in the SAME container. The one you're on is
           1fr, the rest 0fr — identical timing on both, so on a switch the
           collapsing height and the expanding height sum to a clean
           interpolation and the container morphs instead of jumping. */
        .nh-panel {
          display: grid;
          grid-template-rows: 0fr;
          transition: grid-template-rows 0.34s cubic-bezier(0.22, 1, 0.36, 1);
        }
        .nh-panel[data-active='true'] {
          grid-template-rows: 1fr;
        }
        .nh-panel-inner {
          min-height: 0;
          overflow: hidden;
        }

        /* Content fades and lifts in a touch behind the wipe. */
        .nh-panel-content {
          padding: 4px 14px 16px;
          opacity: 0;
          transform: translateY(-8px);
          transition:
            opacity 0.2s ease-out,
            transform 0.2s ease-out;
        }
        .nh-shade[data-open='true'] .nh-panel[data-active='true'] .nh-panel-content {
          opacity: 1;
          transform: none;
          transition:
            opacity 0.32s ease-out 0.06s,
            transform 0.32s cubic-bezier(0.22, 1, 0.36, 1) 0.06s;
        }

        .nh-group + .nh-group {
          margin-top: 10px;
        }
        .nh-eyebrow {
          margin-bottom: 6px;
          font-size: 12px;
          line-height: 1.2;
          font-weight: 500;
          letter-spacing: -0.01em;
          color: var(--explore-text-muted);
        }
        .nh-pills {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }
        .nh-pill {
          display: inline-flex;
          align-items: center;
          white-space: nowrap;
          padding: 4px 10px;
          border: 1px solid var(--explore-hairline);
          border-radius: 9999px;
          background: rgba(255, 255, 255, 0.04);
          font-size: 12px;
          line-height: 1.25;
          font-weight: 500;
          letter-spacing: -0.01em;
          color: var(--explore-text);
        }
        .nh-pill[data-selected='true'] {
          border-color: transparent;
          background: var(--explore-text);
          color: #000;
        }

        /* ── The bar row, above the glass ──────────────────────────────── */
        .nh-bar {
          position: absolute;
          inset-inline: 0;
          top: 0;
          z-index: 3;
          display: flex;
          align-items: center;
          gap: 8px;
          height: 46px;
          padding: 0 12px;
        }
        .nh-logo {
          flex-shrink: 0;
          display: inline-flex;
          color: var(--explore-accent);
        }
        .nh-logo svg {
          width: 11px;
          height: 15px;
          display: block;
        }
        .nh-items {
          display: flex;
          align-items: center;
          gap: 2px;
          min-width: 0;
          margin-left: 2px;
        }
        .nh-item {
          display: inline-flex;
          align-items: center;
          gap: 3px;
          flex-shrink: 0;
          padding: 5px 8px;
          border: 0;
          border-radius: 9999px;
          background: transparent;
          font-family: inherit;
          font-size: 13px;
          line-height: 1.2;
          font-weight: 500;
          letter-spacing: -0.012em;
          color: var(--explore-text-muted);
          cursor: pointer;
          -webkit-tap-highlight-color: transparent;
          transition:
            color 0.15s ease-out,
            background-color 0.15s ease-out;
        }
        @media (hover: hover) {
          .nh-item:hover {
            color: var(--explore-text);
            background: rgba(255, 255, 255, 0.08);
          }
        }
        .nh-item:focus-visible {
          outline: 2px solid var(--explore-accent);
          outline-offset: 2px;
        }
        .nh-item[data-open='true'] {
          color: var(--explore-text);
          background: rgba(255, 255, 255, 0.08);
        }
        .nh-caret {
          width: 9px;
          height: 9px;
          flex-shrink: 0;
          transition: transform 0.2s ease-out;
        }
        .nh-item[data-open='true'] .nh-caret {
          transform: rotate(180deg);
        }
        .nh-login {
          margin-left: auto;
          flex-shrink: 0;
          padding: 5px 10px;
          border-radius: 9999px;
          background: var(--explore-surface);
          border: 1px solid var(--explore-hairline);
          font-size: 12px;
          line-height: 1.2;
          font-weight: 500;
          letter-spacing: -0.01em;
        }

        /* Narrowest supported width: drop the login pill and tighten the items
           so all four labels still fit on one row at 300px. */
        @media (max-width: 359px) {
          .nh-login {
            display: none;
          }
          .nh-item {
            padding: 5px 5px;
            font-size: 12px;
          }
        }

        /* ── Reduced motion ────────────────────────────────────────────────
           Kept from the original: the wipe still happens (it is the layout,
           not decoration) but short and linear-ish, and the content stops
           travelling. */
        @media (prefers-reduced-motion: reduce) {
          .nh-clip,
          .nh-shade[data-open='true'] .nh-clip,
          .nh-panel,
          .nh-panel[data-active='true'] {
            transition: grid-template-rows 0.18s ease-out;
          }
          .nh-panel-content,
          .nh-shade[data-open='true'] .nh-panel[data-active='true'] .nh-panel-content {
            transform: none;
            transition: opacity 0.18s ease-out;
          }
          .nh-backdrop {
            transition:
              opacity 0.2s ease-out,
              visibility 0.2s;
          }
          .nh-caret,
          .nh-item {
            transition: none;
          }
        }
      `}</style>
    </div>
  )
}

export default memo(NavHoverDemo)
