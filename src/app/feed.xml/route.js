import { posts } from "@/app/(blog)/posts"
import { author, description, email, siteUrl, title } from "@/app/constants"
import { absoluteUrl } from "@/lib/seo"

// RSS 2.0 for the writing. Prerendered at build; the post registry is the
// only input, so it updates whenever a post is published.
export const dynamic = "force-static"

const esc = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")

const mime = (src) =>
  ({ webp: "image/webp", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif" })[
    src.split(".").pop().toLowerCase()
  ] || "image/jpeg"

export function GET() {
  const items = posts
    .filter((p) => p.published)
    .sort((a, b) => new Date(b.date) - new Date(a.date))
  const latest = items[0] ? new Date(items[0].date) : new Date(0)

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/">
<channel>
<title>${esc(title)} — writing</title>
<link>${siteUrl}/blog</link>
<atom:link href="${siteUrl}/feed.xml" rel="self" type="application/rss+xml"/>
<description>${esc(description)}</description>
<language>en-us</language>
<lastBuildDate>${latest.toUTCString()}</lastBuildDate>
<managingEditor>${esc(email)} (${esc(author)})</managingEditor>
<webMaster>${esc(email)} (${esc(author)})</webMaster>
<image>
<url>${siteUrl}/icon-192.png</url>
<title>${esc(title)}</title>
<link>${siteUrl}</link>
</image>
${items
  .map((p) => {
    const url = absoluteUrl(`/${p.slug}`)
    const image = p.images && p.images[0]
    return `<item>
<title>${esc(p.title)}</title>
<link>${url}</link>
<guid isPermaLink="true">${url}</guid>
<pubDate>${new Date(p.date).toUTCString()}</pubDate>
<dc:creator xmlns:dc="http://purl.org/dc/elements/1.1/">${esc(author)}</dc:creator>
<description>${esc(p.description)}</description>
${(p.tags || []).map((t) => `<category>${esc(t)}</category>`).join("")}
${image ? `<media:content url="${absoluteUrl(image)}" medium="image" type="${mime(image)}"/>` : ""}
</item>`
  })
  .join("\n")}
</channel>
</rss>
`

  return new Response(body, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
    },
  })
}
