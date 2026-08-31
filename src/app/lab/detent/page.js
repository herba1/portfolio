import DetentExperience from "./DetentExperience";
import { notFound } from "next/navigation";

import { isProdView } from "@/lib/viewMode";

import manifest from "./experiment.json";

export const metadata = {
  title: "A tactile rotary dial: one large knob you drag around in a c",
  description: "A tactile rotary dial: one large knob you drag around in a circle, with detents you feel through easing, tick marks that light in sequence as the value rises, and a numeric readout in tabular figures.",
};

export default function DetentPage() {
  if (isProdView() && manifest.status !== "shipped") notFound();
  return <DetentExperience />;
}
