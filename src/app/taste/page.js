import { notFound } from "next/navigation";

import { isProdView } from "@/lib/viewMode";
import { currentTasteVersion } from "@/lib/taste/store";

import TasteDeck from "./TasteDeck";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Taste",
  robots: { index: false, follow: false },
};

export default async function TastePage() {
  if (isProdView()) notFound();
  const tasteVersion = await currentTasteVersion();
  return <TasteDeck tasteVersion={tasteVersion} />;
}
