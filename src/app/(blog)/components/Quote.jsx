import { spencer } from '@/app/fonts'

export function Quote({ children, author, source }) {
  return (
    <figure className="my-10">
      <div className="blog-quote-border border-l-2 border-dark/15 pl-6">
        <blockquote
          className={`blog-quote-text text-dark text-2xl leading-snug md:text-3xl ${spencer.className}`}
        >
          {children}
        </blockquote>
        {(author || source) && (
          <figcaption className="blog-quote-text text-dark/50 mt-3 text-sm tracking-wide uppercase">
            {author}
            {source && (
              <cite className="text-dark/40 not-italic">
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
