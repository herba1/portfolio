import BentoLayout from "./layouts/bento/page";
import { JsonLd, breadcrumbNode, graph, itemListNode, webPageNode } from "@/lib/jsonld";
import { PIECES } from "./layouts/pieces";
import "./layouts/layouts.css";

export const revalidate = 3600;

const indexLd = graph(
  webPageNode({
    path: "/experiments",
    name: "Experiments",
    description:
      "Interactive experiments by Herbart Hernandez: shader pieces, motion studies and instrument-like interfaces, each built around one mechanic and tunable in the browser.",
    type: "CollectionPage",
    breadcrumb: true,
    extra: {
      mainEntity: itemListNode(
        PIECES.map((piece) => ({ name: piece.title, path: piece.slug, description: piece.description })),
      ),
    },
  }),
  breadcrumbNode([
    { name: "herb.art", path: "/" },
    { name: "Experiments", path: "/experiments" },
  ]),
);

export default function ExperimentsIndex() {
  return (
    <div className="xl-root">
      <JsonLd data={indexLd} />
      <BentoLayout />
    </div>
  );
}
