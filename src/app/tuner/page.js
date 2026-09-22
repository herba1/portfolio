import TunerExperience from "./TunerExperience";
import { ExperimentHeading, ExperimentJsonLd, experimentMetadata } from "@/app/experiments/seo";

export const metadata = experimentMetadata("/tuner");

export default function TunerPage() {
  return (
    <>
      <ExperimentJsonLd slug="/tuner" />
      <ExperimentHeading slug="/tuner" />
      <TunerExperience />
    </>
  );
}
