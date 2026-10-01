import PreloadScans from "./PreloadScans";
import PsaExperience from "./PsaExperience";
import PieceBox from "@/app/experiments/PieceBox";
import { ExperimentHeading, ExperimentJsonLd, experimentMetadata } from "@/app/experiments/seo";

export const metadata = experimentMetadata("/psa");

export default function PsaPage() {
  return (
    <>
      <ExperimentJsonLd slug="/psa" />
      <ExperimentHeading slug="/psa" />
      <PreloadScans />
      <PieceBox viewport className="psa-page">
        <PsaExperience />
      </PieceBox>
    </>
  );
}
