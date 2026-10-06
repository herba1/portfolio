import BlobPiece from "./BlobPiece";
import PieceBox from "@/app/experiments/PieceBox";
import { ExperimentHeading, ExperimentJsonLd, experimentMetadata } from "@/app/experiments/seo";

export const metadata = experimentMetadata("/blobs");

export default function BlobsPage() {
  return (
    <>
      <ExperimentJsonLd slug="/blobs" />
      <ExperimentHeading slug="/blobs" />
      <PieceBox viewport>
        <BlobPiece />
      </PieceBox>
    </>
  );
}
