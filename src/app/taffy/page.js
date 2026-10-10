import { unstable_cache } from "next/cache";

import { getRecentTracks } from "@/lib/spotifyRecent";
import PieceBox from "@/app/experiments/PieceBox";
import { ExperimentHeading, ExperimentJsonLd, experimentMetadata } from "@/app/experiments/seo";

import TaffyExperience from "./TaffyExperience";

export const metadata = experimentMetadata("/taffy");

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
  const covers = await loadCovers().catch(() => FALLBACK_COVERS);
  return (
    <>
      <ExperimentJsonLd slug="/taffy" />
      <ExperimentHeading slug="/taffy" />
      <PieceBox viewport>
        <TaffyExperience covers={covers} />
      </PieceBox>
    </>
  );
}
