import { NextResponse } from 'next/server'
import fs from 'fs/promises'
import path from 'path'

const SLUG_RE = /^[a-z0-9-]+$/

export async function POST(request) {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const body = await request.json()
    const { slug } = body

    if (!slug || !SLUG_RE.test(slug)) {
      return NextResponse.json({ error: 'Invalid slug' }, { status: 400 })
    }

    const dir = path.join(process.cwd(), 'src/app/(blog)', slug)
    const filePath = path.join(dir, 'page.mdx')

    // Delete mode
    if (body.delete) {
      await fs.rm(dir, { recursive: true, force: true })
      return NextResponse.json({ slug, deleted: true })
    }

    // Write mode
    if (typeof body.content !== 'string') {
      return NextResponse.json({ error: 'Content must be a string' }, { status: 400 })
    }

    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(filePath, body.content, 'utf-8')

    return NextResponse.json({ slug, saved: true })
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
