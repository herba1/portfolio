'use client'

import { useState } from 'react'

import AlbumCard from '@/app/experiments/components/AlbumCard'
import Waveform from '@/app/ui/Waveform'
import PlayPauseIcon from '@/app/ui/PlayPauseIcon'
import GlitchText from '@/app/ui/GlitchText'
import ImageFan from '@/app/ui/ImageFan'
import LinkMask from '@/app/ui/LinkMask'
import { Callout } from '@/app/(blog)/components/Callout'
import { Quote } from '@/app/(blog)/components/Quote'
import { Badge } from '@/app/(blog)/components/Badge'
import { LinkButton } from '@/app/(blog)/components/LinkButton'
import { Divider } from '@/app/(blog)/components/Divider'
import { Lead } from '@/app/(blog)/components/Lead'

/* ─────────────────────────────────────────────────────────────
 * The component registry — the only place a tile can source a live
 * component from. Everything here must render with NO props and no
 * surrounding context beyond what the root layout already provides,
 * because the grid mounts it blind from a string key in work.json.
 *
 * Adding one: build the zero-prop demo wrapper here, give it a stable
 * key, and it appears in the studio's component picker automatically.
 * ───────────────────────────────────────────────────────────── */

// Deterministic peaks so the waveform looks like real audio and renders
// identically on every visit (no Math.random → no hydration drift).
const PEAKS = Array.from({ length: 48 }, (_, i) => {
  const a = Math.sin(i * 0.7) * 0.5 + 0.5
  const b = Math.sin(i * 2.3 + 1.1) * 0.5 + 0.5
  return 0.14 + (a * 0.6 + b * 0.4) * 0.8
})

function WaveformDemo() {
  const [progress, setProgress] = useState(22)
  return (
    <div className="flex flex-col gap-3">
      <Waveform
        peaks={PEAKS}
        progress={progress}
        duration={60}
        onSeek={setProgress}
        height={64}
      />
      <p className="text-ink-secondary text-ui-lg tabular-nums">
        Drag past either edge — the bars splay apart and spring back.
      </p>
    </div>
  )
}

function PlayPauseDemo() {
  const [playing, setPlaying] = useState(false)
  return (
    <button
      onClick={() => setPlaying((p) => !p)}
      className="text-ink flex w-full items-center gap-4"
      aria-label={playing ? 'Pause' : 'Play'}
    >
      <span className="bg-surface-sunken squircle flex size-14 items-center justify-center">
        <PlayPauseIcon playing={playing} size={22} />
      </span>
      <span className="text-ui-lg text-ink-secondary">
        {playing ? 'Playing' : 'Tap to play'}
      </span>
    </button>
  )
}

function BadgeRow() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge color="blue">React</Badge>
      <Badge color="green">WebGL</Badge>
      <Badge>Next.js</Badge>
      <Badge color="amber">Motion</Badge>
      <Badge color="red">Shaders</Badge>
    </div>
  )
}

function FanDemo() {
  return (
    <div className="flex min-h-32 items-center justify-center">
      <ImageFan
        images={[
          '/blog/images/denny-mnul60jh.jpg',
          '/blog/images/denny-mnulcu22.jpg',
          '/blog/images/denny-mnulfxgx.jpg',
        ]}
      />
    </div>
  )
}

function MaskDemo() {
  return (
    <div className="text-title-sm text-ink flex flex-col items-start gap-2">
      <LinkMask href="/covers" text="Top songs" />
      <LinkMask href="/tuner" text="Tuner" />
      <LinkMask href="/tierlist" text="Tier lists" />
    </div>
  )
}

function TitleDemo() {
  return (
    <p className="text-ink text-title-lg md:text-title-xl">
      <GlitchText text="assemble" />
    </p>
  )
}

export const REGISTRY = {
  'album-card': {
    label: 'Album card',
    note: 'Expanding tracklist, shared-layout motion',
    defaultSpan: 1,
    padded: false,
    render: () => <AlbumCard />,
  },
  waveform: {
    label: 'Waveform',
    note: 'Scrubbable peaks with rubber-band overscroll',
    defaultSpan: 2,
    render: () => <WaveformDemo />,
  },
  'play-pause': {
    label: 'Play / pause icon',
    note: 'Two paths morphing, blur pulse on toggle',
    defaultSpan: 1,
    render: () => <PlayPauseDemo />,
  },
  'glitch-text': {
    label: 'Glitch title',
    note: 'Per-glyph reveal in shuffled order',
    defaultSpan: 1,
    render: () => <TitleDemo />,
  },
  'image-fan': {
    label: 'Image fan',
    note: 'Polaroid stack that spreads on hover',
    defaultSpan: 1,
    render: () => <FanDemo />,
  },
  'link-mask': {
    label: 'Link mask',
    note: 'Masked label swap on hover',
    defaultSpan: 1,
    render: () => <MaskDemo />,
  },
  callout: {
    label: 'Callout',
    note: 'Writing primitive',
    defaultSpan: 1,
    render: () => (
      <Callout type="note" title="Note">
        Every tile on this page is the real component, mounted live — not a
        screenshot of one.
      </Callout>
    ),
  },
  quote: {
    label: 'Quote',
    note: 'Writing primitive',
    defaultSpan: 1,
    render: () => (
      <Quote author="Herb">
        Build the thing, then build the thing that edits the thing.
      </Quote>
    ),
  },
  lead: {
    label: 'Lead paragraph',
    note: 'Writing primitive',
    defaultSpan: 2,
    render: () => (
      <Lead>
        A running set of interface parts — some shipped, some still arguing with
        themselves.
      </Lead>
    ),
  },
  badges: {
    label: 'Badges',
    note: 'Writing primitive',
    defaultSpan: 1,
    render: () => <BadgeRow />,
  },
  'link-button': {
    label: 'Link button',
    note: 'Writing primitive',
    defaultSpan: 1,
    render: () => (
      <div className="flex flex-wrap gap-2">
        <LinkButton href="/blog">Read the writing</LinkButton>
        <LinkButton href="/covers" variant="secondary">
          Top songs
        </LinkButton>
      </div>
    ),
  },
  divider: {
    label: 'Divider',
    note: 'Writing primitive',
    defaultSpan: 3,
    render: () => <Divider label="Interlude" />,
  },
}

export const REGISTRY_KEYS = Object.keys(REGISTRY)

export function getEntry(key) {
  return REGISTRY[key] || null
}
