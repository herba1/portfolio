import { geist } from "./fonts";
import TempPage from "./ui/Hero/TempPage";
import ClientSplatSection from "./experience/components/ClientSplatSection";
import HomeIntro from "./ui/HomeIntro";
import { defaultTitle, description } from "./constants";
import { pageMetadata } from "@/lib/seo";
import { ID, JsonLd, graph, webPageNode } from "@/lib/jsonld";

export const metadata = pageMetadata({
  title: defaultTitle,
  absoluteTitle: true,
  description,
  path: "/",
  // The hand-made site card, not a generated one.
  image: {
    url: "/opengraph-image.png",
    width: 1200,
    height: 630,
    alt: "herb.art — Herbart Hernandez, design engineer and creative developer building interactive web experiences",
    type: "image/png",
  },
  type: "profile",
  openGraph: { firstName: "Herbart", lastName: "Hernandez", username: "herb_dev" },
});

const homeLd = graph(
  webPageNode({
    path: "/",
    name: defaultTitle,
    description,
    image: "/opengraph-image.png",
    extra: { about: { "@id": ID.person }, mainEntity: { "@id": ID.person } },
  }),
);

export default function Home() {
  return (
    <main
      id="content"
      className={`bg-surface ${geist.className} relative`}
    >
      <JsonLd data={homeLd} />
      {/* Hero — full viewport */}
      <div className="h-svh">
        <TempPage />
      </div>
      {/* Splat — scrolls in below hero */}
      <ClientSplatSection />
      {/* Who this is, in words — the one part of the page a crawler or an
          assistant can read without running the hero or the splat. */}
      <HomeIntro />
    </main>
  );
}
