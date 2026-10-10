import PieceBox from "@/app/experiments/PieceBox";
import { ExperimentHeading, ExperimentJsonLd, experimentMetadata } from "@/app/experiments/seo";

import ScorchExperience from "./ScorchExperience";

export const metadata = experimentMetadata("/scorch");

export default function ScorchPage() {
  return (
    <>
      <ExperimentJsonLd slug="/scorch" />
      <ExperimentHeading slug="/scorch" />
      <PieceBox viewport>
        <ScorchExperience />
      </PieceBox>
    </>
  );
}
