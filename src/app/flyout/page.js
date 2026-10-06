import PreloadScans from "./PreloadScans";
import FlyoutExperience from "./FlyoutExperience";
import PieceBox from "@/app/experiments/PieceBox";
import { ExperimentHeading, ExperimentJsonLd, experimentMetadata } from "@/app/experiments/seo";

export const metadata = experimentMetadata("/flyout");

export default function FlyoutPage() {
  return (
    <>
      <ExperimentJsonLd slug="/flyout" />
      <ExperimentHeading slug="/flyout" />
      <PreloadScans />
      <PieceBox viewport className="flyout-page">
        <FlyoutExperience />
      </PieceBox>
    </>
  );
}
