import { ViewTransition } from 'react'

// The little stack of thumbs on an index row that fans out like polaroids when
// the row is hovered. Shared by Writing (a post's images) and Tier Lists (a
// list's first items) so both indexes read as one page family. Styling lives in
// `.pol-stack` / `.pol` in globals.css; the per-thumb transforms are passed in
// as custom properties because they depend on the thumb's offset from centre.
//
// Mobile has no hover, so a media query re-lays the same markup out as a
// permanent side-by-side spread, keyed off `--off`.
//
// `images` takes either bare `src` strings or `{ src, id }` objects.
const MAX = 3

export default function ImageFan({ images, sharePrefix }) {
  const pics = (images || [])
    .map((p) => (typeof p === 'string' ? { src: p } : p))
    .filter((p) => p?.src)
    .slice(0, MAX)
  if (!pics.length) return null

  const mid = (pics.length - 1) / 2

  return (
    <div className="pol-stack shrink-0 self-center">
      {pics.map(({ src, id }, i) => {
        const off = i - mid
        const thumb = (
          <div
            key={id ?? i}
            className="pol squircle-sm"
            style={{
              '--off': off,
              '--rest': `rotate(${off * 5}deg)`,
              '--hov': `rotate(${off * 15}deg) translate(${off * 26}px, ${-9 - (mid - Math.abs(off)) * 3}px)`,
              '--d': `${i * 35}ms`,
              // Ascending, so the last thumb sits on top. View-transition groups
              // paint in DOM order (last on top), so matching the resting stack
              // to that order means nothing re-stacks when a morph overlay lifts.
              zIndex: i,
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt="" />
          </div>
        )

        // Shared-element morph (tier list only): this thumb and the matching
        // tile in the tier grid carry the same name, so the browser flies one
        // into the other across the navigation.
        //
        // The name is handed to React rather than written as an inline
        // `view-transition-name`, and that difference is the whole point.
        // React only applies the name during a transition where BOTH ends are
        // present — `share` names the paired case, and `enter`/`exit`/`update`
        // are "none" so every other navigation leaves the element unnamed. An
        // always-on inline name would lift these thumbs out of the page
        // snapshot on *every* nav (index → home, or the other lists' thumbs on
        // the way into one list) and cross-fade them on the browser's default
        // timing, detached from the page sliding underneath them.
        if (!sharePrefix || !id) return thumb

        return (
          <ViewTransition
            key={id}
            name={`${sharePrefix}${id}`}
            share="tl-share"
            enter="none"
            exit="none"
            update="none"
          >
            {thumb}
          </ViewTransition>
        )
      })}
    </div>
  )
}
