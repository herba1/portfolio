import { isProdView } from '@/lib/viewMode'
import { NextResponse } from 'next/server'
import fs from 'fs/promises'
import path from 'path'

const BLOG_DIR = path.join(process.cwd(), 'src/app/(blog)')
const POSTS_PATH = path.join(BLOG_DIR, 'posts.js')

// Parse posts.js as text to avoid Node module caching
async function readPosts() {
  const source = await fs.readFile(POSTS_PATH, 'utf-8')

  // Extract the array content between [ and ]
  const match = source.match(/export\s+const\s+posts\s*=\s*\[([\s\S]*)\]/)
  if (!match) return []

  // Parse each object block
  const posts = []
  const objectRegex = /\{([^}]+)\}/g
  let m
  while ((m = objectRegex.exec(match[1])) !== null) {
    const block = m[1]
    const get = (key) => {
      const fieldMatch = block.match(new RegExp(`${key}:\\s*['"]([^'"]*?)['"]`))
      return fieldMatch ? fieldMatch[1] : ''
    }
    const getBool = (key) => {
      const fieldMatch = block.match(new RegExp(`${key}:\\s*(true|false)`))
      return fieldMatch ? fieldMatch[1] === 'true' : false
    }
    const getTags = () => {
      const tagMatch = block.match(/tags:\s*\[([^\]]*)\]/)
      if (!tagMatch) return []
      return tagMatch[1].match(/['"]([^'"]*?)['"]/g)?.map((t) => t.replace(/['"]/g, '')) || []
    }

    const slug = get('slug')
    if (slug) {
      posts.push({
        slug,
        title: get('title'),
        description: get('description'),
        date: get('date'),
        tags: getTags(),
        published: getBool('published'),
      })
    }
  }

  return posts
}

export async function GET() {
  if (isProdView()) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const posts = await readPosts()

    // Scan filesystem for any MDX files not in the registry
    const entries = await fs.readdir(BLOG_DIR, { withFileTypes: true })
    const slugsOnDisk = []

    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('component')) {
        const mdxPath = path.join(BLOG_DIR, entry.name, 'page.mdx')
        try {
          await fs.access(mdxPath)
          slugsOnDisk.push(entry.name)
        } catch {
          // No page.mdx in this directory
        }
      }
    }

    const registeredSlugs = new Set(posts.map((p) => p.slug))
    const unregistered = slugsOnDisk
      .filter((s) => !registeredSlugs.has(s))
      .map((slug) => ({
        slug,
        title: slug,
        description: '',
        date: '',
        tags: [],
        published: false,
        unregistered: true,
      }))

    return NextResponse.json([...posts, ...unregistered])
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
