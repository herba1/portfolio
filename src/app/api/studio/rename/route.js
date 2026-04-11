import { NextResponse } from 'next/server'
import fs from 'fs/promises'
import path from 'path'

const SLUG_RE = /^[a-z0-9-]+$/
const POSTS_PATH = path.join(process.cwd(), 'src/app/(blog)/posts.js')
const BLOG_DIR = path.join(process.cwd(), 'src/app/(blog)')

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export async function POST(request) {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const { oldSlug, newSlug } = await request.json()

    if (!oldSlug || !SLUG_RE.test(oldSlug) || !newSlug || !SLUG_RE.test(newSlug)) {
      return NextResponse.json({ error: 'Invalid slug' }, { status: 400 })
    }

    if (oldSlug === newSlug) {
      return NextResponse.json({ slug: newSlug, renamed: true })
    }

    const oldDir = path.join(BLOG_DIR, oldSlug)
    const newDir = path.join(BLOG_DIR, newSlug)

    // Check old exists
    try {
      await fs.access(oldDir)
    } catch {
      return NextResponse.json({ error: 'Source post not found' }, { status: 404 })
    }

    // Check new doesn't exist
    try {
      await fs.access(newDir)
      return NextResponse.json({ error: 'A post with that slug already exists' }, { status: 409 })
    } catch {
      // Good — doesn't exist
    }

    // Rename directory
    await fs.rename(oldDir, newDir)

    // Update slug in posts.js
    const source = await fs.readFile(POSTS_PATH, 'utf-8')
    const updated = source.replace(
      new RegExp(`(slug:\\s*['"])${escapeRegex(oldSlug)}(['"])`, 'g'),
      `$1${newSlug}$2`
    )
    await fs.writeFile(POSTS_PATH, updated, 'utf-8')

    return NextResponse.json({ slug: newSlug, renamed: true })
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
