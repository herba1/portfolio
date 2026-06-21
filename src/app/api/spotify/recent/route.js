// GET /api/spotify/recent — owner's MOST-PLAYED tracks (Top Tracks), falling
// back to recently-played if the top-read scope isn't granted yet. Returns
// { tracks: [] } when unconfigured so the grid falls back to placeholders.

const TOKEN_URL = "https://accounts.spotify.com/api/token";
const TOP_URL = "https://api.spotify.com/v1/me/top/tracks?limit=50&time_range=medium_term";
const RECENT_URL = "https://api.spotify.com/v1/me/player/recently-played?limit=50";

async function getAccessToken() {
  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  const refresh = process.env.SPOTIFY_REFRESH_TOKEN;
  if (!id || !secret || !refresh) return null;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64"),
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refresh }),
    cache: "no-store",
  });
  if (!res.ok) return null;
  const json = await res.json();
  return json.access_token || null;
}

function mapTrack(tr) {
  if (!tr) return null;
  const imgs = tr.album?.images || [];
  return {
    id: tr.id,
    title: tr.name,
    artist: (tr.artists || []).map((a) => a.name).join(", "),
    artistId: (tr.artists || [])[0]?.id || null,
    artistImage: null,
    image: imgs[1]?.url || imgs[0]?.url || null,
    imageLarge: imgs[0]?.url || imgs[1]?.url || null,
    url: tr.external_urls?.spotify || null,
  };
}

// The top/recently-played payloads don't carry artist images, so batch-fetch
// them from /v1/artists (≤50 ids per call) and stitch them onto the tracks.
async function attachArtistImages(tracks, auth) {
  const ids = [...new Set(tracks.map((t) => t.artistId).filter(Boolean))];
  if (!ids.length) return;
  const byId = new Map();
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const res = await fetch(
      `https://api.spotify.com/v1/artists?ids=${chunk.join(",")}`,
      { headers: auth, cache: "no-store" },
    );
    if (!res.ok) continue;
    const d = await res.json();
    for (const a of d.artists || []) {
      if (!a) continue;
      const imgs = a.images || [];
      // smallest image is plenty for a ~20px avatar
      byId.set(a.id, imgs[imgs.length - 1]?.url || imgs[0]?.url || null);
    }
  }
  for (const t of tracks) {
    if (t.artistId) t.artistImage = byId.get(t.artistId) || null;
  }
}

export async function GET() {
  try {
    const token = await getAccessToken();
    if (!token) return Response.json({ tracks: [] });

    const auth = { Authorization: `Bearer ${token}` };
    let tracks = [];
    let mode = "top";

    // most played (already ordered by rank + unique)
    const top = await fetch(TOP_URL, { headers: auth, cache: "no-store" });
    if (top.ok) {
      const d = await top.json();
      tracks = (d.items || []).map(mapTrack).filter(Boolean);
    }

    // fall back to recently-played (deduped) until the top-read scope is granted
    if (!tracks.length) {
      mode = "recent";
      const recent = await fetch(RECENT_URL, { headers: auth, cache: "no-store" });
      if (recent.ok) {
        const d = await recent.json();
        const seen = new Set();
        for (const it of d.items || []) {
          const t = it.track;
          if (!t || seen.has(t.id)) continue;
          seen.add(t.id);
          tracks.push(mapTrack(t));
        }
      }
    }

    tracks = tracks.filter(Boolean);
    await attachArtistImages(tracks, auth);

    return Response.json(
      { tracks, mode },
      { headers: { "Cache-Control": "s-maxage=300, stale-while-revalidate=600" } },
    );
  } catch {
    return Response.json({ tracks: [] });
  }
}
