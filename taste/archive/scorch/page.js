import { notFound } from "next/navigation";

import { isProdView } from "@/lib/viewMode";

import manifest from "./experiment.json";
import ScorchExperience from "./ScorchExperience";

export const metadata = {
  title: "Scorch",
  description: "Press and drag to burn a stack of photographic prints, an alpine valley, a wildflower meadow, light beams at night and more: the darkest parts of each photo catch first like a fuse, and any piece you cut free of the top edge drops away on its own, curling as it falls.",
};

export default function ScorchPage() {
  if (isProdView() && manifest.status !== "shipped") notFound();
  return <ScorchExperience />;
}
