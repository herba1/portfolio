import { NextResponse } from 'next/server'
import fs from 'fs/promises'
import path from 'path'

const DATA_DIR = path.join(process.cwd(), 'src/app/tierlist/data')
const SLUG_RE = /^[a-z0-9-]+$/

function sanitize(body) {
  const tiers = Array.isArray(body?.tiers) ? body.tiers : []
  const items = Array.isArray(body?.items) ? body.items : []
  return {
    title: typeof body?.title === 'string' ? body.title : 'Untitled',
    subtitle: typeof body?.subtitle === 'string' ? body.subtitle : '',
    description: typeof body?.description === 'string' ? body.description : '',
    tiers: tiers.map((t) => ({
      id: String(t.id),
      label: typeof t.label === 'string' ? t.label : '',
      color: typeof t.color === 'string' ? t.color : '#cccccc',
    })),
    items: items.map((it) => ({
      id: String(it.id),
      src: String(it.src),
      label: typeof it.label === 'string' ? it.label : '',
      note: typeof it.note === 'string' ? it.note : '',
      tier: it.tier == null ? null : String(it.tier),
    })),
  }
}

async function listAll() {
  let files = []
  try {
    files = (await fs.readdir(DATA_DIR)).filter((f) => f.endsWith('.json'))
  } catch {
    return []
  }
  const out = []
  for (const f of files) {
    try {
      const data = JSON.parse(await fs.readFile(path.join(DATA_DIR, f), 'utf-8'))
      out.push({
        slug: f.replace(/\.json$/, ''),
        title: data.title || '',
        subtitle: data.subtitle || '',
        count: (data.items || []).length,
      })
    } catch {
      /* skip unreadable file */
    }
  }
  return out
}

export async function GET(request) {
  const slug = new URL(request.url).searchParams.get('slug')
  try {
    if (!slug) return NextResponse.json(await listAll())
    if (!SLUG_RE.test(slug)) {
      return NextResponse.json({ error: 'Invalid slug' }, { status: 400 })
    }
    const raw = await fs.readFile(path.join(DATA_DIR, `${slug}.json`), 'utf-8')
    return NextResponse.json(JSON.parse(raw))
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
}

export async function POST(request) {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  try {
    const body = await request.json()
    const slug = String(body?.slug || '')
    if (!SLUG_RE.test(slug)) {
      return NextResponse.json({ error: 'Invalid slug' }, { status: 400 })
    }
    const filePath = path.join(DATA_DIR, `${slug}.json`)

    if (body.delete) {
      await fs.rm(filePath, { force: true })
      return NextResponse.json({ slug, deleted: true })
    }

    await fs.mkdir(DATA_DIR, { recursive: true })

    // Create mode: seed default tiers if the file doesn't exist yet.
    let data
    if (body.create) {
      try {
        await fs.access(filePath)
        return NextResponse.json({ error: 'Already exists' }, { status: 409 })
      } catch {
        data = sanitize({
          title: body.title || slug,
          subtitle: '',
          tiers: [
            { id: 's', label: 'S', color: '#e26d6d' },
            { id: 'a', label: 'A', color: '#e2966d' },
            { id: 'b', label: 'B', color: '#e2c46d' },
            { id: 'c', label: 'C', color: '#a8c47e' },
            { id: 'd', label: 'D', color: '#7ea8c4' },
          ],
          items: [],
        })
      }
    } else {
      data = sanitize(body)
    }

    await fs.writeFile(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8')
    return NextResponse.json({ slug, saved: true })
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
