import RefractExperience from "./RefractExperience";
import { ExperimentJsonLd, experimentMetadata } from "@/app/experiments/seo";

export const metadata = experimentMetadata("/refract");

export default function RefractPage() {
  return (
    <>
      <ExperimentJsonLd slug="/refract" />
      <RefractExperience />
    </>
  );
}
