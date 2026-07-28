import { isProdView } from '@/lib/viewMode'
import { NextResponse } from 'next/server'
import fs from 'fs/promises'
import path from 'path'

const SLUG_RE = /^[a-z0-9-]+$/
const ALLOWED_KEYS = ['published', 'title', 'description', 'date', 'tags']
const BLOG_DIR = path.join(process.cwd(), 'src/app/(blog)')
const POSTS_PATH = path.join(BLOG_DIR, 'posts.js')

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function serialize(value, indent = '') {
  if (Array.isArray(value)) {
    if (!value.length) return '[]'
    return `[\n${value.map((v) => `${indent}  ${serialize(v)}`).join(',\n')},\n${indent}]`
  }
  if (typeof value === 'string') return `'${value.replace(/'/g, "\\'")}'`
  return String(value)
}

// A post the studio wrote to disk may not be in posts.js yet — publishing is
// what registers it, so the entry is built from what the MDX already declares.
function readMdxMeta(mdx, slug) {
  const attr = (name) => {
    const header = mdx.match(/<BlogHeader\b[\s\S]*?\/>/)
    return header?.[0].match(new RegExp(`\\s${name}="([^"]*)"`))?.[1] || ''
  }

  const metaField = (name) =>
    mdx.match(new RegExp(`\\n\\s*${name}:\\s*['"]([^'"]*)['"]`))?.[1] || ''

  const tags =
    mdx
      .match(/<BlogHeader\b[\s\S]*?\/>/)?.[0]
      .match(/\stags=\{\[([^\]]*)\]\}/)?.[1]
      ?.match(/['"]([^'"]*)['"]/g)
      ?.map((t) => t.replace(/['"]/g, '')) || []

  const images = []
  for (const re of [
    /<(?:BlogImage\w*|Image)\b[^>]*?\ssrc="([^"]+)"/g,
    /!\[[^\]]*\]\(([^)\s]+)\)/g,
  ]) {
    let m
    while ((m = re.exec(mdx)) !== null) {
      if (m[1].startsWith('/') && !images.includes(m[1])) images.push(m[1])
    }
  }

  // `title` in metadata carries the site suffix; BlogHeader has the bare one.
  const title = attr('title') || metaField('title').replace(/\s*\|\s*herb\.art\s*$/i, '')

  return {
    slug,
    title: title || slug,
    description: metaField('description'),
    date: attr('date') || new Date().toISOString().slice(0, 10),
    tags,
    images,
    published: false,
  }
}

// Index just past the `]` closing the `[` at openIdx.
function matchBracket(src, openIdx) {
  let depth = 0
  for (let i = openIdx; i < src.length; i++) {
    if (src[i] === '[') depth++
    else if (src[i] === ']' && --depth === 0) return i
  }
  return -1
}

async function registerPost(source, slug, updates) {
  const mdxPath = path.join(BLOG_DIR, slug, 'page.mdx')

  let mdx
  try {
    mdx = await fs.readFile(mdxPath, 'utf-8')
  } catch {
    return { error: 'No page.mdx on disk for this slug', status: 404 }
  }

  const post = readMdxMeta(mdx, slug)
  for (const [key, value] of Object.entries(updates)) {
    if (ALLOWED_KEYS.includes(key)) post[key] = value
  }

  const arrayOpen = source.indexOf('[', source.search(/export\s+const\s+posts\s*=\s*\[/))
  const arrayClose = matchBracket(source, arrayOpen)
  if (arrayOpen === -1 || arrayClose === -1) {
    return { error: 'Could not parse posts.js', status: 500 }
  }

  const fields = ['slug', 'title', 'description', 'date', 'tags', 'images', 'published']
    .map((key) => `    ${key}: ${serialize(post[key], '    ')},`)
    .join('\n')

  const before = source.slice(0, arrayClose).replace(/\s*$/, '')
  const entry = `\n  {\n${fields}\n  },\n`

  return { source: before + entry + source.slice(arrayClose) }
}

export async function POST(request) {
  if (isProdView()) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const { slug, updates } = await request.json()

    if (!slug || !SLUG_RE.test(slug)) {
      return NextResponse.json({ error: 'Invalid slug' }, { status: 400 })
    }

    const source = await fs.readFile(POSTS_PATH, 'utf-8')

    const postRegex = new RegExp(
      `(\\{[^}]*slug:\\s*['"]${escapeRegex(slug)}['"][^}]*\\})`,
      's'
    )
    const match = source.match(postRegex)

    if (!match) {
      const result = await registerPost(source, slug, updates)
      if (result.error) {
        return NextResponse.json({ error: result.error }, { status: result.status })
      }
      await fs.writeFile(POSTS_PATH, result.source, 'utf-8')
      return NextResponse.json({ slug, updated: true, registered: true })
    }

    let postBlock = match[1]

    for (const [key, value] of Object.entries(updates)) {
      // Only allow known safe keys
      if (!ALLOWED_KEYS.includes(key)) continue

      const fieldRegex = new RegExp(`(${escapeRegex(key)}:\\s*)(\\[[^\\]]*\\]|[^,\\n}]+)`)
      const fieldMatch = postBlock.match(fieldRegex)

      if (fieldMatch) {
        postBlock = postBlock.replace(fieldRegex, `$1${serialize(value, '    ')}`)
      }
    }

    const updated = source.replace(match[1], postBlock)
    await fs.writeFile(POSTS_PATH, updated, 'utf-8')

    return NextResponse.json({ slug, updated: true })
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
