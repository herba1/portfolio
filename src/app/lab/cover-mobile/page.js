import { notFound } from "next/navigation";
import { unstable_cache } from "next/cache";

import { isProdView } from "@/lib/viewMode";
import { getRecentTracks } from "@/lib/spotifyRecent";

import manifest from "./experiment.json";
import CoverMobileExperience from "./CoverMobileExperience";

export const metadata = {
  title: "Mobile",
  description:
    "A Calder mobile hung with Herb's recent album covers: pull any cover down and the whole cascade tips, sways and slowly finds its balance again.",
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
      covers.push({
        id: track.id ?? track.image,
        title: track.title,
        artist: track.artist,
        image: track.image,
        durationMs: track.durationMs ?? null,
      });
    }
    if (covers.length < 6) throw new Error("too few covers");
    return covers.slice(0, 24);
  },
  ["cover-mobile-covers"],
  { revalidate: 3600 },
);

export default async function CoverMobilePage() {
  if (isProdView() && manifest.status !== "shipped") notFound();
  const covers = await loadCovers().catch(() => FALLBACK_COVERS);
  return <CoverMobileExperience covers={covers} />;
}
