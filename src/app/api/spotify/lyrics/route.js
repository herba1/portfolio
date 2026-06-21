// GET /api/spotify/lyrics?artist=…&title=… — plain lyrics from lrclib.net
// (free, no key, one fetch). We don't time-sync to the 30s preview, so we only
// need the words: returns { plain } (may be null). If lrclib only has a synced
// copy, we strip the [mm:ss.xx] tags down to plain text here.

export async function GET(request) {
  const url = new URL(request.url);
  const artist = (url.searchParams.get("artist") || "").trim();
  const title = (url.searchParams.get("title") || "").trim();
  if (!title) return Response.json({ plain: null });

  try {
    const q = new URLSearchParams({ artist_name: artist, track_name: title });
    const r = await fetch(`https://lrclib.net/api/get?${q}`, {
      headers: { "User-Agent": "herb.art covers (https://herb.art)" },
      cache: "no-store",
    });
    if (!r.ok) return Response.json({ plain: null });
    const d = await r.json();
    const plain = d.plainLyrics || stripTimestamps(d.syncedLyrics) || null;
    return Response.json({ plain }, { headers: { "Cache-Control": "public, max-age=86400" } });
  } catch {
    return Response.json({ plain: null });
  }
}

function stripTimestamps(lrc) {
  if (!lrc) return null;
  return lrc
    .split("\n")
    .map((l) => l.replace(/^\[\d+:\d+(?:\.\d+)?\]\s*/, "").trim())
    .join("\n")
    .trim();
}
