import { NextResponse } from 'next/server'
import fs from 'fs/promises'
import path from 'path'

const IMAGE_TYPES = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.svg',
])

const OUT_DIR = path.join(process.cwd(), 'public/tierlist/images')
const URL_DIR = '/tierlist/images'

export async function POST(request) {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const formData = await request.formData()
    const file = formData.get('file')

    if (!file || typeof file === 'string') {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    const ext = path.extname(file.name).toLowerCase()
    if (!IMAGE_TYPES.has(ext)) {
      return NextResponse.json(
        { error: `Unsupported type ${ext}. Allowed: ${[...IMAGE_TYPES].join(', ')}` },
        { status: 400 },
      )
    }

    const baseName = path
      .basename(file.name, ext)
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'item'

    const stamp = Date.now().toString(36)
    const fileName = `${baseName}-${stamp}${ext}`

    await fs.mkdir(OUT_DIR, { recursive: true })
    const buffer = Buffer.from(await file.arrayBuffer())
    await fs.writeFile(path.join(OUT_DIR, fileName), buffer)

    return NextResponse.json({ src: `${URL_DIR}/${fileName}`, fileName })
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
