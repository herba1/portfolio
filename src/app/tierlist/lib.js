import fs from 'fs/promises'
import path from 'path'

// Each tier list is a JSON file in data/<slug>.json sharing one shape:
//   { title, subtitle, tiers: [{id,label,color}], items: [{id,src,label,tier}] }
export const DATA_DIR = path.join(process.cwd(), 'src/app/tierlist/data')
export const SLUG_RE = /^[a-z0-9-]+$/

export async function listSlugs() {
  try {
    const entries = await fs.readdir(DATA_DIR)
    return entries
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/, ''))
      .filter((s) => SLUG_RE.test(s))
  } catch {
    return []
  }
}

export async function readTierlist(slug) {
  if (!SLUG_RE.test(slug)) return null
  try {
    const raw = await fs.readFile(path.join(DATA_DIR, `${slug}.json`), 'utf-8')
    return JSON.parse(raw)
  } catch {
    return null
  }
}

// Index summaries: title + count + a few cover thumbnails for previews.
export async function listTierlists() {
  const slugs = await listSlugs()
  const all = await Promise.all(
    slugs.map(async (slug) => {
      const data = await readTierlist(slug)
      if (!data) return null
      const ranked = (data.items || []).filter((i) => i.tier != null)
      return {
        slug,
        title: data.title || slug,
        subtitle: data.subtitle || '',
        description: data.description || '',
        tiers: data.tiers || [],
        count: (data.items || []).length,
        // Keep the item id alongside the src so the index thumbnail and the
        // detail-page tile can share a `view-transition-name` and morph between
        // each other on navigation. Only the first 3 (shown in the fan) matter.
        covers: (data.items || [])
          .filter((i) => i.src)
          .slice(0, 3)
          .map((i) => ({ src: i.src, id: i.id })),
        rankedCount: ranked.length,
      }
    }),
  )
  return all.filter(Boolean).sort((a, b) => a.title.localeCompare(b.title))
}
