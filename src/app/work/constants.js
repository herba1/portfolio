/* The /work data shape, with no Node imports — so the studio (client) and
 * the page + API (server) can share one definition of a tile.
 *
 * The grid is a masonry: every tile keeps its natural height and declares how
 * many COLUMNS it wants (1–3). Nothing here knows about pixels; column count
 * is decided at render time from the container's width, so the same data lays
 * out correctly on the live page and inside the studio's narrow preview pane.
 *
 * Four kinds of tile:
 *   component — a real, live React component from the registry
 *   image     — a still from /public
 *   video     — an mp4/webm from /public, muted + looping by default
 *   note      — a typographic tile (a statement, a link, a number)
 */

// The grid is two columns at EVERY width — it never reflows to three or
// collapses to one, so the eye learns one rhythm and keeps it. This is the
// single source of that number: the layout, the span clamp and the studio's
// width control all read it from here.
export const COLUMNS = 2

export const KINDS = ['component', 'image', 'video', 'note']
export const FITS = ['cover', 'contain']

// `auto` means "whatever the content is" — the only sane default for a
// component, which sizes itself. A still or a clip has to declare a box up
// front or the masonry reflows the moment it decodes.
export const RATIOS = ['auto', '1/1', '4/3', '3/4', '16/9', '4/5', '3/2', '2/3']

const str = (v, fallback = '') => (typeof v === 'string' ? v : fallback)
const bool = (v, fallback = false) => (typeof v === 'boolean' ? v : fallback)

// A tile is either one column or the full width — there is no third option
// while COLUMNS is 2. Old data carrying span: 3 clamps down rather than
// blowing out of the grid.
export function clampSpan(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return 1
  return Math.min(COLUMNS, Math.max(1, Math.round(n)))
}

// Tiny stable hash so a pasted item without an id still gets a deterministic
// one instead of a random value that would churn the file on every save.
function hash(s) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  return h
}

export function sanitizeItem(raw, i = 0) {
  const kind = KINDS.includes(raw?.kind) ? raw.kind : 'image'
  return {
    id: str(raw?.id) || `item-${i}-${Math.abs(hash(JSON.stringify(raw ?? i)))}`,
    kind,
    span: clampSpan(raw?.span),
    // `title` is a STUDIO label — the name in the sidebar and the alt-text
    // fallback. It is never painted on the page: the tiles are the content,
    // so nothing carries a caption, a subtitle or a name plate. The one
    // exception is a note, where the words ARE the tile.
    title: str(raw?.title),
    body: str(raw?.body),
    href: str(raw?.href),
    // media
    src: str(raw?.src),
    poster: str(raw?.poster),
    alt: str(raw?.alt),
    ratio: RATIOS.includes(raw?.ratio)
      ? raw.ratio
      : kind === 'component' || kind === 'note'
        ? 'auto'
        : '4/3',
    fit: FITS.includes(raw?.fit) ? raw.fit : 'cover',
    autoplay: bool(raw?.autoplay, true),
    // component
    component: str(raw?.component),
    // presentation
    background: str(raw?.background),
    padded: bool(raw?.padded, kind === 'component'),
    frame: bool(raw?.frame, kind !== 'note'),
    hidden: bool(raw?.hidden, false),
  }
}

export function sanitize(body) {
  const items = Array.isArray(body?.items) ? body.items : []
  return {
    title: str(body?.title, 'Work'),
    intro: str(body?.intro),
    items: items.map(sanitizeItem),
  }
}

export const EMPTY = { title: 'Work', intro: '', items: [] }

// A fresh tile of each kind, as the studio's "Add" menu creates them.
export function blankItem(kind, id) {
  return sanitizeItem({
    id,
    kind,
    span: 1,
    title: '',
    ratio: kind === 'component' || kind === 'note' ? 'auto' : '4/3',
  })
}
