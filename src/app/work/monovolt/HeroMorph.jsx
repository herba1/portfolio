'use client'

import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'

import styles from './HeroMorph.module.css'

/* ═══════════════════════════════════════════════════════════════════════════
 * HeroMorph — CrowdVolt's homepage headline, as a playground tile.
 *
 * Ported from mono-volt/apps/web/app/hero-text/HeroTextEngine.tsx (the engine)
 * + hero-text.css (the look), pinned to the config the production wrapper
 * (home-explore/hero/HeroText.tsx) ships: centered, `shimmer` reveal, hover-
 * revealed inline image.
 *
 * Three lines. Lines 2 and 3 morph on a timer. Each morph is a CSS WIDTH tween
 * (--mw, measured off a hidden ghost) plus a per-character enter/exit animation
 * driven by a three-phase machine (exit → enter → idle) whose timings are
 * computed from the morph duration and the character count. The subject name is
 * hoverable: hovering springs the inline image out of the end of the word and
 * PAUSES the auto-cycle while the pointer is on it.
 *
 * Differences from the source are all consequences of this being a tile rather
 * than a page — see the comments at each one. Nothing about the motion changed.
 * ═══════════════════════════════════════════════════════════════════════════ */

// useLayoutEffect warns during SSR; fall back to useEffect on the server so
// there's no "not-ready" console noise.
const useIsoLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect

/* ---- dynamic content (lines 2 & 3 swap; line 1 is static) ---------------- */

const LINE2_OPTIONS = [
  'coming out',
  'dancing',
  'raving',
  'wide awake',
  'front-left',
  'losing it',
  'backstage',
  'partying',
  'out late',
  'peaking',
]

// The source seeded picsum.photos. A tile in this repo makes NO external
// requests, so the loop cycles three local stills that already ship here.
const IMAGES = [
  '/monovolt/cosmos-midnight.webp',
  '/monovolt/lp-giobbi.webp',
  '/monovolt/louis-the-child.webp',
]

const pick = (i) => IMAGES[i % IMAGES.length]

const SUBJECTS = [
  { lead: 'at', name: 'Pacha', img: pick(0) },
  { lead: 'at', name: 'Berghain', img: pick(1) },
  { lead: 'at', name: 'Printworks', img: pick(2) },
  { lead: 'to', name: 'Anyma', img: pick(3) },
  { lead: 'to', name: 'Keinemusik', img: pick(4) },
  { lead: 'to', name: 'Charlotte de Witte', img: pick(5) },
  { lead: 'at', name: 'Time Warp', img: pick(6) },
  { lead: 'at', name: 'Awakenings', img: pick(7) },
]

/* ---- config -------------------------------------------------------------- */
/* Every magic number is a CSS var on the hero root, exactly as in the source.
 * `fs` is the one that did NOT survive: the source pinned 77.528px for a
 * full-bleed hero, while a tile has to hold three nowrap lines in 320–720px, so
 * the size is a fluid clamp in the stylesheet instead (see .hero).
 *
 * Module-level and frozen: a stable reference, so the effects below that read
 * config values never see a new object. */
const CONFIG = {
  lh: 1.0417, // line-height, unitless (× font-size)
  ls: -0.07, // letter-spacing, em
  morphDur: 560, // width + content tween, ms
  morphEase: 'cubic-bezier(0.22, 1, 0.36, 1)', // settle (ease-out)
  dwell: 3800, // how long content stays before auto-cycling, ms
  stagger: 22, // per-character delay on enter/leave, ms
  blur: 0.055, // enter/leave blur amount, em
  reveal: 'shimmer', // per-char enter style
  shimmerA: '#6ee7ff',
  shimmerB: '#ff9ecb',
  shimmerC: '#ffd76e',
  hoverShimmer: true, // the source ships this OFF; the whole point of the tile
  align: 'center', //  is showing it, so it's ON here.
  imgH: 0.94, // inline image height, em
  imgRadius: 0.22, // inline image corner radius, em
  imgShift: -0.12, // inline image vertical-align, em
  imgGap: 0.08, // space before the inline image, em
  imgShadow: 0.17, // inline image shadow blur, em
}

const HERO_VARS = {
  '--lh': CONFIG.lh,
  '--ls': `${CONFIG.ls}em`,
  '--morph-dur': `${CONFIG.morphDur}ms`,
  '--morph-ease': CONFIG.morphEase,
  '--stagger': `${CONFIG.stagger}ms`,
  '--blur': `${CONFIG.blur}em`,
  '--shimmer-a': CONFIG.shimmerA,
  '--shimmer-b': CONFIG.shimmerB,
  '--shimmer-c': CONFIG.shimmerC,
  '--img-h': `${CONFIG.imgH}em`,
  '--img-radius': `${CONFIG.imgRadius}em`,
  '--img-shift': `${CONFIG.imgShift}em`,
  '--img-gap': `${CONFIG.imgGap}em`,
  '--img-shadow': `${CONFIG.imgShadow}em`,
}

/* ═══════════════════════════════════════════════════════════════════════════
 * MorphText — an inline segment that animates its width when `text` changes,
 * with a per-character blur + stagger on the leaving and entering text.
 * ═══════════════════════════════════════════════════════════════════════════ */

function chars(text) {
  return Array.from(text).map((ch, i) => (
    <span key={i} className={styles.char} style={{ '--i': i }}>
      {ch === ' ' ? ' ' : ch}
    </span>
  ))
}

function MorphTextBase({ text, dur, stagger, onStart, onSettle }) {
  const boxRef = useRef(null)
  const ghostRef = useRef(null)
  const phaseRef = useRef('idle')
  const onStartRef = useRef(onStart)
  const onSettleRef = useRef(onSettle)
  onStartRef.current = onStart
  onSettleRef.current = onSettle

  const [shown, setShown] = useState(text)
  const [leaving, setLeaving] = useState(null)
  const [phase, setPhase] = useState('idle')
  phaseRef.current = phase

  if (text !== shown) {
    setLeaving(shown)
    setShown(text)
    setPhase('exit')
  }

  const measure = useCallback(() => {
    const box = boxRef.current
    const ghost = ghostRef.current
    if (!box || !ghost) return
    // --mw is the bare text width ONLY. The constant trailing slack (the old
    // `pad`) lives in CSS as --morph-pad / margin-inline-end so it's present on
    // the first SSR paint too — folding it in here is what made the gap after
    // the word snap wider once the first measure ran (the SSR fallback
    // `max-content` carries no slack). See .morph in HeroMorph.module.css.
    const w = ghost.getBoundingClientRect().width
    box.style.setProperty('--mw', `${w}px`)
  }, [])

  useIsoLayoutEffect(() => {
    measure()
    let alive = true
    if (typeof document !== 'undefined' && document.fonts?.ready) {
      document.fonts.ready
        .then(() => alive && phaseRef.current !== 'exit' && measure())
        .catch(() => {})
    }
    const ghost = ghostRef.current
    if (!ghost) return undefined
    const ro = new ResizeObserver(() => {
      if (phaseRef.current !== 'exit') measure()
    })
    ro.observe(ghost)
    return () => {
      // `alive` also gates the fonts.ready continuation, which can resolve long
      // after this tile is scrolled away and unmounted.
      alive = false
      ro.disconnect()
    }
  }, [measure])

  useEffect(() => {
    if (phase === 'exit') onStartRef.current?.()
  }, [phase, leaving])

  useEffect(() => {
    if (phase !== 'exit') return undefined
    const n = Math.max(0, (leaving?.length ?? 1) - 1)
    const exitMs = dur * 0.62 + n * stagger * 0.55 + 40
    const id = setTimeout(() => setPhase('enter'), exitMs)
    return () => clearTimeout(id)
  }, [phase, leaving, dur, stagger])

  useIsoLayoutEffect(() => {
    if (phase === 'enter') measure()
  }, [phase, measure])

  useEffect(() => {
    if (phase !== 'enter') return undefined
    const n = Math.max(0, shown.length - 1)
    const cueMs = dur * 0.45 + n * stagger * 0.6
    const enterMs = dur + n * stagger + 60
    const cue = setTimeout(() => onSettleRef.current?.(), cueMs)
    const done = setTimeout(() => {
      setPhase('idle')
      setLeaving(null)
    }, enterMs)
    return () => {
      clearTimeout(cue)
      clearTimeout(done)
    }
  }, [phase, shown, dur, stagger])

  const animating = phase !== 'idle'

  return (
    <span className={styles.morph} ref={boxRef}>
      <span className={styles.ghost} aria-hidden="true" ref={ghostRef}>
        {chars(shown)}
      </span>
      <span className={`${styles.base}${animating ? ` ${styles.isHidden}` : ''}`}>
        {chars(shown)}
      </span>
      {phase === 'exit' && leaving != null && (
        <span
          className={`${styles.layer} ${styles.layerOut}`}
          key={`out-${leaving}`}
          aria-hidden="true"
        >
          {chars(leaving)}
        </span>
      )}
      {phase === 'enter' && (
        <span
          className={`${styles.layer} ${styles.layerIn}`}
          key={`in-${shown}`}
          aria-hidden="true"
        >
          {chars(shown)}
        </span>
      )}
    </span>
  )
}

// The three MorphText segments are siblings, so any root re-render (hovered /
// paused / active toggles) would otherwise re-run all three even when only one
// segment's `text` is changing. Memo keeps each segment inert until its own
// props move; the root passes stable primitives, so the shallow compare holds.
const MorphText = memo(MorphTextBase)

/* ═══════════════════════════════════════════════════════════════════════════
 * InlineImg — an image that fits perfectly between characters.
 * ═══════════════════════════════════════════════════════════════════════════ */

function InlineImg({ src, out }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className={`${styles.img}${out ? ` ${styles.isOut}` : ''}`}
      src={src}
      alt=""
      draggable={false}
    />
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
 * HeroMorphDemo — the tile. Zero props: the /work grid mounts it blind.
 * ═══════════════════════════════════════════════════════════════════════════ */

function HeroMorphDemo() {
  const rootRef = useRef(null)

  const [line2, setLine2] = useState(0)
  const [subject, setSubject] = useState(0)
  const [hovered, setHovered] = useState(false)

  // Active = tab visible AND the tile is on screen. The auto-cycle only runs
  // while active, so nothing animates in the background or when scrolled away.
  const [active, setActive] = useState(true)
  useEffect(() => {
    const el = rootRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return undefined
    let inView = true
    let visible = !document.hidden
    const sync = () => setActive(inView && visible)
    const io = new IntersectionObserver(
      (entries) => {
        inView = !!entries[0]?.isIntersecting
        sync()
      },
      { threshold: 0.05 },
    )
    io.observe(el)
    const onVis = () => {
      visible = !document.hidden
      sync()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      io.disconnect()
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [])

  // Hover-reveal: the image is hidden until the subject is hovered, and
  // hovering also pauses the cycle (below) so the preview can't swap out
  // underfoot. imgMode is pinned to "hover", so the source's "auto" bookkeeping
  // (imgSubject / imgOut, fed by MorphText's onStart/onSettle) is dead here and
  // is not carried over — the image index is just the live subject index.
  const onSubjectEnter = useCallback(() => setHovered(true), [])
  const onSubjectLeave = useCallback(() => setHovered(false), [])

  // Line 3 advances one beat behind line 2, so the two morphs read as a
  // sequence rather than one simultaneous flip. The source fired this as a bare
  // setTimeout; here it's tracked so an unmount mid-beat can't leave a pending
  // setState behind (this tile gets unmounted as the grid scrolls past it).
  const beatRef = useRef(null)
  const advance = useCallback(() => {
    setLine2((i) => (i + 1) % LINE2_OPTIONS.length)
    if (beatRef.current) clearTimeout(beatRef.current)
    beatRef.current = setTimeout(() => {
      beatRef.current = null
      setSubject((i) => (i + 1) % SUBJECTS.length)
    }, 140)
  }, [])
  useEffect(() => () => clearTimeout(beatRef.current), [])

  // Auto-cycle: advance every `dwell` ms, clamped so it never fires before the
  // current change has finished animating. It stops when the tile is off-screen
  // or the tab is hidden, and while the subject is hovered — that last one is
  // the source's own behaviour, so a preview can't swap out from under the
  // pointer. There is no pause control: hovering IS the pause.
  useEffect(() => {
    if (!active || hovered) return undefined
    const period = Math.max(CONFIG.morphDur + 900, CONFIG.dwell)
    const id = setInterval(advance, period)
    return () => clearInterval(id)
  }, [active, hovered, advance])

  const subj = SUBJECTS[subject % SUBJECTS.length]

  return (
    <div className={styles.root} ref={rootRef}>
      <div
        className={styles.hero}
        style={HERO_VARS}
        data-morph-reveal={CONFIG.reveal}
        data-align={CONFIG.align}
        data-hover-shimmer={CONFIG.hoverShimmer ? 'on' : undefined}
      >
        {/* line 1 — static */}
        <span className={styles.line}>No more excuses.</span>

        {/* line 2 — morphing word with a trailing word so the width is felt */}
        <span className={styles.line}>
          You&rsquo;re{' '}
          <MorphText
            text={LINE2_OPTIONS[line2] ?? ''}
            dur={CONFIG.morphDur}
            stagger={CONFIG.stagger}
          />{' '}
          tonight
        </span>

        {/* line 3 — morphing connector + subject + perfectly-inline image. The
            source rendered the subject as a <Link> to the event; this is a
            demo, not a navigable page, so it's a <span> that keeps the pointer
            cursor and the hover handlers and goes nowhere. The city-intro line
            ("in <city>") is dropped with it — it only existed to hold the line
            while live feed data was in flight, and there is no feed here. */}
        <span className={styles.line}>
          <MorphText
            text={subj.lead}
            dur={CONFIG.morphDur}
            stagger={CONFIG.stagger}
          />{' '}
          <span
            className={`${styles.subject} ${styles.hoverable}`}
            onMouseEnter={onSubjectEnter}
            onMouseLeave={onSubjectLeave}
          >
            <MorphText
              text={subj.name}
              dur={CONFIG.morphDur}
              stagger={CONFIG.stagger}
            />
            <InlineImg src={subj.img} out={!hovered} />
          </span>
        </span>
      </div>
    </div>
  )
}

export default memo(HeroMorphDemo)
