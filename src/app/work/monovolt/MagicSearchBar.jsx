'use client'

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'

import styles from './MagicSearchBar.module.css'

/* ═══════════════════════════════════════════════════════════════════════════
 * CrowdVolt's magic search bar, brought over from mono-volt
 * (apps/web/app/dev/search-bar/MagicSearchBar.tsx) intact.
 *
 * What changed on the way over is only the plumbing, never the motion:
 *   • TypeScript → JavaScript.
 *   • Every Tailwind utility that was on the JSX now lives in the .module.css
 *     (that repo's Tailwind config — font-inter, can-hover:, text-black/70 —
 *     does not exist here), so this file references only `styles.*`.
 *   • @phosphor-icons → lucide-react at strokeWidth 2.5, matching the weight.
 *   • cn() → the local `cx` join below; @repo/copy → the inlined placeholder.
 * Every CONFIG value, duration, easing and colour is verbatim.
 * ═══════════════════════════════════════════════════════════════════════════ */

// Tiny local stand-in for the source repo's cn() — no clsx/tailwind-merge here,
// and nothing being composed ever needs class conflict resolution.
const cx = (...parts) => parts.filter(Boolean).join(' ')

// ============================================================================
//  CONFIG — every tweakable parameter for the search bar lives here.
//  Edit these; nothing in the .css file needs touching.
// ============================================================================
const CONFIG = {
  // ── Shell ────────────────────────────────────────────────────────────────
  barBg: '#f2f2f2',
  ring: 'rgba(255,255,255,0.3)', // inset border colour/opacity
  innerShadow: 'inset 0 0 11px 0 rgba(0,0,0,0.5)', // dark inner vignette
  trackRadius: '28px', // path corner radius (= half the bar height)
  outerGlow: '0 0 16px 0 rgba(255,255,255,0.2)', // resting white halo
  outerGlowActive: '0 0 30px 2px rgba(255,255,255,0.34)', // hover/focus halo

  // ── Racing lights ────────────────────────────────────────────────────────
  lightColors: ['#ff4fa3', '#ff7a5c', '#ffd36b', '#5fd07a', '#3fb6e6', '#5b7cf0'],
  lightCount: 24, // more = denser/smoother coverage
  lightWidth: '74px', // light length ALONG the edge (coverage)
  lightHeight: '24px', // light thickness ACROSS the edge — SMALLER = bigger clean
  //                      gap in the center (top + bottom bands stop overlapping)
  lightBlur: '11px', // more = softer blend; less = sharper, motion more visible
  lightSaturate: 0.65, // colour intensity (1 = full, lower = more muted/subtle)
  lightOpacity: 0.32, // resting visibility (lower = subtler)
  lightOpacityActive: 0.14, // on hover/focus (lower = recede, higher = bloom)
  orbitSpeed: '26s', // lower = faster drift
  orbitEase: 'linear', // try "ease-in-out" for a breathing slow-down
  orbitDim: 0.35, // bottom-edge brightness (top stays 1)

  // ── Hover / focus reaction ───────────────────────────────────────────────
  hoverLift: '-1.5px', // how far the bar rises
  hoverScale: 1.012, // how much it grows
  hoverEase: 'cubic-bezier(0.22,1,0.36,1)',
  hoverDur: '0.65s',

  // ── Animated placeholder fade ────────────────────────────────────────────
  phBlur: '7px', // blur while hidden
  phSlide: '-8px', // px it slides as it leaves (negative = left)
  phDur: '0.45s',
  phEase: 'cubic-bezier(0.22,1,0.36,1)',

  // ── Right-side thumbnails pop ────────────────────────────────────────────
  imgPopDur: '0.34s',
  imgPopEase: 'cubic-bezier(0.34,1.56,0.64,1)',
  imgStaggerMs: 55, // delay between each card popping in
  imgScaleFrom: 0.6, // scale it grows from
  imgRiseFrom: 6, // px it rises from

  // ── Typewriter timing (ms) ───────────────────────────────────────────────
  typeMs: 55, // per character while typing
  eraseMs: 28, // per character while erasing
  holdMs: 1700, // dwell on a fully-typed query (image up)
  exitMs: 320, // let the image pop out before erasing
  gapMs: 260, // breath between queries
}

// The default placeholder, inlined from @repo/copy (SEARCH.placeholder).
const DEFAULT_PLACEHOLDER = 'Search by event, artist, or venue'

// The subset of CONFIG accepted as live overrides via the `config` prop is
// plain numbers, not CSS strings — px/s units are applied at merge time so any
// slider/control driving it stays clean:
//   barBg, lightCount, lightWidth, lightHeight, lightBlur, lightSaturate,
//   lightOpacity, lightOpacityActive, orbitSpeed, orbitDim,
//   typeMs, eraseMs, holdMs

// The cycled queries and the thumbnails that fan in on the right for each.
const PHRASES = [
  {
    text: "Cosmo's Midnight in Brooklyn",
    cards: [
      { src: '/monovolt/cosmos-midnight.webp', alt: "Cosmo's Midnight", size: 46, rotate: 6, x: 0, z: 1 },
    ],
  },
  {
    text: 'LP Giobbi this weekend',
    cards: [{ src: '/monovolt/lp-giobbi.webp', alt: 'LP Giobbi', size: 46, rotate: -5, x: 0, z: 1 }],
  },
  {
    text: 'Louis the Child near me',
    cards: [
      { src: '/monovolt/louis-the-child.webp', alt: 'Louis the Child', size: 46, rotate: 5, x: 0, z: 1 },
    ],
  },
  {
    text: 'John Lennon tonight at pacha',
    cards: [
      { src: '/monovolt/louis-the-child.webp', alt: 'Louis the Child', size: 42, rotate: -9, x: -26, z: 1 },
      { src: '/monovolt/cosmos-midnight.webp', alt: "Cosmo's Midnight", size: 44, rotate: 0, x: 0, z: 3 },
      { src: '/monovolt/lp-giobbi.webp', alt: 'LP Giobbi', size: 42, rotate: 7, x: 26, z: 2 },
    ],
  },
]

// CONFIG's visual values are mapped to CSS custom properties inside the
// component (so live `config` overrides flow through) — see `vars` below.

// Three modes:
//  • default   — a plain bar: racing lights only, with a static placeholder.
//  • asTrigger — input neutralised (read-only, non-focusable, click passes
//                through) so the bar is a launcher; the parent handles the click.
//  • active    — the input is the REAL search input, wired to the caller's
//                value/handlers; the showcase is off. Same shell, so it can sit
//                under the same layoutId as the trigger.
//
// `showcase` is the opt-in flag for the typewriter + fanning-thumbnail loop. It's
// OFF by default — the cycling inner text/images read as "too much" in most
// placements, so callers must explicitly opt in (`<MagicSearchBar showcase />`).
// The racing lights run regardless; only the inner content loop is gated.
export function MagicSearchBar({
  asTrigger = false,
  active = false,
  showcase = false,
  compact = false,
  searchValue = '',
  onSearchChange,
  onSearchFocus,
  onSearchBlur,
  onSearchKeyDown,
  /** active mode: clears the field (shows an inline ✕ when there's a value). */
  onClear,
  inputRef,
  activePlaceholder = DEFAULT_PLACEHOLDER,
  config,
  /** Override/extend root classes. */
  className,
} = {}) {
  // Merge live overrides over CONFIG; px/s units applied here so callers pass
  // plain numbers. Visual vars update live; JS timing applies on the next cycle.
  //
  // Destructure to PRIMITIVES so the memos below key on the actual values, not
  // the `config` object's identity — callers routinely pass a fresh literal each
  // render (e.g. `config={{ lightCount: 0 }}`), so memoizing on the object ref
  // would never hit. Keyed on primitives, `cfg`/`vars`/`lights` are rebuilt ONLY
  // when a config value actually changes — not on every parent re-render or
  // showcase typewriter tick (which fires ~20×/s).
  const {
    barBg,
    lightCount,
    lightWidth,
    lightHeight,
    lightBlur,
    lightSaturate,
    lightOpacity,
    lightOpacityActive,
    orbitSpeed,
    orbitDim,
    typeMs,
    eraseMs,
    holdMs,
  } = config ?? {}
  const cfg = useMemo(
    () => ({
      ...CONFIG,
      barBg: barBg ?? CONFIG.barBg,
      lightCount: lightCount ?? CONFIG.lightCount,
      lightWidth: lightWidth != null ? `${lightWidth}px` : CONFIG.lightWidth,
      lightHeight: lightHeight != null ? `${lightHeight}px` : CONFIG.lightHeight,
      lightBlur: lightBlur != null ? `${lightBlur}px` : CONFIG.lightBlur,
      lightSaturate: lightSaturate ?? CONFIG.lightSaturate,
      lightOpacity: lightOpacity ?? CONFIG.lightOpacity,
      lightOpacityActive: lightOpacityActive ?? CONFIG.lightOpacityActive,
      orbitSpeed: orbitSpeed != null ? `${orbitSpeed}s` : CONFIG.orbitSpeed,
      orbitDim: orbitDim ?? CONFIG.orbitDim,
      typeMs: typeMs ?? CONFIG.typeMs,
      eraseMs: eraseMs ?? CONFIG.eraseMs,
      holdMs: holdMs ?? CONFIG.holdMs,
    }),
    [
      barBg,
      lightCount,
      lightWidth,
      lightHeight,
      lightBlur,
      lightSaturate,
      lightOpacity,
      lightOpacityActive,
      orbitSpeed,
      orbitDim,
      typeMs,
      eraseMs,
      holdMs,
    ],
  )
  const vars = useMemo(
    () => ({
      '--bar-bg': cfg.barBg,
      '--ring': cfg.ring,
      '--inner-shadow': cfg.innerShadow,
      '--track-radius': cfg.trackRadius,
      '--outer-glow': cfg.outerGlow,
      '--outer-glow-active': cfg.outerGlowActive,
      '--light-width': cfg.lightWidth,
      '--light-height': cfg.lightHeight,
      '--light-blur': cfg.lightBlur,
      '--light-saturate': cfg.lightSaturate,
      '--light-opacity': cfg.lightOpacity,
      '--light-opacity-active': cfg.lightOpacityActive,
      '--orbit-speed': cfg.orbitSpeed,
      '--orbit-ease': cfg.orbitEase,
      '--orbit-dim': cfg.orbitDim,
      '--hover-lift': cfg.hoverLift,
      '--hover-scale': cfg.hoverScale,
      '--hover-ease': cfg.hoverEase,
      '--hover-dur': cfg.hoverDur,
      '--ph-blur': cfg.phBlur,
      '--ph-slide': cfg.phSlide,
      '--ph-dur': cfg.phDur,
      '--ph-ease': cfg.phEase,
    }),
    [cfg],
  )
  // The orbiting lights are pure CSS animation (offset-path) — their DOM never
  // changes after mount, so build it once and let React skip reconciling all
  // `lightCount` spans on every showcase tick / keystroke. Colours are a module
  // constant; the per-light delay is a NEGATIVE fraction of the CSS
  // `--orbit-speed` var — starting each light already that far into the same
  // animation is what distributes them evenly around the ring without needing
  // `lightCount` separate keyframes. Only the COUNT feeds this.
  const lights = useMemo(
    () =>
      Array.from({ length: cfg.lightCount }, (_, i) => (
        <span
          key={i}
          className={styles.light}
          style={{
            background: cfg.lightColors[i % cfg.lightColors.length],
            animationDelay: `calc(var(--orbit-speed) * ${-(i / cfg.lightCount).toFixed(4)})`,
          }}
        />
      )),
    [cfg.lightCount, cfg.lightColors],
  )
  const [value, setValue] = useState('')
  const [focused, setFocused] = useState(false)
  const [phraseIndex, setPhraseIndex] = useState(0)
  const [typed, setTyped] = useState('')
  const [resolved, setResolved] = useState(false) // query fully typed -> images up
  const indexRef = useRef(0)

  // The showcase only plays when explicitly opted in via `showcase`, while the
  // field is idle (empty + unfocused), and never in active mode — there it
  // behaves as a plain real input.
  const animating = showcase && !active && value === '' && !focused

  useEffect(() => {
    if (!animating) {
      // leave `typed` intact so the placeholder fades out WITH its text rather
      // than emptying first; it resets on the next activation.
      setResolved(false)
      return
    }

    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    if (reduce) {
      // Park on one query, image shown, no looping.
      setPhraseIndex(0)
      indexRef.current = 0
      setTyped(PHRASES[0].text)
      setResolved(true)
      return
    }

    let cancelled = false
    let timer = null
    let release = null

    // Cancellable delay. This tile is lazy-mounted AND unmounted by the /work
    // grid, so a pending timeout must not outlive the effect: cleanup clears the
    // timer and also calls its resolver, which wakes the suspended loop so it
    // reaches its next `if (cancelled) return` and unwinds — instead of parking
    // an async frame on a promise that would never settle. Every `await` below
    // is followed by a cancelled check before any setState, so nothing can set
    // state after unmount.
    const delay = (ms) =>
      new Promise((resolve) => {
        release = resolve
        timer = setTimeout(resolve, ms)
      })

    const run = async () => {
      // Pick up where we left off so toggling focus doesn't always restart at 0.
      while (!cancelled) {
        const i = indexRef.current
        const phrase = PHRASES[i].text
        setPhraseIndex(i)
        setResolved(false)
        setTyped('')

        for (let c = 1; c <= phrase.length; c++) {
          if (cancelled) return
          setTyped(phrase.slice(0, c))
          await delay(cfg.typeMs)
        }
        if (cancelled) return

        setResolved(true) // images fan in
        await delay(cfg.holdMs)
        if (cancelled) return

        setResolved(false) // images pop out
        await delay(cfg.exitMs)
        if (cancelled) return

        for (let c = phrase.length; c >= 0; c--) {
          if (cancelled) return
          setTyped(phrase.slice(0, c))
          await delay(cfg.eraseMs)
        }
        if (cancelled) return

        await delay(cfg.gapMs)
        indexRef.current = (i + 1) % PHRASES.length
      }
    }

    run()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      if (release) release()
    }
    // Deliberately keyed on `animating` alone: a timing change from `config`
    // should land on the NEXT cycle rather than restarting the query mid-word.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animating])

  const cards = PHRASES[phraseIndex]?.cards ?? []

  return (
    <div className={cx(styles.root, compact && styles.compact, className)} style={vars}>
      {/* `hasThumbs` reserves the well: the thumbnails are an absolutely
          positioned overlay, so without it the typed query runs UNDER them and
          the right-edge mask is the only thing hiding the collision. */}
      <div className={cx(styles.bar, animating && styles.hasThumbs)}>
        {/* lights racing around the inner edge of the ring. In compact mode (the
            docked nav bar) they're hidden on mobile so it reads as a plain,
            static bar, but kept on desktop — gated via CSS (.compact .orbit). */}
        <div className={styles.orbit} aria-hidden>
          {lights}
        </div>

        <Search size={compact ? 20 : 24} strokeWidth={2.5} className={styles.icon} />

        {/* input + animated placeholder share one box; the placeholder is a
            pointer-events-none layer so clicks always land on the real input */}
        <div className={styles.field}>
          <input
            ref={inputRef}
            value={active ? searchValue : value}
            onChange={active ? onSearchChange : (e) => setValue(e.target.value)}
            onFocus={active ? onSearchFocus : () => setFocused(true)}
            onBlur={active ? onSearchBlur : () => setFocused(false)}
            onKeyDown={active ? onSearchKeyDown : undefined}
            placeholder={active ? activePlaceholder : undefined}
            aria-label="Search"
            // Label the on-screen keyboard's return key "Search" (iOS/Android)
            // instead of the generic return arrow. type stays text so the native
            // type="search" clear "✕" doesn't duplicate our custom clear button.
            enterKeyHint="search"
            inputMode="search"
            readOnly={asTrigger}
            tabIndex={asTrigger ? -1 : undefined}
            className={cx(
              styles.input,
              styles.fadeRight,
              active && styles.inputActive,
              asTrigger && styles.inputTrigger,
            )}
          />
          {active ? null : showcase ? (
            <div
              className={cx(
                styles.placeholder,
                styles.fadeRight,
                animating && styles.placeholderShow,
              )}
            >
              {`Search for “${typed}`}
              <span className={styles.caret} />
              {'”'}
            </div>
          ) : (
            <div
              className={cx(
                styles.placeholder,
                styles.fadeRight,
                value === '' && styles.placeholderShow,
              )}
            >
              {activePlaceholder}
            </div>
          )}
        </div>

        {/* Clear button — active mode only, shown once there's a value. Instantly
            empties the field via the caller's onClear (which also refocuses). */}
        {active && onClear && searchValue.length > 0 ? (
          <button type="button" onClick={onClear} aria-label="Clear search" className={styles.clear}>
            <X size={compact ? 16 : 18} strokeWidth={2.5} />
          </button>
        ) : null}

        {/* thumbnails that fan in/out on the right, keyed to the query */}
        {animating ? (
          <div className={styles.thumbs} aria-hidden>
            <div key={phraseIndex} className={styles.thumbsInner}>
              {cards.map((card, i) => (
                <img
                  key={`${card.src}-${i}`}
                  src={card.src}
                  alt={card.alt}
                  style={{
                    width: card.size,
                    height: card.size,
                    zIndex: card.z,
                    transform: resolved
                      ? `translate(calc(-50% + ${card.x}px), -50%) scale(1) rotate(${card.rotate}deg)`
                      : `translate(calc(-50% + ${card.x}px), calc(-50% + ${CONFIG.imgRiseFrom}px)) scale(${CONFIG.imgScaleFrom}) rotate(${card.rotate}deg)`,
                    opacity: resolved ? 1 : 0,
                    transition: `opacity 0.25s ease, transform ${CONFIG.imgPopDur} ${CONFIG.imgPopEase}`,
                    transitionDelay: resolved ? `${i * CONFIG.imgStaggerMs}ms` : '0ms',
                  }}
                  className={styles.thumb}
                />
              ))}
            </div>
          </div>
        ) : null}

        {/* inset ring + dark vignette, above everything */}
        <div className={styles.edge} />
      </div>
    </div>
  )
}

/* ── The tile ──────────────────────────────────────────────────────────────
 * Zero props: the /work grid mounts this blind from a string key. No controls,
 * no toggles — the bar as it ships, typewriter running, orbit at CONFIG's own
 * 26s. Anything worth seeing here happens on its own. */

function MagicSearchBarDemo() {
  return (
    <div className={styles.demo}>
      <MagicSearchBar showcase />
    </div>
  )
}

export default memo(MagicSearchBarDemo)
