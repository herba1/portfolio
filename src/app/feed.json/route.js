import { posts } from "@/app/(blog)/posts"
import { author, description, siteUrl, title } from "@/app/constants"
import { absoluteUrl } from "@/lib/seo"

// JSON Feed 1.1 — the same posts as /feed.xml, for readers and agents that
// would rather not parse XML.
export const dynamic = "force-static"

export function GET() {
  const items = posts
    .filter((p) => p.published)
    .sort((a, b) => new Date(b.date) - new Date(a.date))

  const feed = {
    version: "https://jsonfeed.org/version/1.1",
    title: `${title} — writing`,
    home_page_url: `${siteUrl}/blog`,
    feed_url: `${siteUrl}/feed.json`,
    description,
    icon: `${siteUrl}/icon-512.png`,
    favicon: `${siteUrl}/icon-192.png`,
    language: "en-US",
    authors: [{ name: author, url: siteUrl }],
    items: items.map((p) => ({
      id: absoluteUrl(`/${p.slug}`),
      url: absoluteUrl(`/${p.slug}`),
      title: p.title,
      // The spec requires content_html or content_text on every item; the
      // posts' full bodies are MDX with components, so the summary stands in.
      content_text: p.description,
      summary: p.description,
      date_published: new Date(p.date).toISOString(),
      ...(p.updated ? { date_modified: new Date(p.updated).toISOString() } : {}),
      ...(p.tags && p.tags.length ? { tags: p.tags } : {}),
      ...(p.images && p.images[0] ? { image: absoluteUrl(p.images[0]) } : {}),
    })),
  }

  return Response.json(feed, {
    headers: {
      "Content-Type": "application/feed+json; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
    },
  })
}
