"use client";

import dynamic from "next/dynamic";
import SplatErrorBoundary from "./SplatErrorBoundary";

const ExperienceScene = dynamic(
  () => import("./ExperienceScene"),
  { ssr: false }
);

export default function ClientExperience() {
  return (
    <SplatErrorBoundary>
      <ExperienceScene />
    </SplatErrorBoundary>
  );
}
