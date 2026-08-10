import { isProdView } from "@/lib/viewMode";
import { getAccessToken } from "@/lib/spotifyRecent";

export async function GET(request) {
  if (isProdView()) return Response.json({ tracks: [] }, { status: 403 });

  const q = (new URL(request.url).searchParams.get("q") || "").trim();
  if (!q) return Response.json({ tracks: [] });

  const token = await getAccessToken();
  if (!token) return Response.json({ tracks: [] });

  const res = await fetch(
    `https://api.spotify.com/v1/search?${new URLSearchParams({
      q,
      type: "track",
      limit: "20",
      market: "US",
    })}`,
    { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
  );
  if (!res.ok) return Response.json({ tracks: [] });

  const data = await res.json();
  const tracks = (data.tracks?.items || []).map((t) => ({
    id: t.id,
    name: t.name,
    artist: (t.artists || []).map((a) => a.name).join(", "),
    album: t.album?.name || "",
    art: t.album?.images?.at(-1)?.url || null,
    isrc: t.external_ids?.isrc || null,
    durationSec: Math.round((t.duration_ms || 0) / 1000),
  }));

  return Response.json({ tracks });
}
