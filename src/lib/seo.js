// Server-side only (reads the filesystem). Components that may reach a
// client bundle take `absoluteUrl` from lib/urls.js instead.

import { existsSync } from "node:fs"
import { join } from "node:path"
import { author, siteUrl, title as siteName, xHandle } from "@/app/constants"
import { posts } from "@/app/(blog)/posts"
import { absoluteUrl } from "./urls"

export { absoluteUrl }

// Feed discovery links. Carried by every route's `alternates` because a
// page-level `alternates` replaces the root's outright — canonical and feeds
// travel together or the feeds vanish from every page but the home page.
export const FEEDS = {
  "application/rss+xml": `${siteUrl}/feed.xml`,
  "application/feed+json": `${siteUrl}/feed.json`,
}

// The card image for a route: a hand-picked one when given (a post's first
// photo), otherwise a generated title card from /og, so no page is left
// sharing the site-wide default and every share shows what was shared.
export function ogImage({ title, description, image }) {
  if (image) return image
  const q = new URLSearchParams({ title })
  if (description) q.set("description", description)
  return {
    url: `/og?${q}`,
    width: 1200,
    height: 630,
    alt: `${title} — ${siteName}`,
    type: "image/png",
  }
}

// Complete per-route metadata. Next.js replaces nested metadata objects
// wholesale — a page's `openGraph` overwrites the root's rather than merging
// into it — so every route has to carry a full card. Building it here keeps
// title, description, canonical and both cards from drifting apart.
export function pageMetadata({
  title,
  description,
  path,
  image,
  type = "website",
  noindex = false,
  publishedTime,
  modifiedTime,
  tags,
  // Skip the `%s | herb.art` template — for the home page, whose title
  // already carries the site name.
  absoluteTitle = false,
  // Extra Open Graph fields for the type (a `profile`'s firstName/lastName…).
  openGraph = {},
}) {
  const url = absoluteUrl(path)
  const img = ogImage({ title, description, image })
  const article =
    type === "article"
      ? {
          publishedTime,
          modifiedTime,
          authors: [author],
          ...(tags && tags.length ? { tags } : {}),
        }
      : {}

  return {
    title: absoluteTitle ? { absolute: title } : title,
    description,
    alternates: { canonical: url, types: FEEDS },
    openGraph: {
      type,
      title,
      description,
      url,
      siteName,
      locale: "en_US",
      images: [img],
      ...article,
      ...openGraph,
    },
    twitter: {
      card: "summary_large_image",
      site: xHandle,
      creator: xHandle,
      title,
      description,
      images: [img],
    },
    ...(noindex ? { robots: { index: false, follow: false } } : {}),
  }
}

// A post's metadata, from its registry entry — so the MDX never restates
// what posts.js already says and the studio's edits reach the <head> too.
// The card is the 1200×630 JPEG scripts/blog-og.mjs cuts from the first
// image; the raw photo is the fallback if that hasn't been generated.
export function postMetadata(slug) {
  const post = posts.find((p) => p.slug === slug)
  if (!post) throw new Error(`No post registered for "${slug}" in (blog)/posts.js`)
  const photo = post.images && post.images[0]
  const card = photo && existsSync(join(process.cwd(), "public/blog/og", `${slug}.jpg`))
    ? { url: `/blog/og/${slug}.jpg`, width: 1200, height: 630, alt: post.title, type: "image/jpeg" }
    : photo
  return pageMetadata({
    title: post.title,
    description: post.description,
    path: `/${slug}`,
    type: "article",
    image: card,
    publishedTime: new Date(post.date).toISOString(),
    modifiedTime: new Date(post.updated || post.date).toISOString(),
    tags: post.tags,
    noindex: !post.published,
    openGraph: { section: "Writing" },
  })
}
