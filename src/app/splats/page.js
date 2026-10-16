import { pageMetadata } from "@/lib/seo";
import { SPLATS } from "./data";
import SplatsIndex from "./SplatsIndex";

// Reachable but unlisted (see DEV_LINKS in ui/Navigation/LINKS.js) while the
// captures are borrowed placeholders.
export const metadata = pageMetadata({
  title: "Splats",
  description: "A carousel of Gaussian splat captures that fall into place, line up as you scroll, and fly into their own pages.",
  path: "/splats",
  noindex: true,
});

export default function SplatsPage() {
  return <SplatsIndex items={SPLATS} />;
}
