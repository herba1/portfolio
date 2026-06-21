import { spencer } from '@/app/fonts'
import TransitionLink from '@/app/ui/TransitionLink'
import { ArrowLeft } from 'lucide-react'

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

export default function BlogHeader({ title, date, tags, description }) {
  const chars = [...title]
  const nonSpaceCount = chars.filter((c) => c !== ' ').length
  const order = shuffledOrder(nonSpaceCount)
  let ci = 0

  // BlogPosting structured data so search engines can render rich article
  // results (headline, publish date, author, keywords) for every post.
  const articleLd = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: title,
    ...(description ? { description } : {}),
    datePublished: new Date(date).toISOString(),
    dateModified: new Date(date).toISOString(),
    image: 'https://herb.art/opengraph-image.png',
    inLanguage: 'en-US',
    ...(tags && tags.length ? { keywords: tags.join(', ') } : {}),
    author: { '@id': 'https://herb.art/#person' },
    publisher: { '@id': 'https://herb.art/#person' },
  }

  return (
    <header className="mb-10">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleLd) }}
      />
      <TransitionLink
        href="/blog"
        className="blog-header-back tracking-body-base text-dark/50 hover:text-dark mb-6 inline-flex items-center gap-1 text-sm transition-colors"
      >
        <ArrowLeft size={14} />
        Back to writing
      </TransitionLink>
      <time className="blog-header-date tracking-body-base text-dark/50 block text-sm">
        {new Date(date).toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        })}
      </time>
      <h1
        className={`text-dark mt-2 text-4xl md:text-5xl ${spencer.className}`}
      >
        {chars.map((ch, i) => {
          if (ch === ' ') {
            return <span key={i} className="blog-ch-space" />
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
            <span
              key={tag}
              className="text-dark/50 bg-dark/5 rounded px-2 py-0.5 text-xs"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
    </header>
  )
}
