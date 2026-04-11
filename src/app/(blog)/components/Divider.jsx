export function Divider({ label }) {
  if (label) {
    return (
      <div className="my-12 flex items-center gap-4">
        <div className="blog-divider-line bg-dark/10 h-px flex-1 origin-left" />
        <span className="text-dark/30 font-mono text-xs tracking-widest uppercase">
          {label}
        </span>
        <div className="blog-divider-line bg-dark/10 h-px flex-1 origin-right" />
      </div>
    )
  }
  return (
    <hr className="blog-divider-line bg-dark/10 my-12 h-px origin-center border-0" />
  )
}
