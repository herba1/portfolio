import { posts } from './(blog)/posts'
import { siteUrl } from './constants'
import { EXPERIMENTS } from './experiments/list'
import { listTierlists } from './tierlist/lib'
import { absoluteUrl } from '@/lib/seo'
import { lastModified } from '@/lib/lastModified'

// Every indexable route, with a real <lastmod> (from git, see lib/lastModified)
// and the images each page is about, so image search sees them too.
//
// Deliberately absent: dev-gated routes (/work, /lab, /taste, /arcs, /~studio —
// they 404 in production), the tier-list editor, the unpublished /test post,
// and the unfinished /intro, /isolate and /ask-me-why pages, which carry
// noindex until they are ready for the nav.
export default async function sitemap() {
  const published = posts
    .filter((post) => post.published)
    .sort((a, b) => new Date(b.date) - new Date(a.date))

  const blogEntries = published.map((post) => ({
    url: absoluteUrl(`/${post.slug}`),
    lastModified: lastModified(`src/app/(blog)/${post.slug}/page.mdx`, post.date),
    changeFrequency: 'monthly',
    priority: 0.7,
    images: (post.images || []).map(absoluteUrl),
  }))

  const experimentEntries = EXPERIMENTS.map((experiment) => ({
    url: absoluteUrl(experiment.slug),
    lastModified: lastModified(`src/app${experiment.slug}`),
    changeFrequency: 'monthly',
    priority: 0.7,
  }))

  const lists = await listTierlists()
  const tierlistEntries = lists.map((list) => ({
    url: absoluteUrl(`/tierlist/${list.slug}`),
    lastModified: lastModified(`src/app/tierlist/data/${list.slug}.json`),
    changeFrequency: 'monthly',
    priority: 0.5,
    images: list.covers.map((c) => absoluteUrl(c.src)),
  }))

  return [
    {
      url: siteUrl,
      lastModified: lastModified([
        'src/app/page.js',
        'src/app/ui/Hero/TempPage.jsx',
        'src/app/ui/HomeIntro.jsx',
        'src/app/layout.js',
      ]),
      changeFrequency: 'weekly',
      priority: 1,
      images: [`${siteUrl}/opengraph-image.png`],
    },
    {
      url: absoluteUrl('/bio'),
      lastModified: lastModified('src/app/bio/page.js'),
      changeFrequency: 'monthly',
      priority: 0.9,
    },
    {
      url: absoluteUrl('/experiments'),
      lastModified: lastModified(['src/app/experiments/list.js', 'src/app/experiments/page.js']),
      changeFrequency: 'monthly',
      priority: 0.8,
    },
    ...experimentEntries,
    {
      url: absoluteUrl('/blog'),
      lastModified: lastModified(['src/app/(blog)/posts.js', 'src/app/blog/page.jsx']),
      changeFrequency: 'weekly',
      priority: 0.8,
    },
    ...blogEntries,
    {
      url: absoluteUrl('/tierlist'),
      lastModified: lastModified(['src/app/tierlist/data', 'src/app/tierlist/page.js']),
      changeFrequency: 'monthly',
      priority: 0.6,
    },
    ...tierlistEntries,
    {
      url: absoluteUrl('/covers'),
      lastModified: lastModified('src/app/covers'),
      changeFrequency: 'weekly',
      priority: 0.6,
    },
  ]
}
