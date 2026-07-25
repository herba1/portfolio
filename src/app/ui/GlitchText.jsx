// Per-character title reveal shared by the index pages (Writing, Tier Lists).
// Each glyph starts small and transparent, then snaps to full size on its own
// delay — and the delays are shuffled, so the word assembles out of order
// rather than left-to-right. The look itself lives in `.blog-ch` / @keyframes
// ch-glitch-in in globals.css; this only picks the per-glyph delay + rotation.
//
// Deterministic on purpose: the same text always yields the same order, so the
// server and client render byte-identical markup (no hydration mismatch) and a
// title never reshuffles between visits.

function seeded(i) {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

// Fisher–Yates against the fixed seed above: order[i] is the *position in the
// reveal sequence* of the i-th glyph, so the delays scatter instead of ramping.
function shuffledOrder(count) {
  const indices = Array.from({ length: count }, (_, i) => i)
  for (let i = count - 1; i > 0; i--) {
    const j = Math.floor(seeded(i + 999) * (i + 1))
    ;[indices[i], indices[j]] = [indices[j], indices[i]]
  }
  const order = new Array(count)
  for (let i = 0; i < count; i++) order[indices[i]] = i
  return order
}

export default function GlitchText({ text, baseDelay = 0.15 }) {
  const chars = [...text]
  // Spaces hold width but never animate, so they're excluded from the ordering.
  const order = shuffledOrder(chars.filter((c) => c !== ' ').length)
  let ci = 0

  return (
    <>
      {chars.map((ch, i) => {
        if (ch === ' ') return <span key={i} className="blog-ch-space" />
        const idx = ci++
        return (
          <span
            key={i}
            className="blog-ch"
            style={{
              '--ch-d': `${(baseDelay + order[idx] * 0.04).toFixed(3)}s`,
              '--ch-r': (seeded(idx) * 16 - 8).toFixed(1),
            }}
          >
            {ch}
          </span>
        )
      })}
    </>
  )
}
