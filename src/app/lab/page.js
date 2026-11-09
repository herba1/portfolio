import { notFound } from "next/navigation";
import { isProdView } from "@/lib/viewMode";
import { LAB } from "./registry";
import LabIndex from "./LabIndex";

export const metadata = { title: "Lab" };

// Dev-only switcher over every lab piece, drafts included. Production builds
// 404 it, the same as the draft pieces themselves.
export default function Page() {
  if (isProdView()) notFound();
  const pieces = LAB.map(({ slug, title, description, tags, status, createdAt }) => ({
    slug,
    title,
    blurb: (description || "").split(/(?<=\.)\s/)[0],
    tags: tags || [],
    status,
    createdAt,
  })).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return <LabIndex pieces={pieces} />;
}
