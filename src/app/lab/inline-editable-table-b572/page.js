import InlineEditableTableB572Experience from "./InlineEditableTableB572Experience";
import { notFound } from "next/navigation";

import { isProdView } from "@/lib/viewMode";

import manifest from "./experiment.json";

export const metadata = {
  title: "Inline-editable table",
  description: "A data table where cells edit in place, Tab and arrows move focus, edits show a pending state then commit, with an undo toast that counts down.",
};

export default function InlineEditableTableB572Page() {
  if (isProdView() && manifest.status !== "shipped") notFound();
  return <InlineEditableTableB572Experience />;
}
