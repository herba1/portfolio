import { unstable_cache } from "next/cache";

import { getRecentTracks } from "@/lib/spotifyRecent";
import OneLineExperience from "./OneLineExperience";
import { FALLBACK_TRACKS, toShelfTrack } from "./oneLineShelves";
import PieceBox from "@/app/experiments/PieceBox";
import { ExperimentJsonLd, experimentMetadata } from "@/app/experiments/seo";

export const metadata = experimentMetadata("/one-line");

const loadTracks = unstable_cache(
  async () => {
    const { tracks } = await getRecentTracks();
    const seen = new Set();
    const shelfTracks = [];
    for (const track of tracks) {
      if (!track.image || seen.has(track.image)) continue;
      seen.add(track.image);
      shelfTracks.push(toShelfTrack(track));
    }
    if (shelfTracks.length < 6) throw new Error("too few tracks");
    return shelfTracks.slice(0, 24);
  },
  ["one-line-tracks"],
  { revalidate: 3600 },
);

export default async function OneLinePage() {
  const tracks = await loadTracks().catch(() => FALLBACK_TRACKS);
  return (
    <>
      <ExperimentJsonLd slug="/one-line" />
      <PieceBox viewport>
        <OneLineExperience tracks={tracks} />
      </PieceBox>
    </>
  );
}
