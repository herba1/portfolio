'use client'

import { memo } from 'react'

import './tokens.css'

/* ═══════════════════════════════════════════════════════════════════════════
 * A slice of the CrowdVolt homepage, ported from
 *   mono-volt/apps/web/app/components/core/home-explore/{ShelfRow,EventCard}.tsx
 *   mono-volt/apps/web/app/components/core/home-explore/tokens.css
 *
 * One section header and the shelf row under it. No carousel engine, no drag
 * physics, no data, no skeletons — this is a still life, here to show the design
 * language rather than the machinery: the near-black surface, the translucent
 * hairlines, the one reserved orange, the 0.75rem radius and their type scale.
 *
 * Every colour and radius below is a custom property off `.mv-scope` in
 * ./tokens.css, which carries CrowdVolt's real token values. Nothing is a
 * hardcoded hex — that is the whole point of the tile.
 *
 * What changed from the source, and why:
 *   - ShelfCarousel (loop + drift + drag physics, ~800 lines) is replaced by a
 *     native `overflow-x: auto` rail with scroll snapping. Same affordance, and
 *     it drags with the pointer and flicks on touch for free.
 *   - Cards are 224px rather than the source's 300px→26rem, so a full card plus
 *     the peek of the next one fits a 300px-wide grid tile.
 *   - Cards are <article>, not <Link>: nothing here navigates.
 *   - The "See all" affordance is new. Their real header carries a filter pill
 *     row in this slot, which needs state this snippet has no business holding;
 *     "See all" is the same idea (the row is a window onto more) in one control,
 *     and it is where the reserved accent lands.
 * ═══════════════════════════════════════════════════════════════════════════ */

const EVENTS = [
  {
    id: 'cosmos-midnight',
    cover: '/monovolt/cosmos-midnight.webp',
    title: "Cosmo's Midnight",
    venue: 'Brooklyn Steel',
    price: '$38',
  },
  {
    id: 'lp-giobbi',
    cover: '/monovolt/lp-giobbi.webp',
    title: 'LP Giobbi',
    venue: 'Elsewhere · Zone One',
    price: '$45',
  },
  {
    id: 'louis-the-child',
    cover: '/monovolt/louis-the-child.webp',
    title: 'Louis The Child',
    venue: 'The Brooklyn Mirage',
    price: '$72',
  },
]

const HomeSnippetDemo = memo(function HomeSnippetDemo() {
  return (
    <section className="mv-scope snippet" aria-label="CrowdVolt homepage shelf">
      <header className="head">
        <h3 className="title">This weekend</h3>
        <button type="button" className="seeall">
          See all
          <span className="chev" aria-hidden>
            ›
          </span>
        </button>
      </header>

      {/* The rail bleeds to the panel edge on both sides (negative margin +
          matching padding), so a card can sit half off-screen the way it does on
          the real feed instead of stopping short at a gutter. */}
      <div className="shelf">
        {EVENTS.map((e) => (
          <article key={e.id} className="card">
            <div className="cover">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={e.cover} alt={e.title} loading="lazy" draggable={false} />
            </div>
            {/* Meta: event info left, width-hugging price right — the same
                side-price column the real card uses at every width. */}
            <div className="meta">
              <div className="info">
                <div className="name">{e.title}</div>
                <div className="venue">{e.venue}</div>
              </div>
              <div className="price">
                <span className="from">From</span>
                <span className="amount">{e.price}</span>
              </div>
            </div>
          </article>
        ))}
      </div>

      <style jsx>{`
        /* The tile hands this panel the full frame (its work.json entry is
           unpadded), so the padding lives here — which is also what lets the
           rail below bleed all the way to the tile's edge instead of stopping
           at a gutter inside a gutter. */
        .snippet {
          --pad: 16px;
          width: 100%;
          min-width: 0;
          padding: 18px var(--pad) 20px;
          border-radius: var(--explore-radius);
          background: var(--explore-bg);
          font-family: var(--mv-font);
          color: var(--explore-text);
        }

        /* ── Header ───────────────────────────────────────────────────────
           Their heading is set tight and gets tighter as it grows — 20px at
           -0.02em on the shelf, 30px at -1.8px on desktop. A tile lives at the
           small end of that, so it takes the small end of the ramp. */
        .head {
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          gap: 12px;
          padding-bottom: 12px;
          margin-bottom: 14px;
          border-bottom: 1px solid var(--explore-hairline);
        }
        .title {
          min-width: 0;
          margin: 0;
          font-size: 20px;
          line-height: 1.15;
          font-weight: 700;
          letter-spacing: -0.02em;
          color: var(--explore-text);
        }
        .seeall {
          display: inline-flex;
          flex-shrink: 0;
          align-items: center;
          gap: 4px;
          padding: 5px 10px;
          border: 1px solid var(--explore-hairline);
          border-radius: 9999px;
          background: transparent;
          font-family: inherit;
          font-size: 13px;
          line-height: 1.2;
          letter-spacing: -0.01em;
          color: var(--explore-text-muted);
          cursor: pointer;
          transition:
            color 0.2s ease-out,
            border-color 0.2s ease-out;
        }
        .chev {
          color: var(--explore-accent);
          font-size: 15px;
          line-height: 1;
          transition: transform 0.2s ease-out;
        }
        .seeall:hover {
          color: var(--explore-text);
          border-color: var(--explore-hairline-strong);
        }
        .seeall:hover .chev {
          transform: translateX(2px);
        }

        /* ── The rail ─────────────────────────────────────────────────────── */
        .shelf {
          display: flex;
          gap: 14px;
          margin-inline: calc(var(--pad) * -1);
          padding-inline: var(--pad);
          overflow-x: auto;
          overflow-y: hidden;
          overscroll-behavior-x: contain;
          scroll-snap-type: x proximity;
          -webkit-overflow-scrolling: touch;
          scrollbar-width: none;
        }
        .shelf::-webkit-scrollbar {
          display: none;
        }

        .card {
          flex: 0 0 auto;
          width: 224px;
          min-width: 0;
          scroll-snap-align: start;
        }

        /* clip-path alongside the radius is theirs: an overflow-hidden box with a
           scaling child leaves a hairline of image outside the corner in Safari,
           and the clip-path holds the round. */
        .cover {
          position: relative;
          aspect-ratio: 833 / 500;
          width: 100%;
          overflow: hidden;
          border-radius: var(--explore-radius);
          clip-path: inset(0 round var(--explore-radius));
          background: rgba(255, 255, 255, 0.06);
        }
        .cover img {
          display: block;
          width: 100%;
          height: 100%;
          object-fit: cover;
          transition: transform 0.3s ease-out;
        }
        @media (hover: hover) {
          .card:hover .cover img {
            transform: scale(1.02);
          }
        }

        .meta {
          display: flex;
          flex-direction: row;
          align-items: center;
          gap: 16px;
          margin-top: 12px;
        }
        .info {
          display: flex;
          min-width: 0;
          flex: 1 1 auto;
          flex-direction: column;
          gap: 2px;
        }
        .name {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-size: 17px;
          font-weight: 600;
          letter-spacing: -0.02em;
          color: var(--explore-text);
        }
        .venue {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-size: 13px;
          font-weight: 400;
          letter-spacing: -0.01em;
          color: var(--explore-text-muted);
        }
        .price {
          display: flex;
          flex-shrink: 0;
          flex-direction: column;
          align-items: flex-end;
          text-align: right;
          letter-spacing: -0.02em;
        }
        .from {
          font-size: 11px;
          font-weight: 500;
          line-height: 1;
          color: var(--explore-text-faint);
        }
        .amount {
          margin-top: 2px;
          font-size: 20px;
          font-weight: 600;
          line-height: 1;
          font-variant-numeric: tabular-nums;
          color: var(--explore-text);
        }

        @media (prefers-reduced-motion: reduce) {
          .cover img,
          .seeall,
          .chev {
            transition: none;
          }
          .card:hover .cover img {
            transform: none;
          }
        }
      `}</style>
    </section>
  )
})

export default HomeSnippetDemo
