'use client'

import { memo, useCallback, useState } from 'react'
import dynamic from 'next/dynamic'

import MvScope from './monovolt/Scope'
import Waveform from '@/app/ui/Waveform'
import PlayPauseIcon from '@/app/ui/PlayPauseIcon'
import GlitchText from '@/app/ui/GlitchText'
import MorphText from '@/app/ui/MorphText'
import SlotNumber from '@/app/ui/SlotNumber'
import ImageFan from '@/app/ui/ImageFan'
import LinkMask from '@/app/ui/LinkMask'
import { Audio } from '@/app/(blog)/components/Audio'
import { Callout } from '@/app/(blog)/components/Callout'
import { Quote } from '@/app/(blog)/components/Quote'
import { Badge } from '@/app/(blog)/components/Badge'
import { LinkButton } from '@/app/(blog)/components/LinkButton'
import { Divider } from '@/app/(blog)/components/Divider'
import { Lead } from '@/app/(blog)/components/Lead'

/* ─────────────────────────────────────────────────────────────
 * The component registry — the only place a tile can source a live
 * component from. Every entry is a PLAYGROUND: the real component off
 * the site, plus whatever controls it takes to actually play with it.
 * Nothing here is a screenshot and nothing here is a special "demo"
 * copy — these are the same modules /blog, the hero and the index
 * pages import.
 *
 * Rules for anything added here:
 *   1. Zero props. The grid mounts it blind from a string key.
 *   2. It must work at 320px wide. A tile is a third of a wide window,
 *      a half of a normal one and the full width of a phone.
 *   3. It must be memoised and its handlers stable — a tile sits in a
 *      grid that re-measures on every resize, and a live component
 *      should not be torn through on someone else's re-render.
 *
 * ── ADDING A HEAVY ONE (GSAP, WebGL, a rAF loop, a big timeline) ──────
 *
 *   1. Pull it in with next/dynamic and `ssr: false`, so its library
 *      lands in its own chunk instead of the page's first load. Nothing
 *      on this page needs to exist in the server-rendered HTML: the tile
 *      holds the box, and the component arrives when it is scrolled to.
 *   2. Mark the entry `heavy: true`. That opts it into being UNMOUNTED
 *      once it is far off screen (see LiveComponent in WorkTile), so its
 *      timeline is not still running three screens above you.
 *   3. Give the tile a declared ratio in the studio. A heavy component
 *      is torn down and rebuilt as you scroll past, so its tile needs a
 *      box that does not depend on it being there.
 *   4. Kill your own work on unmount — a GSAP context/timeline, a rAF
 *      handle, a listener. `heavy` is what CALLS the cleanup; the
 *      component still has to have one. useGSAP with a scope does this
 *      for free; a bare gsap.to() does not.
 *
 * `heavy: false` (the default) means the opposite trade: mounted once
 * when approached, then kept forever. That is the right call for
 * anything holding state you would be annoyed to lose — a playing audio
 * element, a half-dragged scrubber.
 * ───────────────────────────────────────────────────────────── */

/* ── Playground furniture ──────────────────────────────────────────── */

// A control. Straight off the site's own `.btn`, so a playground's buttons
// are the same object as a button anywhere else — pressed state included.
const Ctl = memo(function Ctl({ onClick, pressed, children, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      aria-label={label}
      className={`btn btn--sm ${pressed ? 'btn--raised' : 'btn--secondary'}`}
    >
      {children}
    </button>
  )
})

// The component on top, its controls underneath. The stage sizes to its own
// content and the tile centres it — a fixed-ratio tile does that with the
// box, an auto tile just hugs.
const Stage = memo(function Stage({ children, controls }) {
  return (
    <div className="flex w-full min-w-0 flex-col gap-4">
      <div className="flex w-full min-w-0 items-center justify-center">
        {children}
      </div>
      {controls ? (
        <div className="flex flex-wrap items-center justify-center gap-2">
          {controls}
        </div>
      ) : null}
    </div>
  )
})

/* ── The pieces ────────────────────────────────────────────────────── */

// Deterministic peaks so the waveform looks like real audio and renders
// identically on every visit (no Math.random → no hydration drift).
const PEAKS = Array.from({ length: 48 }, (_, i) => {
  const a = Math.sin(i * 0.7) * 0.5 + 0.5
  const b = Math.sin(i * 2.3 + 1.1) * 0.5 + 0.5
  return 0.14 + (a * 0.6 + b * 0.4) * 0.8
})

const CLIP_SECONDS = 96

function clock(s) {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

// Scrub it, and drag past either edge — the bars splay apart and spring back.
// The readout is the site's own odometer, so the seconds roll rather than cut.
const WaveformDemo = memo(function WaveformDemo() {
  const [time, setTime] = useState(21)
  const rewind = useCallback(() => setTime(0), [])
  const end = useCallback(() => setTime(CLIP_SECONDS), [])

  return (
    <Stage
      controls={
        <>
          <Ctl onClick={rewind}>Start</Ctl>
          <Ctl onClick={end}>End</Ctl>
        </>
      }
    >
      <div className="flex w-full min-w-0 flex-col gap-2">
        <Waveform
          peaks={PEAKS}
          progress={time / CLIP_SECONDS}
          duration={CLIP_SECONDS}
          onSeek={setTime}
          height={64}
        />
        <p className="text-ink text-ui-lg flex justify-end font-mono">
          <SlotNumber value={clock(time)} />
        </p>
      </div>
    </Stage>
  )
})

const PlayPauseDemo = memo(function PlayPauseDemo() {
  const [playing, setPlaying] = useState(false)
  const toggle = useCallback(() => setPlaying((p) => !p), [])

  return (
    <Stage>
      <button
        onClick={toggle}
        className="text-ink flex items-center gap-4"
        aria-label={playing ? 'Pause' : 'Play'}
      >
        <span className="bg-surface-sunken squircle flex size-14 items-center justify-center">
          <PlayPauseIcon playing={playing} size={22} />
        </span>
        <span className="text-ui-lg text-ink">
          {playing ? 'Playing' : 'Tap to play'}
        </span>
      </button>
    </Stage>
  )
})

// Same letters, new word: the shared glyphs slide across and only the rest
// fades. Cycling the string is the whole point of the component.
const MORPH_WORDS = [
  'have a nice day',
  'have a nice night',
  'have a great day',
  'nice',
]

const MorphDemo = memo(function MorphDemo() {
  const [i, setI] = useState(0)
  const next = useCallback(() => setI((n) => (n + 1) % MORPH_WORDS.length), [])

  return (
    <Stage controls={<Ctl onClick={next}>Change the words</Ctl>}>
      <p className="text-ink text-title-sm md:text-title text-center">
        <MorphText text={MORPH_WORDS[i]} />
      </p>
    </Stage>
  )
})

// The odometer. Columns roll independently and only the digits that changed
// move, so ±7 rolls one column and a jump rolls three.
const SlotDemo = memo(function SlotDemo() {
  const [n, setN] = useState(128)
  const down = useCallback(() => setN((v) => Math.max(0, v - 7)), [])
  const up = useCallback(() => setN((v) => Math.min(999, v + 7)), [])
  // Math.random in a click handler, never in render — the first paint has to
  // match the server's.
  const jump = useCallback(() => setN(Math.floor(Math.random() * 1000)), [])

  return (
    <Stage
      controls={
        <>
          <Ctl onClick={down} label="Subtract seven">−7</Ctl>
          <Ctl onClick={up} label="Add seven">+7</Ctl>
          <Ctl onClick={jump}>Jump</Ctl>
        </>
      }
    >
      <p className="text-ink text-display tabular-nums">
        <SlotNumber value={n} pad={3} />
      </p>
    </Stage>
  )
})

// Per-glyph reveal in shuffled order. Remounting on the key is what replays
// it — the reveal is a CSS animation, so a fresh element is a fresh run.
const GLITCH_WORDS = ['assemble', 'shuffle', 'scatter']

const GlitchDemo = memo(function GlitchDemo() {
  const [i, setI] = useState(0)
  const again = useCallback(() => setI((n) => n + 1), [])

  return (
    <Stage controls={<Ctl onClick={again}>Run it again</Ctl>}>
      <p className="text-ink text-title-lg md:text-title-xl text-center">
        <GlitchText key={i} text={GLITCH_WORDS[i % GLITCH_WORDS.length]} />
      </p>
    </Stage>
  )
})

// The real audio player off the writing — a genuine <audio> element, the
// shared waveform, and scrubbing that pauses and resumes around the drag.
// `[&>figure]:my-0` drops the article margin it carries for a column of prose.
const AudioDemo = memo(function AudioDemo() {
  return (
    <div className="w-full [&>figure]:my-0">
      <Audio src="/blog/audio/friday-beat.wav" title="Friday beat" />
    </div>
  )
})

const FAN_IMAGES = [
  '/blog/images/denny-mnul60jh.jpg',
  '/blog/images/denny-mnulcu22.jpg',
  '/blog/images/denny-mnulfxgx.jpg',
]

// Hover it on a pointer; on a touch screen the same markup lays itself out
// as a permanent spread, which is the component's own media query, not a
// special case for this page.
const FanDemo = memo(function FanDemo() {
  return (
    <Stage>
      <div className="flex min-h-32 items-center justify-center">
        <ImageFan images={FAN_IMAGES} />
      </div>
    </Stage>
  )
})

const MaskDemo = memo(function MaskDemo() {
  return (
    <Stage>
      <div className="text-title-sm text-ink flex w-full flex-col items-start gap-2">
        <LinkMask href="/covers" text="Top songs" />
        <LinkMask href="/tuner" text="Tuner" />
        <LinkMask href="/tierlist" text="Tier lists" />
      </div>
    </Stage>
  )
})

const BadgeRow = memo(function BadgeRow() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge color="blue">React</Badge>
      <Badge color="green">WebGL</Badge>
      <Badge>Next.js</Badge>
      <Badge color="amber">Motion</Badge>
      <Badge color="red">Shaders</Badge>
    </div>
  )
})

const CalloutDemo = memo(function CalloutDemo() {
  return (
    <Callout type="note" title="Note">
      Every tile on this page is the real component, mounted live — not a
      screenshot of one.
    </Callout>
  )
})

const QuoteDemo = memo(function QuoteDemo() {
  return (
    <Quote author="Herb">
      Build the thing, then build the thing that edits the thing.
    </Quote>
  )
})

const LeadDemo = memo(function LeadDemo() {
  return (
    <Lead>
      A running set of interface parts — some shipped, some still arguing with
      themselves.
    </Lead>
  )
})

const ButtonDemo = memo(function ButtonDemo() {
  return (
    <div className="flex flex-wrap gap-2">
      <LinkButton href="/blog">Read the writing</LinkButton>
      <LinkButton href="/covers" variant="secondary">
        Top songs
      </LinkButton>
    </div>
  )
})

const DividerDemo = memo(function DividerDemo() {
  return <Divider label="Interlude" />
})

// The reference heavy tile: framer-motion layout animation, a spring per
// track, a ResizeObserver of its own. It is code-split (its own chunk, off
// the first load) and marked heavy below, so it is built when you approach
// it and thrown away once you are well past.
const AlbumDemo = dynamic(() => import('@/app/experiments/components/AlbumCard'), {
  ssr: false,
  loading: () => null,
})

/* ── mono-volt ─────────────────────────────────────────────────────────
 * CrowdVolt's own interface, ported out of mono-volt/apps/web and shown as
 * ITSELF: its dark surface, its orange, its Inter, its radii — see
 * ./monovolt/tokens.css, where the real token values live scoped to
 * `.mv-scope` so they cannot leak into this site.
 *
 * All five are heavy by the registry's own definition — orbiting lights on
 * an offset-path, a morph timer, rAF pointer easing — so all five are
 * code-split and released when they scroll far away.
 * ─────────────────────────────────────────────────────────────────── */
/* Code-split AND client-only, deliberately.
 *
 * Server-rendering these looked like the right call — a box at the correct
 * height from the first paint — but a lazily-imported component's CSS MODULE
 * is loaded lazily too, so the markup lands in the HTML before its stylesheet
 * does and paints unstyled for a beat (vercel/next.js#77239). On a set of dark
 * panels that beat is a flash of raw, unpainted boxes.
 *
 * `ssr: false` means nothing renders until the chunk — JS and CSS together —
 * has arrived, so there is no unstyled window at all. The height gap that
 * pushed me to SSR in the first place no longer matters: the cell is invisible
 * until the grid releases it, and the grid does not release it until the
 * component is mounted and settled. Nothing you can see ever moves. */
const mv = (loader) => dynamic(loader, { ssr: false, loading: () => null })

const MvSearchBar = mv(() => import('./monovolt/MagicSearchBar'))
const MvHero = mv(() => import('./monovolt/HeroMorph'))
const MvCard = mv(() => import('./monovolt/EventCard'))
const MvStickers = mv(() => import('./monovolt/Stickers'))
const MvHome = mv(() => import('./monovolt/HomeSnippet'))
const MvSite = mv(() => import('./monovolt/SiteLink'))
const MvNav = mv(() => import('./monovolt/NavHover'))
const MvVinyl = mv(() => import('./monovolt/VinylCarousel'))
const MvBadges = mv(() => import('./monovolt/ShimmerBadges'))
const MvSignup = mv(() => import('./monovolt/SignupModal'))

const MvSearchTile = memo(function MvSearchTile() {
  return (
    <MvScope>
      <MvSearchBar />
    </MvScope>
  )
})

const MvHeroTile = memo(function MvHeroTile() {
  return (
    <MvScope>
      <MvHero />
    </MvScope>
  )
})

const MvCardTile = memo(function MvCardTile() {
  return (
    <MvScope>
      <MvCard />
    </MvScope>
  )
})

const MvStickersTile = memo(function MvStickersTile() {
  return (
    <MvScope>
      <MvStickers />
    </MvScope>
  )
})

const MvHomeTile = memo(function MvHomeTile() {
  return (
    <MvScope>
      <MvHome />
    </MvScope>
  )
})

const MvNavTile = memo(function MvNavTile() {
  return (
    <MvScope>
      <MvNav />
    </MvScope>
  )
})

const MvSignupTile = memo(function MvSignupTile() {
  return (
    <MvScope>
      <MvSignup />
    </MvScope>
  )
})

const MvBadgesTile = memo(function MvBadgesTile() {
  return (
    <MvScope>
      <MvBadges />
    </MvScope>
  )
})

const MvVinylTile = memo(function MvVinylTile() {
  return (
    <MvScope>
      <MvVinyl />
    </MvScope>
  )
})

const MvSiteTile = memo(function MvSiteTile() {
  return (
    <MvScope>
      <MvSite />
    </MvScope>
  )
})

/* ── The registry ──────────────────────────────────────────────────────
 * `Component` is a component TYPE, not a render function: the tile mounts
 * <entry.Component /> so React can keep the same instance across the grid's
 * re-measures instead of rebuilding the subtree every pass.
 * ─────────────────────────────────────────────────────────────────── */

export const REGISTRY = {
  'mv-search': {
    label: 'CrowdVolt search bar',
    note: '24 lights orbiting an offset-path, typewriter queries',
    padded: true,
    heavy: true,
    Component: MvSearchTile,
  },
  'mv-hero': {
    label: 'CrowdVolt hero',
    note: 'Width-morphing headline, shimmer reveal, hover image',
    padded: true,
    heavy: true,
    Component: MvHeroTile,
  },
  'mv-card': {
    label: 'CrowdVolt event card',
    note: 'Cover zoom, rainbow title, shimmering skeleton',
    padded: true,
    heavy: true,
    Component: MvCardTile,
  },
  'mv-stickers': {
    label: 'CrowdVolt stickers',
    note: 'Draggable holographic foil masked to the artwork',
    padded: false,
    heavy: true,
    Component: MvStickersTile,
  },
  'mv-home': {
    label: 'CrowdVolt homepage',
    note: 'A slice of the real shelf, on the real tokens',
    padded: false,
    heavy: true,
    Component: MvHomeTile,
  },
  'mv-nav': {
    label: 'CrowdVolt nav',
    note: 'The bar grows into a single sheet of frosted glass',
    padded: false,
    heavy: true,
    Component: MvNavTile,
  },
  'mv-signup': {
    label: 'CrowdVolt sign-up',
    note: 'Three steps, the panel morphing height between them',
    padded: false,
    heavy: true,
    Component: MvSignupTile,
  },
  'mv-badges': {
    label: 'CrowdVolt badges',
    note: 'A band swept across the hairline and the label at once',
    padded: true,
    heavy: true,
    Component: MvBadgesTile,
  },
  'mv-vinyl': {
    label: 'CrowdVolt vinyl',
    note: 'A ring of records; the one out front spins and slides its sleeve',
    padded: false,
    heavy: true,
    Component: MvVinylTile,
  },
  'mv-site': {
    label: 'CrowdVolt — the site',
    note: 'Square door to the real thing',
    padded: false,
    heavy: false,
    Component: MvSiteTile,
  },
  'album-card': {
    label: 'Album card',
    note: 'Expanding tracklist, shared-layout motion',
    padded: false,
    heavy: true,
    Component: AlbumDemo,
  },
  audio: {
    label: 'Audio player',
    note: 'Real <audio>, scrub-to-seek with resume',
    padded: true,
    // Never released: unmounting this would stop whatever is playing the
    // moment it scrolled off, which is exactly the wrong behaviour for a
    // player. A paused <audio> element costs nothing to leave mounted.
    heavy: false,
    Component: AudioDemo,
  },
  waveform: {
    label: 'Waveform',
    note: 'Scrubbable peaks with rubber-band overscroll',
    padded: true,
    Component: WaveformDemo,
  },
  'play-pause': {
    label: 'Play / pause icon',
    note: 'Two paths morphing, blur pulse on toggle',
    padded: true,
    Component: PlayPauseDemo,
  },
  'morph-text': {
    label: 'Morph text',
    note: 'Shared letters slide, the rest crossfades',
    padded: true,
    Component: MorphDemo,
  },
  'slot-number': {
    label: 'Slot number',
    note: 'Odometer digits, one transform per column',
    padded: true,
    Component: SlotDemo,
  },
  'glitch-text': {
    label: 'Glitch title',
    note: 'Per-glyph reveal in shuffled order',
    padded: true,
    Component: GlitchDemo,
  },
  'image-fan': {
    label: 'Image fan',
    note: 'Polaroid stack that spreads on hover',
    padded: true,
    Component: FanDemo,
  },
  'link-mask': {
    label: 'Link mask',
    note: 'Masked label swap on hover',
    padded: true,
    Component: MaskDemo,
  },
  callout: {
    label: 'Callout',
    note: 'Writing primitive',
    padded: true,
    Component: CalloutDemo,
  },
  quote: {
    label: 'Quote',
    note: 'Writing primitive',
    padded: true,
    Component: QuoteDemo,
  },
  lead: {
    label: 'Lead paragraph',
    note: 'Writing primitive',
    padded: true,
    Component: LeadDemo,
  },
  badges: {
    label: 'Badges',
    note: 'Writing primitive',
    padded: true,
    Component: BadgeRow,
  },
  'link-button': {
    label: 'Link button',
    note: 'Writing primitive',
    padded: true,
    Component: ButtonDemo,
  },
  divider: {
    label: 'Divider',
    note: 'Writing primitive',
    padded: true,
    Component: DividerDemo,
  },
}

export const REGISTRY_KEYS = Object.keys(REGISTRY)

export function getEntry(key) {
  return REGISTRY[key] || null
}
