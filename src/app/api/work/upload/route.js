import { NextResponse } from 'next/server'
import fs from 'fs/promises'
import path from 'path'
import { isProdView } from '@/lib/viewMode'

/* Media dropped into the work studio lands in /public/work/… , kept apart
 * from /public/blog/… so the two studios can never collide on a filename.
 * Mirrors the blog upload route's slug + base36-timestamp scheme. */
const MEDIA_TYPES = {
  '.png': 'image', '.jpg': 'image', '.jpeg': 'image',
  '.gif': 'image', '.webp': 'image', '.avif': 'image', '.svg': 'image',
  '.mp4': 'video', '.webm': 'video', '.mov': 'video',
}

// The base is a fully static path.join so Turbopack's file tracer scopes to
// public/work instead of walking the whole project; only the leaf segment
// varies. (See the "Encountered unexpected file in NFT list" build warning.)
const BASE_DIR = path.join(process.cwd(), 'public', 'work')
const SUBDIRS = { image: 'images', video: 'videos' }
const URL_DIRS = { image: '/work/images', video: '/work/videos' }

export async function POST(request) {
  if (isProdView()) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const formData = await request.formData()
    const file = formData.get('file')
    if (!file || typeof file === 'string') {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    const ext = path.extname(file.name).toLowerCase()
    const mediaType = MEDIA_TYPES[ext]
    if (!mediaType) {
      return NextResponse.json(
        {
          error: `${ext || 'That file type'} is not supported. Allowed: ${Object.keys(MEDIA_TYPES).join(', ')}`,
        },
        { status: 400 },
      )
    }

    const baseName = path
      .basename(file.name, ext)
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')

    const fileName = `${baseName || 'file'}-${Date.now().toString(36)}${ext}`
    const dir = path.join(BASE_DIR, SUBDIRS[mediaType])
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, fileName), Buffer.from(await file.arrayBuffer()))

    return NextResponse.json({
      path: `${URL_DIRS[mediaType]}/${fileName}`,
      fileName,
      mediaType,
    })
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
