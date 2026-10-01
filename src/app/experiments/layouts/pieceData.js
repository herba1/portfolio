import { getRecentTracks } from "@/lib/spotifyRecent";

// Server-side props for pieces that need them, keyed by route.
export async function pieceData() {
  const { tracks } = await getRecentTracks();
  // PSA's machinery collects songs on the index — the same top tracks.
  return { "/deck": { tracks }, "/psa": { kit: "songs", tracks } };
}
