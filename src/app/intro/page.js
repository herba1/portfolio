import IntroExperience from "./IntroExperience";
import { pageMetadata } from "@/lib/seo";

// Reachable but unlisted (see DEV_LINKS in ui/Navigation/LINKS.js): kept out
// of search indexes until it earns a place in the nav.
export const metadata = pageMetadata({
  title: "Intro",
  description:
    "A reusable gravity-field engine — objects fall in under real physics, rendered as emojis or Gaussian splats. Tune every knob; the URL is shareable.",
  path: "/intro",
  noindex: true,
});

export default function IntroPage() {
  return <IntroExperience />;
}
