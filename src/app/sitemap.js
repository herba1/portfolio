import { posts } from './(blog)/posts'
import { BIO_UPDATED, HOME_UPDATED, siteUrl } from './constants'
import { EXPERIMENTS } from './experiments/list'
import { listTierlists } from './tierlist/lib'
import { absoluteUrl } from '@/lib/urls'

// Every indexable route, with the images each page is about (so image search
// sees them too) and a <lastmod> that is hand-maintained where it lives:
// posts.js `date`/`updated`, experiments/list.js `date`/`updated`, the
// tier-list JSON `updated`, and HOME_UPDATED / BIO_UPDATED in constants.js.
// Never git (Vercel builds from a shallow clone, so old files would report
// the clone boundary, which moves on every push) and never the build date:
// a lastmod that only moves when the content moves is the one Google keeps
// trusting. No changefreq or priority — every engine ignores them.
//
// Deliberately absent: dev-gated routes (/work, /lab, /taste, /arcs, /~studio
// all 404 in production), the tier-list editor, the unpublished /test post
// and the unfinished /intro, /isolate, /ask-me-why and album-card pages,
// which carry noindex until they are ready for the nav.

const day = (s) => new Date(`${s}T00:00:00Z`)
const latest = (dates) => dates.reduce((a, b) => (b > a ? b : a))

export default async function sitemap() {
  const published = posts
    .filter((post) => post.published)
    .sort((a, b) => day(b.date) - day(a.date))

  const blogEntries = published.map((post) => ({
    url: absoluteUrl(`/${post.slug}`),
    lastModified: day(post.updated || post.date),
    images: (post.images || []).map(absoluteUrl),
  }))

  const experimentEntries = EXPERIMENTS.map((experiment) => ({
    url: absoluteUrl(experiment.slug),
    lastModified: day(experiment.updated || experiment.date),
  }))

  const lists = await listTierlists()
  const tierlistEntries = lists.map((list) => ({
    url: absoluteUrl(`/tierlist/${list.slug}`),
    lastModified: day(list.updated || BIO_UPDATED),
    images: list.covers.map((c) => absoluteUrl(c.src)),
  }))

  return [
    {
      url: siteUrl,
      lastModified: day(HOME_UPDATED),
      images: [`${siteUrl}/opengraph-image.png`],
    },
    {
      url: absoluteUrl('/bio'),
      lastModified: day(BIO_UPDATED),
    },
    {
      url: absoluteUrl('/experiments'),
      lastModified: latest(experimentEntries.map((e) => e.lastModified)),
    },
    ...experimentEntries,
    {
      url: absoluteUrl('/blog'),
      lastModified: latest(blogEntries.map((e) => e.lastModified)),
    },
    ...blogEntries,
    {
      url: absoluteUrl('/tierlist'),
      lastModified: latest(tierlistEntries.map((e) => e.lastModified)),
    },
    ...tierlistEntries,
    {
      url: absoluteUrl('/covers'),
      lastModified: day(HOME_UPDATED),
    },
  ]
}
