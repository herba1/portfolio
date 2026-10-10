import { notFound } from "next/navigation";

import { isProdView } from "@/lib/viewMode";

import manifest from "./experiment.json";
import OneLineExperience from "./OneLineExperience";

export const metadata = {
  title: "One line",
  description: "A tab bar drawn with a single pen line that pulls out of one icon, runs along the bar and threads itself into the next.",
};

export default function OneLinePage() {
  if (isProdView() && manifest.status !== "shipped") notFound();
  return <OneLineExperience />;
}
