export function Quote({ children, author, source }) {
  return (
    <figure className="my-10">
      <div className="blog-quote-border border-line-strong border-l-2 pl-6">
        {/* `text-body-lg` carries its own weight, tracking and leading
            straight off the scale. The old `text-2xl font-bold
            tracking-tight leading-snug` stack was four independent numbers,
            three of which had no idea what size they were rendering at. */}
        <blockquote className="blog-quote-text text-ink text-body-lg font-emphasis">
          {children}
        </blockquote>
        {(author || source) && (
          <figcaption className="blog-quote-text text-ink-secondary text-ui-lg mt-3">
            {author}
            {source && (
              <cite className="text-ink-tertiary not-italic">
                {author ? ' — ' : ''}
                {source}
              </cite>
            )}
          </figcaption>
        )}
      </div>
    </figure>
  )
}
