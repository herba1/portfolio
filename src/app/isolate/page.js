import IsolateExperience from "./IsolateExperience";
import { pageMetadata } from "@/lib/seo";

// Reachable but unlisted (see DEV_LINKS in ui/Navigation/LINKS.js): kept out
// of search indexes until it earns a place in the nav.
export const metadata = pageMetadata({
  title: "Isolate",
  description: "The subject cut out of the scan and left standing on his own.",
  path: "/isolate",
  noindex: true,
});

export default function IsolatePage() {
  return <IsolateExperience />;
}
