// Share cards for the writing: public/blog/og/<slug>.jpg, a 1200×630 JPEG
// cut from each published post's first image.
//
// The photos themselves are the wrong shape and weight for a link preview
// (portrait, 2000px, up to 1.6 MB WebP); Bluesky, Discord, iMessage and
// LinkedIn want a landscape raster under a megabyte with declared
// dimensions. lib/seo.js#postMetadata points the card at this file.
//
// Runs before every build (package.json "prebuild") and is idempotent: a card
// is only re-cut when its source is newer. Outputs are committed so a build
// without sharp still ships cards.

import { existsSync, mkdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

const ROOT = process.cwd()
const OUT_DIR = join(ROOT, "public/blog/og")

const { posts } = await import(pathToFileURL(join(ROOT, "src/app/(blog)/posts.js")).href)

let sharp
try {
  sharp = (await import("sharp")).default
} catch {
  console.warn("blog-og: sharp unavailable, keeping the committed cards")
  process.exit(0)
}

mkdirSync(OUT_DIR, { recursive: true })

let made = 0
for (const post of posts) {
  const first = post.images && post.images[0]
  if (!first) continue
  const src = join(ROOT, "public", first)
  const out = join(OUT_DIR, `${post.slug}.jpg`)
  if (!existsSync(src)) {
    console.warn(`blog-og: ${post.slug}: missing ${first}`)
    continue
  }
  if (existsSync(out) && statSync(out).mtimeMs >= statSync(src).mtimeMs) continue
  await sharp(src)
    .rotate() // honour EXIF orientation before cropping
    .resize(1200, 630, { fit: "cover", position: "attention" })
    .jpeg({ quality: 82, mozjpeg: true })
    .toFile(out)
  made++
  console.log(`blog-og: ${post.slug}.jpg`)
}
console.log(`blog-og: ${made} card(s) cut`)
