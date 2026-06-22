// A small stack of a post's images that fans out (polaroid-style) when the
// blog row is hovered — mirrors the tier-list index interaction. Transforms
// are set inline per index (--rest stacked, --hov fanned); the hover state is
// driven by the parent `.group` (the post link).
//
// Desktop (sm+): rests stacked, fans on row hover.
// Mobile: no hover, so the images render in a permanent side-by-side spread
// (slightly overlapping + rotated) — see the max-width media query in
// globals.css, which keys off the `--off` offset set inline below.
export default function BlogImageFan({ images }) {
  const pics = (images || []).filter(Boolean).slice(0, 3)
  if (!pics.length) return null
  const mid = (pics.length - 1) / 2
  return (
    <div className="blog-pol-stack shrink-0 self-center">
      {pics.map((src, i) => {
        const off = i - mid
        const style = {
          '--off': off,
          '--rest': `rotate(${off * 5}deg)`,
          '--hov': `rotate(${off * 15}deg) translate(${off * 26}px, ${-9 - (mid - Math.abs(off)) * 3}px)`,
          '--d': `${i * 35}ms`,
          zIndex: 10 - Math.abs(off),
        }
        return (
          <div key={i} className="blog-pol squircle-sm" style={style}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt="" />
          </div>
        )
      })}
    </div>
  )
}
