import { getRecentTracks } from "@/lib/spotifyRecent";

// Server-side props for pieces that need them, keyed by route.
export async function pieceData() {
  const { tracks } = await getRecentTracks();
  return { "/deck": { tracks } };
}
