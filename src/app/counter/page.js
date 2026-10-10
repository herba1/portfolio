import { unstable_cache } from "next/cache";

import { getRecentTracks } from "@/lib/spotifyRecent";
import PieceBox from "@/app/experiments/PieceBox";
import { ExperimentHeading, ExperimentJsonLd, experimentMetadata } from "@/app/experiments/seo";

import CounterExperience from "./CounterExperience";
import { FALLBACK_TRACKS } from "./counterTracks";

export const metadata = experimentMetadata("/counter");

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
  const covers = await loadCovers().catch(() => FALLBACK_TRACKS);
  return (
    <>
      <ExperimentJsonLd slug="/counter" />
      <ExperimentHeading slug="/counter" />
      <PieceBox viewport>
        <CounterExperience covers={covers} />
      </PieceBox>
    </>
  );
}
