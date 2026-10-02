import { unstable_cache } from "next/cache";
import { getRecentTracks } from "@/lib/spotifyRecent";

/* The Spotify read, cached for an hour. Uncached it is three sequential round
   trips (token, top tracks, artist images) on every request, and the page's
   first byte waits for all of them. An empty result throws inside the cache
   so it is never stored — a Spotify blip costs one request its covers, not
   the next hour's. */
const cachedTracks = unstable_cache(
  async () => {
    const result = await getRecentTracks();
    if (!result.tracks.length) throw new Error("no tracks");
    return result;
  },
  ["experiments-recent-tracks"],
  { revalidate: 3600 },
);

// Server-side props for pieces that need them, keyed by route.
export async function pieceData() {
  const { tracks } = await cachedTracks().catch(() => ({ tracks: [] }));
  // PSA's machinery collects songs on the index — the same top tracks.
  return { "/deck": { tracks }, "/psa": { kit: "songs", tracks } };
}
