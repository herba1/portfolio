import HalftoneExperience from "./HalftoneExperience";
import { ExperimentJsonLd, experimentMetadata } from "@/app/experiments/seo";

export const metadata = experimentMetadata("/halftone");

export default function HalftonePage() {
  return (
    <>
      <ExperimentJsonLd slug="/halftone" />
      <HalftoneExperience />
    </>
  );
}
