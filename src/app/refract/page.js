import RefractExperience from "./RefractExperience";
import PieceBox from "@/app/experiments/PieceBox";
import { ExperimentJsonLd, experimentMetadata } from "@/app/experiments/seo";

export const metadata = experimentMetadata("/refract");

export default function RefractPage() {
  return (
    <>
      <ExperimentJsonLd slug="/refract" />
      <PieceBox viewport>
        <RefractExperience />
      </PieceBox>
    </>
  );
}
