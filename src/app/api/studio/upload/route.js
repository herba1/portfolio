import { isProdView } from '@/lib/viewMode'
import { NextResponse } from 'next/server'
import { execFile } from 'child_process'
import { promisify } from 'util'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'

const execFileAsync = promisify(execFile)

export const runtime = 'nodejs'

const MEDIA_TYPES = {
  // Images
  '.png': 'image', '.jpg': 'image', '.jpeg': 'image',
  '.gif': 'image', '.webp': 'image', '.avif': 'image', '.svg': 'image',
  // Apple photos — transcoded to .jpg below, browsers can't render HEIC
  '.heic': 'image', '.heif': 'image',
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

const HEIC_EXTS = new Set(['.heic', '.heif'])

// macOS ships `sips`, which decodes HEIC natively and instantly. Everywhere
// else (and if sips chokes) fall back to the wasm decoder.
async function heicToJpeg(buffer) {
  if (process.platform === 'darwin') {
    const stem = path.join(os.tmpdir(), `studio-heic-${Date.now().toString(36)}`)
    const src = `${stem}.heic`
    const out = `${stem}.jpg`
    try {
      await fs.writeFile(src, buffer)
      await execFileAsync('sips', ['-s', 'format', 'jpeg', src, '--out', out])
      return await fs.readFile(out)
    } catch {
      // fall through to wasm
    } finally {
      await fs.rm(src, { force: true })
      await fs.rm(out, { force: true })
    }
  }

  const { default: convert } = await import('heic-convert')
  return Buffer.from(await convert({ buffer, format: 'JPEG', quality: 0.92 }))
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

    let ext = path.extname(file.name).toLowerCase()
    // Some drop sources hand over a HEIC with no extension in the name
    if (!ext && /^image\/(heic|heif)/.test(file.type || '')) ext = '.heic'
    const mediaType = MEDIA_TYPES[ext]

    if (!mediaType) {
      return NextResponse.json(
        { error: `File type ${ext} not supported. Allowed: ${Object.keys(MEDIA_TYPES).join(', ')}` },
        { status: 400 }
      )
    }

    // Slugify filename + timestamp to avoid collisions
    // Strip the extension case-insensitively — path.basename(name, ext) misses
    // it when the drop hands over "Photo.HEIC"
    const baseName = file.name
      .replace(/\.[^.]+$/, '')
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')

    let buffer = Buffer.from(await file.arrayBuffer())
    let outExt = ext
    let converted = false

    if (HEIC_EXTS.has(ext)) {
      buffer = await heicToJpeg(buffer)
      outExt = '.jpg'
      converted = true
    }

    const timestamp = Date.now().toString(36)
    const fileName = `${baseName || 'file'}-${timestamp}${outExt}`

    const dir = path.join(process.cwd(), DIRS[mediaType])
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, fileName), buffer)

    return NextResponse.json({
      path: `${URL_DIRS[mediaType]}/${fileName}`,
      fileName,
      mediaType,
      converted,
    })
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
