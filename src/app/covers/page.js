import { preconnect, preload } from "react-dom";
import Covers from "./Covers";
import { getCachedRecentTracks } from "@/lib/spotifyRecent";
import { COUNT, GRID_COLS, GRID_ROWS } from "./lib/config";
import { pageMetadata } from "@/lib/seo";
import { JsonLd, breadcrumbNode, graph, webPageNode } from "@/lib/jsonld";

const title = "Top Songs";
const description =
  "An infinite, spring-driven grid of album covers from Herb's recent listening. Scroll forever, open a cover to hear a preview.";

export const metadata = pageMetadata({ title, description, path: "/covers" });

const coversLd = graph(
  webPageNode({ path: "/covers", name: title, description, breadcrumb: true }),
  breadcrumbNode([
    { name: "herb.art", path: "/" },
    { name: title, path: "/covers" },
  ]),
);

const mod = (n, m) => ((n % m) + m) % m;
const FIRST_VIEW = [-1, 0, 1].flatMap((row) =>
  [-2, -1, 0, 1, 2].map((col) => (mod(row, GRID_ROWS) * GRID_COLS + mod(col, GRID_COLS)) % COUNT),
);

export default async function Page() {
  const { tracks, mode } = await getCachedRecentTracks();
  if (tracks.length) {
    preconnect("https://i.scdn.co", { crossOrigin: "anonymous" });
    for (const index of new Set(FIRST_VIEW)) {
      const image = tracks[index % tracks.length]?.image;
      if (image) preload(image, { as: "image", crossOrigin: "anonymous", fetchPriority: "high" });
    }
  }
  return (
    <>
      <JsonLd data={coversLd} />
      {/* The grid is the whole page and draws no heading of its own; this
          gives screen readers and crawlers the page's name and what it is,
          matching the <title> and description exactly. */}
      <h1 className="sr-only">{title}</h1>
      <p className="sr-only">{description}</p>
      <Covers initialTracks={tracks.length ? tracks : null} initialMode={mode} />
    </>
  );
}
