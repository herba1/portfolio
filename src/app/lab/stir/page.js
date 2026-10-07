import { notFound } from "next/navigation";
import { unstable_cache } from "next/cache";

import { isProdView } from "@/lib/viewMode";
import { getRecentTracks } from "@/lib/spotifyRecent";

import manifest from "./experiment.json";
import StirExperience from "./StirExperience";

export const metadata = {
  title: "Stir",
  description: "A wall of Herb's tracklist where bold is a fluid: drag through it and weight swirls through the letters like ink in water.",
};

const MIN_TRACKS = 3;
const MAX_TRACKS = 40;

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
      tracks.push({ title: track.title, artist: track.artist, durationMs: track.durationMs ?? null });
    }
    if (tracks.length < MIN_TRACKS) throw new Error("too few tracks");
    return tracks.slice(0, MAX_TRACKS);
  },
  ["stir-tracks"],
  { revalidate: 3600 },
);

export default async function StirPage() {
  if (isProdView() && manifest.status !== "shipped") notFound();
  const tracks = await loadTracks().catch(() => []);
  return <StirExperience recent={tracks} />;
}
