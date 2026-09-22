import { execFileSync } from "node:child_process"

// Build-time freshness for the sitemap: the commit date of the newest change
// under each path, so <lastmod> says when a page's source last moved instead
// of when the site was last deployed. Falls back to `fallback` (or now) when
// git or the history is unavailable — a build image without `.git` gets the
// old behaviour, not a broken sitemap.
//
// Server/build only (child_process). Do not import from anything a client
// bundle can reach.

const cache = new Map()

function commitDate(path) {
  if (cache.has(path)) return cache.get(path)
  let date = null
  try {
    const out = execFileSync("git", ["log", "-1", "--format=%cI", "--", path], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim()
    if (out) date = new Date(out)
  } catch {
    date = null
  }
  cache.set(path, date)
  return date
}

export function lastModified(paths, fallback) {
  const list = Array.isArray(paths) ? paths : [paths]
  let latest = null
  for (const p of list) {
    const d = commitDate(p)
    if (d && (!latest || d > latest)) latest = d
  }
  if (latest) return latest
  return fallback ? new Date(fallback) : new Date()
}
