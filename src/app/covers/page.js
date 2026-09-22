import Covers from "./Covers";
import { pageMetadata } from "@/lib/seo";
import { JsonLd, breadcrumbNode, graph, webPageNode } from "@/lib/jsonld";

const title = "Top Songs";
const description =
  "An infinite, spring-driven grid of album covers from Herb's recent listening. Scroll forever, open a cover to hear a preview.";

export const metadata = pageMetadata({ title, description, path: "/covers" });

const coversLd = graph(
  webPageNode({ path: "/covers", name: title, description }),
  breadcrumbNode([
    { name: "herb.art", path: "/" },
    { name: title, path: "/covers" },
  ]),
);

export default function Page() {
  return (
    <>
      <JsonLd data={coversLd} />
      {/* The grid is the whole page and draws no heading of its own; this
          gives screen readers and crawlers the page's name and what it is,
          matching the <title> and description exactly. */}
      <h1 className="sr-only">{title}</h1>
      <p className="sr-only">{description}</p>
      <Covers />
    </>
  );
}
