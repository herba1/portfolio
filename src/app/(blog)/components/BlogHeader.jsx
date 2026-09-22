import TransitionLink from '@/app/ui/TransitionLink'
import { ArrowLeft } from 'lucide-react'
import { posts } from '../posts'
import { absoluteUrl } from '@/lib/urls'
import { ID, JsonLd, SITE_IMAGE, breadcrumbNode, graph, personRef } from '@/lib/jsonld'

// Dates in the registry are calendar days; render them as such, in UTC, so
// the visible date, the <time> attribute and the JSON-LD agree on every
// server and machine. A US-timezone build would otherwise show the day before.
const formatDay = (date) =>
  new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  })

function seeded(i) {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

// shuffle an array of indices deterministically
function shuffledOrder(count) {
  const indices = Array.from({ length: count }, (_, i) => i)
  for (let i = count - 1; i > 0; i--) {
    const j = Math.floor(seeded(i + 999) * (i + 1))
    ;[indices[i], indices[j]] = [indices[j], indices[i]]
  }
  // map original index → its position in the shuffled order
  const order = new Array(count)
  for (let i = 0; i < count; i++) {
    order[indices[i]] = i
  }
  return order
}

export default function BlogHeader({ slug, ...props }) {
  // The registry entry is the source of truth; props only fill in for a post
  // that isn't registered yet (the studio's draft template). Matched by slug
  // when passed, else by title.
  const post = posts.find((p) => (slug ? p.slug === slug : p.title === props.title))
  const title = post?.title || props.title
  const date = post?.date || props.date
  const tags = post?.tags || props.tags
  const summary = post?.description || props.description

  const chars = [...title]
  const nonSpaceCount = chars.filter((c) => c !== ' ').length
  const order = shuffledOrder(nonSpaceCount)
  let ci = 0

  const url = post ? absoluteUrl(`/${post.slug}`) : null
  const images = (post?.images || []).map(absoluteUrl)
  const published = new Date(date).toISOString()
  const modified = post?.updated ? new Date(post.updated).toISOString() : published

  // BlogPosting structured data so search engines can render rich article
  // results (headline, publish date, author, keywords) for every post, and a
  // breadcrumb trail so the post is placed under Writing.
  const articleLd = graph(
    {
      '@type': 'BlogPosting',
      ...(url ? { '@id': `${url}#article`, url, mainEntityOfPage: { '@type': 'WebPage', '@id': url } } : {}),
      headline: title,
      ...(summary ? { description: summary } : {}),
      datePublished: published,
      dateModified: modified,
      image: images.length ? images : [SITE_IMAGE],
      inLanguage: 'en-US',
      ...(tags && tags.length ? { keywords: tags.join(', ') } : {}),
      author: personRef(),
      publisher: { '@id': ID.person },
      isPartOf: { '@id': ID.blog },
    },
    post
      ? breadcrumbNode([
          { name: 'herb.art', path: '/' },
          { name: 'Writing', path: '/blog' },
          { name: title, path: `/${post.slug}` },
        ])
      : null,
  )

  return (
    <header className="mb-10">
      <JsonLd data={articleLd} />
      <TransitionLink
        href="/blog"
        className="blog-header-back text-ink-secondary hover:text-ink text-ui-lg mb-6 inline-flex items-center gap-1.5 transition-colors"
      >
        <ArrowLeft size={14} />
        Back to writing
      </TransitionLink>
      <time dateTime={date} className="blog-header-date text-ink-secondary text-ui-lg block">
        {formatDay(date)}
        {post?.updated && post.updated !== date ? (
          <>
            {' · updated '}
            <time dateTime={post.updated}>{formatDay(post.updated)}</time>
          </>
        ) : null}
      </time>
      {/* One step below the index title (which is title-sm), so a
          post reads as sitting inside the section rather than beside it. */}
      <h1 className="text-ink text-heading mt-2">
        {chars.map((ch, i) => {
          if (ch === ' ') {
            return <span key={i} className="blog-ch-space">{' '}</span>
          }
          const idx = ci++
          const r = seeded(idx) * 16 - 8
          const ox = seeded(idx + 30) * 100
          const oy = seeded(idx + 60) > 0.5 ? 100 : 0
          const delay = 0.15 + order[idx] * 0.04
          return (
            <span
              key={i}
              className="blog-ch"
              style={{
                '--ch-d': `${delay.toFixed(3)}s`,
                '--ch-r': r.toFixed(1),
                '--ch-ox': ox.toFixed(0),
                '--ch-oy': oy,
              }}
            >
              {ch}
            </span>
          )
        })}
      </h1>
      {tags && (
        <div className="blog-header-tags mt-4 flex gap-2">
          {tags.map((tag) => (
            <span key={tag} className="badge">
              {tag}
            </span>
          ))}
        </div>
      )}
    </header>
  )
}
