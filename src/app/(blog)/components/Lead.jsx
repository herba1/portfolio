export function Lead({ children }) {
  /* The standfirst under a title. `text-body-lg` is the top reading step
     — 18px on 27px — so it holds the same ~1.5 leading as the prose it
     opens, just a size up. `leading-relaxed` is gone: the step already
     carries the right leading for its size. */
  return (
    <div className="text-ink-secondary text-body md:text-body-lg my-6">
      {children}
    </div>
  )
}
