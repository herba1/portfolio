import WetInkExperience from "./WetInkExperience";
import PieceBox from "@/app/experiments/PieceBox";
import { ExperimentHeading, ExperimentJsonLd, experimentMetadata } from "@/app/experiments/seo";

export const metadata = experimentMetadata("/wet-ink");

export default function WetInkPage() {
  return (
    <>
      <ExperimentJsonLd slug="/wet-ink" />
      <ExperimentHeading slug="/wet-ink" />
      <PieceBox viewport>
        <WetInkExperience />
      </PieceBox>
    </>
  );
}
