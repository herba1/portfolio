import TapeExperience from "./TapeExperience";
import { notFound } from "next/navigation";

import { isProdView } from "@/lib/viewMode";

import manifest from "./experiment.json";

export const metadata = {
  title: "Tape",
  description: "Ask Me Why on a long ribbon of brown oxide tape running out of a reel-to-reel deck at the edge of the page. Grab the tape or rock the reel and the song plays under your hand at the speed you pull.",
};

export default function TapePage() {
  if (isProdView() && manifest.status !== "shipped") notFound();
  return <TapeExperience />;
}
