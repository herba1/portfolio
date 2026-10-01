import HalftoneExperience from "./HalftoneExperience";
import PieceBox from "@/app/experiments/PieceBox";
import { ExperimentJsonLd, experimentMetadata } from "@/app/experiments/seo";

export const metadata = experimentMetadata("/halftone");

export default function HalftonePage() {
  return (
    <>
      <ExperimentJsonLd slug="/halftone" />
      <PieceBox viewport>
        <HalftoneExperience />
      </PieceBox>
    </>
  );
}
