import AskMeWhy from "./AskMeWhy";
import { pageMetadata } from "@/lib/seo";

// Reachable but unlisted (see DEV_LINKS in ui/Navigation/LINKS.js), and its
// audio lives outside the public deploy: kept out of search indexes.
export const metadata = pageMetadata({
  title: "Ask Me Why",
  description: "Voice-annotated lyrics — lead and backing vocals rendered as separate parts.",
  path: "/ask-me-why",
  noindex: true,
});

export default function AskMeWhyPage() {
  return <AskMeWhy />;
}
