import fs from 'fs/promises'
import path from 'path'
import { sanitize, EMPTY } from './constants'

/* ─────────────────────────────────────────────────────────────
 * /work — one JSON file is the whole source of truth. The shape
 * itself lives in ./constants so the studio can import it on the
 * client; this module is only the filesystem half.
 * ───────────────────────────────────────────────────────────── */

export const DATA_PATH = path.join(process.cwd(), 'src/app/work/data/work.json')

export * from './constants'

export async function readWork() {
  try {
    const raw = await fs.readFile(DATA_PATH, 'utf-8')
    return sanitize(JSON.parse(raw))
  } catch {
    return EMPTY
  }
}

export async function writeWork(data) {
  await fs.mkdir(path.dirname(DATA_PATH), { recursive: true })
  await fs.writeFile(DATA_PATH, JSON.stringify(sanitize(data), null, 2) + '\n', 'utf-8')
}
