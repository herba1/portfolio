// GET /api/spotify/recent — owner's MOST-PLAYED tracks (Top Tracks), falling
// back to recently-played if the top-read scope isn't granted yet. Returns
// { tracks: [] } when unconfigured so the grid falls back to placeholders.
//
// The actual Spotify read lives in @/lib/spotifyRecent so server components
// (e.g. /deck) can call it without a round trip through this handler.

import { getRecentTracks } from "@/lib/spotifyRecent";

export async function GET() {
  const { tracks, mode } = await getRecentTracks();
  if (!tracks.length) return Response.json({ tracks: [] });

  return Response.json(
    { tracks, mode },
    { headers: { "Cache-Control": "s-maxage=300, stale-while-revalidate=600" } },
  );
}
