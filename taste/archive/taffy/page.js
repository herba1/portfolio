import { notFound } from "next/navigation";
import { unstable_cache } from "next/cache";

import { isProdView } from "@/lib/viewMode";
import { getRecentTracks } from "@/lib/spotifyRecent";
import PieceBox from "@/app/experiments/PieceBox";

import manifest from "./experiment.json";
import TaffyExperience from "./TaffyExperience";

export const metadata = {
  title: "Taffy",
  description: "Grab any letter of a giant song title and pull: it stretches out of the word on strands of ink that thin until they snap, and then it settles home. Drop it on another letter and the two stay joined by a sagging ink bridge.",
};

const FALLBACK_COVERS = Array.from({ length: 12 }, (_, index) => ({
  id: `card-${index + 1}`,
  title: `Card ${String(index + 1).padStart(2, "0")}`,
  artist: "Local scans",
  image: `/flyout/card-${String(index + 1).padStart(2, "0")}.jpg`,
}));

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
  ["taffy-covers"],
  { revalidate: 3600 },
);

export default async function TaffyPage() {
  if (isProdView() && manifest.status !== "shipped") notFound();
  const covers = await loadCovers().catch(() => FALLBACK_COVERS);
  return (
    <PieceBox viewport>
      <TaffyExperience covers={covers} />
    </PieceBox>
  );
}
