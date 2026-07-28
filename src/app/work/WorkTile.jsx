'use client'

import Image from 'next/image'
import Link from 'next/link'
import { getEntry } from './registry'

/* ─────────────────────────────────────────────────────────────
 * One tile. Four shapes behind one caption block, so the grid reads
 * as one page rather than four widgets bolted together:
 *
 *   image / video — a framed aspect box
 *   component     — the live component, framed and padded
 *   note          — no frame at all; the type IS the tile
 *
 * `inert` is what the studio passes: it kills links and freezes the
 * live component so a click selects the tile instead of triggering it.
 * ───────────────────────────────────────────────────────────── */

// A component sizes itself, so its box is `auto`. A still or a clip has to
// declare a box up front or the masonry reflows the moment it decodes.
function boxRatio(item) {
  if (item.ratio && item.ratio !== 'auto') return item.ratio
  return item.kind === 'component' || item.kind === 'note' ? null : '4/3'
}

function sizesFor(span) {
  const w = Math.round((span / 3) * 100)
  return `(max-width: 560px) 100vw, (max-width: 940px) 50vw, ${w}vw`
}

function MissingComponent({ name }) {
  return (
    <div className="text-ink-secondary text-ui-lg flex min-h-24 items-center justify-center text-center">
      {name ? `No component registered as “${name}”` : 'Pick a component'}
    </div>
  )
}

function TileBody({ item }) {
  const ratio = boxRatio(item)

  if (item.kind === 'component') {
    const entry = getEntry(item.component)
    return entry ? entry.render() : <MissingComponent name={item.component} />
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
        sizes={sizesFor(item.span)}
        className="object-center"
        style={{ objectFit: item.fit }}
      />
    </div>
  )
}

export default function WorkTile({ item, inert = false, selected = false }) {
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
        background:
          item.background ||
          (framed ? 'var(--color-surface-raised)' : 'transparent'),
      }}
    >
      <div className={inert && item.kind === 'component' ? 'pointer-events-none' : ''}>
        <TileBody item={item} />
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
