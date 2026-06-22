import { isProdView } from '@/lib/viewMode'
import { NextResponse } from 'next/server'
import fs from 'fs/promises'
import path from 'path'

const MEDIA_TYPES = {
  // Images
  '.png': 'image', '.jpg': 'image', '.jpeg': 'image',
  '.gif': 'image', '.webp': 'image', '.avif': 'image', '.svg': 'image',
  // Video
  '.mp4': 'video', '.webm': 'video', '.mov': 'video', '.ogg': 'video',
  // Audio
  '.mp3': 'audio', '.wav': 'audio', '.aac': 'audio',
  '.flac': 'audio', '.m4a': 'audio',
}

const DIRS = {
  image: 'public/blog/images',
  video: 'public/blog/videos',
  audio: 'public/blog/audio',
}

const URL_DIRS = {
  image: '/blog/images',
  video: '/blog/videos',
  audio: '/blog/audio',
}

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
        { error: `File type ${ext} not supported. Allowed: ${Object.keys(MEDIA_TYPES).join(', ')}` },
        { status: 400 }
      )
    }

    // Slugify filename + timestamp to avoid collisions
    const baseName = path
      .basename(file.name, ext)
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')

    const timestamp = Date.now().toString(36)
    const fileName = `${baseName}-${timestamp}${ext}`

    const dir = path.join(process.cwd(), DIRS[mediaType])
    await fs.mkdir(dir, { recursive: true })

    const buffer = Buffer.from(await file.arrayBuffer())
    await fs.writeFile(path.join(dir, fileName), buffer)

    return NextResponse.json({
      path: `${URL_DIRS[mediaType]}/${fileName}`,
      fileName,
      mediaType,
    })
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
