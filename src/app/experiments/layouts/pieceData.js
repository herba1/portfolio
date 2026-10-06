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

const MAX_PER_ARTIST = 2;

function variedTracks(tracks) {
  const seenArt = new Set();
  const perArtist = new Map();
  return tracks.filter((track) => {
    if (track.image && seenArt.has(track.image)) return false;
    const artistKey = track.artistId ?? track.artist;
    const count = perArtist.get(artistKey) ?? 0;
    if (count >= MAX_PER_ARTIST) return false;
    perArtist.set(artistKey, count + 1);
    if (track.image) seenArt.add(track.image);
    return true;
  });
}

// Server-side props for pieces that need them, keyed by route.
export async function pieceData() {
  const { tracks: allTracks } = await cachedTracks().catch(() => ({ tracks: [] }));
  const tracks = variedTracks(allTracks);
  // Flyout's machinery collects songs on the index — the same top tracks.
  const covers = tracks.slice(0, 12);
  return { "/deck": { tracks }, "/flyout": { kit: "songs", tracks }, "/cover-ring": { covers }, "/ascii-cover": { covers } };
}
