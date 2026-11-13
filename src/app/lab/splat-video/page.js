import SplatVideoExperience from "./SplatVideoExperience";
import { notFound } from "next/navigation";

import PieceBox from "@/app/experiments/PieceBox";

import { isProdView } from "@/lib/viewMode";

import manifest from "./experiment.json";

export const metadata = {
  title: "Splat video",
  description: "A still-camera clip turned into moving Gaussian splats that play like the video while you nudge the camera around them.",
};

export default function SplatVideoPage() {
  if (isProdView() && manifest.status !== "shipped") notFound();
  return (
    <PieceBox viewport className="splat-video-page">
      <SplatVideoExperience />
    </PieceBox>
  );
}
