import { ALBUMS } from "@/app/lab/_music/catalog";

const key = (title, album) => `${title}::${album}`.toLowerCase();

export function buildIndex(topSongs) {
  const items = [];
  const seen = new Map();
  topSongs.forEach((t, rank) => {
    const item = {
      id: `top-${t.id ?? rank}`,
      kind: "Song",
      title: t.title,
      sub: t.album ? `${t.artist} · ${t.album}` : t.artist,
      cover: t.imageLarge || t.image,
      boost: 12 * (1 - rank / Math.max(1, topSongs.length)),
      year: t.year,
      top: true,
    };
    seen.set(key(t.title, t.album ?? ""), item);
    items.push(item);
  });
  ALBUMS.forEach((album) => {
    items.push({
      id: `album-${album.id}`,
      kind: "Album",
      title: album.title,
      sub: `${album.artist} · ${album.year}`,
      cover: album.cover,
      boost: 4,
      album: true,
    });
    album.tracks.forEach((title, i) => {
      if (seen.has(key(title, album.title))) return;
      items.push({
        id: `song-${album.id}-${i}`,
        kind: "Song",
        title,
        sub: `${album.artist} · ${album.title}`,
        cover: album.cover,
        year: album.year,
        boost: 0,
      });
    });
  });
  return items;
}

const isWordStart = (text, i) => i === 0 || /[\s(\-.'"]/.test(text[i - 1]);

export function matchText(text, query) {
  const t = text.toLowerCase();
  const q = query.toLowerCase();
  if (!q) return null;
  const at = t.indexOf(q);
  if (at >= 0) {
    let best = at;
    for (let i = at; i >= 0; i = t.indexOf(q, i + 1)) {
      if (isWordStart(text, i)) {
        best = i;
        break;
      }
    }
    const hits = [];
    for (let i = 0; i < q.length; i += 1) hits.push(best + i);
    const score = 100 + (best === 0 ? 40 : 0) + (isWordStart(text, best) ? 24 : 0) - best * 0.4 - (t.length - q.length) * 0.15;
    return { score, hits };
  }
  if (q.replace(/\s/g, "").length < 2) return null;
  const hits = [];
  let from = 0;
  let starts = 0;
  for (const ch of q) {
    if (ch === " ") continue;
    let found = -1;
    for (let i = from; i < t.length; i += 1) {
      if (t[i] === ch && isWordStart(text, i)) {
        found = i;
        break;
      }
    }
    if (found < 0) found = t.indexOf(ch, from);
    if (found < 0) return null;
    if (isWordStart(text, found)) starts += 1;
    hits.push(found);
    from = found + 1;
  }
  const span = hits[hits.length - 1] - hits[0] + 1;
  const acronym = starts === hits.length && hits.length >= 2;
  if (!acronym && span > hits.length + 2) return null;
  return { score: 40 + starts * 8 - (span - hits.length) * 1.5, hits, fuzzy: true };
}

export function search(items, query, limit = 24) {
  const q = query.trim();
  if (!q) return [];
  const out = [];
  for (const item of items) {
    const title = matchText(item.title, q);
    const sub = title ? null : matchText(item.sub, q);
    const year = !title && !sub && /^\d{2,4}$/.test(q) && String(item.year ?? "").startsWith(q);
    if (!title && !sub && !year) continue;
    const score = year ? 30 + item.boost : (title ? title.score : sub.score * 0.55) + item.boost + (item.album && title ? 6 : 0);
    const fuzzy = Boolean((title ?? sub)?.fuzzy);
    out.push({ ...item, score, fuzzy, titleHits: title?.hits ?? [], subHits: sub?.hits ?? [] });
  }
  const exact = out.filter((r) => !r.fuzzy).length;
  const kept = exact >= 4 ? out.filter((r) => !r.fuzzy) : out;
  kept.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  return kept.slice(0, limit);
}
