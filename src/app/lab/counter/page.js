import { notFound } from "next/navigation";
import { unstable_cache } from "next/cache";

import { isProdView } from "@/lib/viewMode";
import { getRecentTracks } from "@/lib/spotifyRecent";

import manifest from "./experiment.json";
import CounterExperience from "./CounterExperience";
import { FALLBACK_TRACKS } from "./counterTracks";

export const metadata = {
  title: "Counter",
  description: "Song titles set huge, each one hiding the next song inside the hole of its o — scroll, pinch or click to fall through.",
};

const loadCovers = unstable_cache(
  async () => {
    const { tracks } = await getRecentTracks();
    const seen = new Set();
    const covers = [];
    for (const track of tracks) {
      if (!track.image || seen.has(track.image)) continue;
      seen.add(track.image);
      covers.push({ id: track.id ?? track.image, title: track.title, artist: track.artist, image: track.image, durationMs: track.durationMs ?? null });
    }
    if (covers.length < 6) throw new Error("too few covers");
    return covers.slice(0, 24);
  },
  ["counter-covers"],
  { revalidate: 3600 },
);

export default async function CounterPage() {
  if (isProdView() && manifest.status !== "shipped") notFound();
  const covers = await loadCovers().catch(() => FALLBACK_TRACKS);
  return <CounterExperience covers={covers} />;
}
