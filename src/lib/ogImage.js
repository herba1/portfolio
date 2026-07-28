// Keeps a post's share image in sync with its first image.
//
// Social scrapers only reliably render png/jpg/webp/gif, so svg/avif are
// skipped and the post falls back to the site-wide opengraph-image.

const SHAREABLE = /\.(png|jpe?g|webp|gif)$/i

// Only paths we generated are re-synced — a hand-picked image is left alone.
const AUTO_MANAGED = /^\/blog\//

export function firstImageIn(content) {
  const found = []
  const patterns = [
    /<(?:BlogImage\w*|Image)\b[^>]*?\ssrc="([^"]+)"/g, // <BlogImage src="..." />
    /!\[[^\]]*\]\(([^)\s]+)\)/g,                       // ![alt](/path.png)
  ]
  for (const re of patterns) {
    let m
    while ((m = re.exec(content)) !== null) found.push({ at: m.index, src: m[1] })
  }
  found.sort((a, b) => a.at - b.at)
  return found.find((f) => f.src.startsWith('/') && SHAREABLE.test(f.src))?.src || null
}

// Index of the `}` closing the `{` at openIdx. Metadata values here never
// contain braces inside strings, so a plain depth count is enough.
function matchBrace(src, openIdx) {
  let depth = 0
  for (let i = openIdx; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}' && --depth === 0) return i
  }
  return -1
}

// Locates the `key: { ... }` block inside a metadata object body.
function findSection(body, key) {
  const blockMatch = body.match(new RegExp(`(^|\\n)([ \\t]*)${key}:\\s*\\{`))
  if (!blockMatch) return null
  const open = body.indexOf('{', blockMatch.index + blockMatch[1].length)
  const close = matchBrace(body, open)
  if (close === -1) return null
  return { indent: blockMatch[2], open, close, inner: body.slice(open + 1, close) }
}

const IMAGES_RE = /(^|\n)([ \t]*)images:\s*(\[[^\]]*\]|'[^']*'|"[^"]*")\s*,?/

// The image currently declared under `key`, or '' if there isn't one.
function readImages(body, key) {
  const section = findSection(body, key)
  if (!section) return ''
  return section.inner.match(IMAGES_RE)?.[3].match(/['"]([^'"]+)['"]/)?.[1] || ''
}

// Sets `images: ['<image>']` inside the `key: { ... }` block of a metadata
// object body, adding the block if it isn't there.
function setImages(body, key, image) {
  const section = findSection(body, key)

  if (!section) {
    return `${body.replace(/\s*$/, '')}\n  ${key}: {\n    images: ['${image}'],\n  },\n`
  }

  const { indent, open, close, inner } = section
  const imagesMatch = inner.match(IMAGES_RE)

  if (imagesMatch) {
    const current = imagesMatch[3].match(/['"]([^'"]+)['"]/)?.[1] || ''
    if (current === image) return body
    if (current && !AUTO_MANAGED.test(current)) return body // author picked this one
    const replaced = inner.replace(imagesMatch[0], `${imagesMatch[1]}${imagesMatch[2]}images: ['${image}'],`)
    return body.slice(0, open + 1) + replaced + body.slice(close)
  }

  return body.slice(0, open + 1) + `\n${indent}  images: ['${image}'],` + inner + body.slice(close)
}

// Returns the MDX source with openGraph/twitter share images pointed at the
// post's first image. Unchanged when there is no image or no metadata export.
export function syncShareImage(source) {
  const firstImage = firstImageIn(source)
  if (!firstImage) return source

  const metaMatch = source.match(/export\s+const\s+metadata\s*=\s*\{/)
  if (!metaMatch) return source

  const open = metaMatch.index + metaMatch[0].length - 1
  const close = matchBrace(source, open)
  if (close === -1) return source

  let body = source.slice(open + 1, close)

  // A hand-picked openGraph image wins and carries over to twitter
  const declared = readImages(body, 'openGraph')
  const image = declared && !AUTO_MANAGED.test(declared) ? declared : firstImage

  // twitter is set too — the root layout defines a `twitter` block, and a post
  // that only sets openGraph would inherit the site-wide twitter image.
  for (const key of ['openGraph', 'twitter']) body = setImages(body, key, image)

  return source.slice(0, open + 1) + body + source.slice(close)
}
