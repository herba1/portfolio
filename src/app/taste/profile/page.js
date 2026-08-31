import { notFound } from "next/navigation";

import { isProdView } from "@/lib/viewMode";
import { EXPERIMENTS } from "@/app/experiments/list";

import TasteProfile from "./TasteProfile";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Taste profile",
  robots: { index: false, follow: false },
};

export default function TasteProfilePage() {
  if (isProdView()) notFound();
  return <TasteProfile existing={EXPERIMENTS.map((e) => ({ slug: e.slug, title: e.title }))} />;
}
