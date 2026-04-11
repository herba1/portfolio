import { NextResponse } from 'next/server'
import fs from 'fs/promises'
import path from 'path'

const SLUG_RE = /^[a-z0-9-]+$/
const ALLOWED_KEYS = ['published', 'title', 'description', 'date', 'tags']
const POSTS_PATH = path.join(process.cwd(), 'src/app/(blog)/posts.js')

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export async function POST(request) {
  if (process.env.NODE_ENV !== 'development') {
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
      return NextResponse.json({ error: 'Post not found in registry' }, { status: 404 })
    }

    let postBlock = match[1]

    for (const [key, value] of Object.entries(updates)) {
      // Only allow known safe keys
      if (!ALLOWED_KEYS.includes(key)) continue

      const fieldRegex = new RegExp(`(${escapeRegex(key)}:\\s*)([^,\\n}]+)`)
      const fieldMatch = postBlock.match(fieldRegex)

      if (fieldMatch) {
        const serialized = typeof value === 'string'
          ? `'${value.replace(/'/g, "\\'")}'`
          : String(value)
        postBlock = postBlock.replace(fieldRegex, `$1${serialized}`)
      }
    }

    const updated = source.replace(match[1], postBlock)
    await fs.writeFile(POSTS_PATH, updated, 'utf-8')

    return NextResponse.json({ slug, updated: true })
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
