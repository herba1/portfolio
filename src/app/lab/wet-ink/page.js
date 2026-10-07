import WetInkExperience from "./WetInkExperience";
import { notFound } from "next/navigation";

import { isProdView } from "@/lib/viewMode";

import manifest from "./experiment.json";

export const metadata = {
  title: "Wet ink",
  description: "A booking form's signature field where your name goes down as real wet ink: it pools where you pause, feathers out along the paper fibres and dries darker at its edges.",
};

export default function WetInkPage() {
  if (isProdView() && manifest.status !== "shipped") notFound();
  return <WetInkExperience />;
}
