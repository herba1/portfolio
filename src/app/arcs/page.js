import { notFound } from "next/navigation";

import { isProdView } from "@/lib/viewMode";
import ArcLab from "./ArcLab";

export const metadata = {
  title: "Arcs",
  description: "A visualiser for the save flight — the path, the bank, and where they disagree.",
  robots: { index: false, follow: false },
};

export default function ArcsPage() {
  if (isProdView()) notFound();
  return <ArcLab />;
}
