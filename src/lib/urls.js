import { siteUrl } from "@/app/constants"

// Absolute URL for a site path. Kept apart from lib/seo.js because this is
// needed by components that can end up in a client bundle (BlogHeader via
// the studio's preview pane), and seo.js reads the filesystem.
//
// The home page is `https://herb.art` with no trailing slash — the form every
// existing canonical, sitemap entry and backlink already uses — so it is
// special-cased rather than normalised.
export function absoluteUrl(path = "/") {
  if (/^https?:\/\//.test(path)) return path
  if (path === "/" || path === "") return siteUrl
  return `${siteUrl}${path.startsWith("/") ? path : `/${path}`}`
}
