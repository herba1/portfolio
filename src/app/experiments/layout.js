import { pageMetadata } from "@/lib/seo";

// Indexed. Each experiment is a distinct interactive piece with its own
// title, description and structured data (see experiments/seo.js) — unique
// content, not thin duplicates — and this index is the only page that lists
// them all. Sandboxes under it (album-card) opt out in their own layout.
export const metadata = pageMetadata({
  title: "Experiments",
  description:
    "Interactive experiments by Herbart Hernandez: shader pieces, motion studies and instrument-like interfaces, each built around one mechanic and tunable in the browser.",
  path: "/experiments",
});

export default function ExperimentsLayout({ children }) {
  return children;
}
