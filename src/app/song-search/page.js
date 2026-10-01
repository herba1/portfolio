import SongSearch from "./SongSearch";
import PieceBox from "@/app/experiments/PieceBox";
import { ExperimentHeading, ExperimentJsonLd, experimentMetadata } from "@/app/experiments/seo";

export const metadata = experimentMetadata("/song-search");

export default function SongSearchPage() {
  return (
    <>
      <ExperimentJsonLd slug="/song-search" />
      <ExperimentHeading slug="/song-search" />
      <PieceBox viewport>
        <SongSearch />
      </PieceBox>
    </>
  );
}
