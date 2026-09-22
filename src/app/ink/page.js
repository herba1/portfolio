import InkExperience from "./InkExperience";
import { ExperimentJsonLd, experimentMetadata } from "@/app/experiments/seo";

export const metadata = experimentMetadata("/ink");

export default function InkPage() {
  return (
    <>
      <ExperimentJsonLd slug="/ink" />
      <InkExperience />
    </>
  );
}
