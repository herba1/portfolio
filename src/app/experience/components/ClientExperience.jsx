"use client";

import dynamic from "next/dynamic";

const ExperienceScene = dynamic(
  () => import("./ExperienceScene"),
  { ssr: false }
);

export default function ClientExperience() {
  return <ExperienceScene />;
}
