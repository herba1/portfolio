import CopierExperience from "./CopierExperience";
import { notFound } from "next/navigation";

import { isProdView } from "@/lib/viewMode";

import manifest from "./experiment.json";

export const metadata = {
  title: "Copier",
  description: "A photocopier's light bar sweeps the glass, and whatever you do to the picture while it passes is printed into the copy. Feed the copy back in and every generation loses a little more to the toner.",
};

export default function CopierPage() {
  if (isProdView() && manifest.status !== "shipped") notFound();
  return <CopierExperience />;
}
