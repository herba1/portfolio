import PreloadScans from "./PreloadScans";
import PsaExperience from "./PsaExperience";
import { ExperimentHeading, ExperimentJsonLd, experimentMetadata } from "@/app/experiments/seo";

export const metadata = experimentMetadata("/psa");

export default function PsaPage() {
  return (
    <>
      <ExperimentJsonLd slug="/psa" />
      <ExperimentHeading slug="/psa" />
      <PreloadScans />
      <PsaExperience />
    </>
  );
}
