import { NextResponse } from 'next/server'
import { isProdView } from '@/lib/viewMode'
import { readWork, writeWork } from '@/app/work/lib'

// Read is harmless (the page ships the same data statically). Writing the
// file is dev-only, same gate as the blog studio and the tierlist editor.
export async function GET() {
  return NextResponse.json(await readWork())
}

export async function POST(request) {
  if (isProdView()) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  try {
    const body = await request.json()
    await writeWork(body)
    return NextResponse.json({ saved: true })
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
