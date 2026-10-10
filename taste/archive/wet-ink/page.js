import WetInkExperience from "./WetInkExperience";
import { notFound } from "next/navigation";

import { isProdView } from "@/lib/viewMode";

import manifest from "./experiment.json";

export const metadata = {
  title: "Wet ink",
  description: "A wet-ink brush that keeps drawing by itself: an ensō, bamboo, mountains, a wave, words. Each one pools, feathers along the paper fibres and dries darker at its edges before a wash of water rinses it off the sheet for the next. Take the brush whenever you like.",
};

export default function WetInkPage() {
  if (isProdView() && manifest.status !== "shipped") notFound();
  return <WetInkExperience />;
}
