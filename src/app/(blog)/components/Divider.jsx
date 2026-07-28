export function Divider({ label }) {
  if (label) {
    return (
      <div className="my-12 flex items-center gap-4">
        <div className="blog-divider-line bg-line h-px flex-1 origin-left" />
        {/* Sentence case on the scale — not an uppercase, letter-spaced
            micro-label. */}
        <span className="text-ink-secondary text-ui font-mono">{label}</span>
        <div className="blog-divider-line bg-line h-px flex-1 origin-right" />
      </div>
    )
  }
  return (
    <hr className="blog-divider-line bg-line my-12 h-px origin-center border-0" />
  )
}
