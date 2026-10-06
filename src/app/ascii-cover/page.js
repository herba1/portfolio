import { getRecentTracks } from "@/lib/spotifyRecent";
import AsciiCover from "./AsciiCover";
import PieceBox from "@/app/experiments/PieceBox";
import { ExperimentHeading, ExperimentJsonLd, experimentMetadata } from "@/app/experiments/seo";

export const metadata = experimentMetadata("/ascii-cover");

export default async function AsciiCoverPage() {
  const { tracks } = await getRecentTracks();
  const covers = [...new Map(tracks.map((track) => [track.image, track])).values()].slice(0, 12);
  return (
    <>
      <ExperimentJsonLd slug="/ascii-cover" />
      <ExperimentHeading slug="/ascii-cover" />
      <PieceBox viewport>
        <AsciiCover covers={covers} />
      </PieceBox>
    </>
  );
}
