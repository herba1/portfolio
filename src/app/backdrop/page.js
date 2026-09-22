import BackdropExperience from "./BackdropExperience";
import { ExperimentHeading, ExperimentJsonLd, experimentMetadata } from "@/app/experiments/seo";

export const metadata = experimentMetadata("/backdrop");

export default function BackdropPage() {
  return (
    <>
      <ExperimentJsonLd slug="/backdrop" />
      <ExperimentHeading slug="/backdrop" />
      <BackdropExperience />
    </>
  );
}
