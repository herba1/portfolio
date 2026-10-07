import TapeExperience from "./TapeExperience";
import { notFound } from "next/navigation";

import { isProdView } from "@/lib/viewMode";

import manifest from "./experiment.json";

export const metadata = {
  title: "Tape",
  description: "Ask Me Why printed as a strip of ink spectrogram with its words set on the paper. Grab it and the song plays under your hand at the speed you pull.",
};

export default function TapePage() {
  if (isProdView() && manifest.status !== "shipped") notFound();
  return <TapeExperience />;
}
