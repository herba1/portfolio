import { notFound } from "next/navigation";
import { unstable_cache } from "next/cache";

import { isProdView } from "@/lib/viewMode";
import { getRecentTracks } from "@/lib/spotifyRecent";

import manifest from "./experiment.json";
import QuadtreeExperience from "./QuadtreeExperience";

export const metadata = {
  title: "Quadtree",
  description: "Recently played covers kept as a quadtree of soft rounded tiles that sharpen under your pointer, fold back when you leave, and can be carved in for good.",
};

const FALLBACK_CARDS = [
  ["Honus Wagner", "T206 White Border, 1909"],
  ["Ty Cobb", "T206 White Border, 1909"],
  ["Christy Mathewson", "New York Giants, 1909"],
  ["Cy Young", "Cleveland Naps, 1909"],
  ["Walter Johnson", "Washington Nationals, 1909"],
  ["Nap Lajoie", "Cleveland Naps, 1909"],
  ["Tris Speaker", "Boston Red Sox, 1911"],
  ["Willie Keeler", "New York Highlanders, 1909"],
  ["Joe Tinker", "Chicago Cubs, 1909"],
  ["Babe Ruth", "Goudey Big League Chewing Gum, 1933"],
  ["Pud Galvin", "Old Judge, Pittsburgh, 1887"],
  ["King Kelly", "Old Judge, Boston, 1889"],
];

const FALLBACK_COVERS = FALLBACK_CARDS.map(([title, artist], index) => ({
  id: `card-${index + 1}`,
  title,
  artist,
  image: `/flyout/card-${String(index + 1).padStart(2, "0")}.jpg`,
}));

const loadCovers = unstable_cache(
  async () => {
    const { tracks } = await getRecentTracks();
    const seen = new Set();
    const covers = [];
    for (const track of tracks) {
      if (!track.image || seen.has(track.image)) continue;
      seen.add(track.image);
      covers.push({ id: track.id ?? track.image, title: track.title, artist: track.artist, image: track.imageLarge ?? track.image, durationMs: track.durationMs ?? null });
    }
    if (covers.length < 6) throw new Error("too few covers");
    return covers.slice(0, 24);
  },
  ["quadtree-covers"],
  { revalidate: 3600 },
);

export default async function QuadtreePage() {
  if (isProdView() && manifest.status !== "shipped") notFound();
  const covers = await loadCovers().catch(() => FALLBACK_COVERS);
  return <QuadtreeExperience covers={covers} />;
}
