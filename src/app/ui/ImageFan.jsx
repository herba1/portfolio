import Image from 'next/image'
import Shared from './transitions/Shared'

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
const THUMB_PX = 52

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
            {src.startsWith('/') ? (
              <Image src={src} alt="" width={THUMB_PX} height={THUMB_PX} sizes={`${THUMB_PX}px`} />
            ) : (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={src} alt="" loading="lazy" decoding="async" />
            )}
          </div>
        )

        if (!sharePrefix || !id) return thumb

        return (
          <Shared key={id} name={`${sharePrefix}${id}`} arc={0.12}>
            {thumb}
          </Shared>
        )
      })}
    </div>
  )
}
