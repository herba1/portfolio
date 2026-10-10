import { unstable_cache } from "next/cache";

import { getRecentTracks } from "@/lib/spotifyRecent";
import PieceBox from "@/app/experiments/PieceBox";
import { ExperimentHeading, ExperimentJsonLd, experimentMetadata } from "@/app/experiments/seo";

import StirExperience from "./StirExperience";
import { MAX_TRACKS } from "./stirTracks";

export const metadata = experimentMetadata("/stir");

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
      tracks.push({ title: track.title, artist: track.artist, durationMs: track.durationMs ?? null, image: track.image ?? null });
    }
    return tracks.slice(0, MAX_TRACKS);
  },
  ["stir-tracks"],
  { revalidate: 3600 },
);

export default async function StirPage() {
  const tracks = await loadTracks().catch(() => []);
  return (
    <>
      <ExperimentJsonLd slug="/stir" />
      <ExperimentHeading slug="/stir" />
      <PieceBox viewport>
        <StirExperience recent={tracks} />
      </PieceBox>
    </>
  );
}
