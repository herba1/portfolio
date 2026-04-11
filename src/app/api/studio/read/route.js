import { NextResponse } from 'next/server'
import fs from 'fs/promises'
import path from 'path'

const SLUG_RE = /^[a-z0-9-]+$/

export async function GET(request) {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const slug = searchParams.get('slug')

  if (!slug || !SLUG_RE.test(slug)) {
    return NextResponse.json({ error: 'Invalid slug' }, { status: 400 })
  }

  try {
    const filePath = path.join(process.cwd(), 'src/app/(blog)', slug, 'page.mdx')
    const content = await fs.readFile(filePath, 'utf-8')
    return NextResponse.json({ slug, content })
  } catch (error) {
    if (error.code === 'ENOENT') {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
