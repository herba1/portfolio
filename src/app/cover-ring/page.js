import { getRecentTracks } from "@/lib/spotifyRecent";
import CoverRing from "./CoverRing";
import PieceBox from "@/app/experiments/PieceBox";
import { ExperimentHeading, ExperimentJsonLd, experimentMetadata } from "@/app/experiments/seo";

export const metadata = experimentMetadata("/cover-ring");

export default async function CoverRingPage() {
  const { tracks } = await getRecentTracks();
  const covers = [...new Map(tracks.map((track) => [track.image, track])).values()].slice(0, 12);
  return (
    <>
      <ExperimentJsonLd slug="/cover-ring" />
      <ExperimentHeading slug="/cover-ring" />
      <PieceBox viewport>
        <CoverRing covers={covers} />
      </PieceBox>
    </>
  );
}
