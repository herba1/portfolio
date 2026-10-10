import { notFound } from "next/navigation";
import { unstable_cache } from "next/cache";

import { isProdView } from "@/lib/viewMode";
import { getRecentTracks } from "@/lib/spotifyRecent";

import manifest from "./experiment.json";
import StirExperience from "./StirExperience";

export const metadata = {
  title: "Stir",
  description: "A wall of Herb's tracklist woven into endless rows that drift as one cloth, where bold is a fluid: drag through it and weight, tinted by each song's cover, swirls through the letters and rides away with them.",
};

const MAX_TRACKS = 40;
const SPOTIFY_COVER_300 = "ab67616d00001e02";
const SPOTIFY_COVER_64 = "ab67616d00004851";

function coverThumb(url) {
  if (!url || !url.includes(SPOTIFY_COVER_300)) return url ?? null;
  return url.replace(SPOTIFY_COVER_300, SPOTIFY_COVER_64);
}

const loadTracks = unstable_cache(
  async () => {
    const { tracks: recent } = await getRecentTracks();
    const seen = new Set();
    const tracks = [];
    for (const track of recent ?? []) {
      if (!track?.title || !track.artist) continue;
      const key = track.id ?? `${track.title}|${track.artist}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      tracks.push({ title: track.title, artist: track.artist, durationMs: track.durationMs ?? null, image: coverThumb(track.image), imageFallback: track.image ?? null });
    }
    return tracks.slice(0, MAX_TRACKS);
  },
  ["stir-tracks-cover-thumbs"],
  { revalidate: 3600 },
);

export default async function StirPage() {
  if (isProdView() && manifest.status !== "shipped") notFound();
  const tracks = await loadTracks().catch(() => []);
  return <StirExperience recent={tracks} />;
}
