import LiveStatCardsBdecExperience from "./LiveStatCardsBdecExperience";
import { notFound } from "next/navigation";

import { isProdView } from "@/lib/viewMode";

import manifest from "./experiment.json";

export const metadata = {
  title: "Live stat cards",
  description: "A row of stat cards with sparklines, deltas coloured by direction, numbers that tick live in tabular figures, and a hover that reveals the last 7 points.",
};

export default function LiveStatCardsBdecPage() {
  if (isProdView() && manifest.status !== "shipped") notFound();
  return <LiveStatCardsBdecExperience />;
}
