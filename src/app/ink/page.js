import InkExperience from "./InkExperience";
import PieceBox from "@/app/experiments/PieceBox";
import { ExperimentJsonLd, experimentMetadata } from "@/app/experiments/seo";

export const metadata = experimentMetadata("/ink");

export default function InkPage() {
  return (
    <>
      <ExperimentJsonLd slug="/ink" />
      <PieceBox viewport>
        <InkExperience />
      </PieceBox>
    </>
  );
}
