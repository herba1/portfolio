import { notFound } from "next/navigation";
import { unstable_cache } from "next/cache";

import { isProdView } from "@/lib/viewMode";
import { getRecentTracks } from "@/lib/spotifyRecent";

import manifest from "./experiment.json";
import LoomExperience from "./LoomExperience";

export const metadata = {
  title: "Loom",
  description: "An album cover woven from 96 threads each way — pull a thread and its strip of the picture slides like a slot reel, the cloth ripples, and it plucks a note as it springs home.",
};

const FALLBACK_CARDS = [
  ["Honus Wagner", "T206 White Border, American Tobacco Company"],
  ["Ty Cobb", "T206 White Border, American Tobacco Company"],
  ["Christy Mathewson", "American Tobacco Company, 1909"],
  ["Cy Young", "American Tobacco Company, 1909"],
  ["Walter Johnson", "American Tobacco Company, 1909"],
  ["Nap Lajoie", "American Tobacco Company, 1909"],
  ["Tris Speaker", "American Tobacco Company, 1911"],
  ["Willie Keeler", "American Tobacco Company, 1909"],
  ["Joe Tinker", "American Tobacco Company, 1909"],
  ["Babe Ruth", "Goudey Gum Company, 1933"],
  ["Pud Galvin", "Old Judge Cigarettes, 1887"],
  ["King Kelly", "Old Judge Cigarettes, 1889"],
];

const FALLBACK_COVERS = FALLBACK_CARDS.map(([title, artist], index) => ({
  id: `card-${index + 1}`,
  title,
  artist,
  image: `/flyout/card-${String(index + 1).padStart(2, "0")}.jpg`,
  durationMs: null,
}));

const loadCovers = unstable_cache(
  async () => {
    const { tracks } = await getRecentTracks();
    const seen = new Set();
    const covers = [];
    for (const track of tracks) {
      if (!track.image || seen.has(track.image)) continue;
      seen.add(track.image);
      covers.push({
        id: track.id ?? track.image,
        title: track.title,
        artist: track.artist,
        image: track.imageLarge ?? track.image,
        thumb: track.image,
        durationMs: track.durationMs ?? null,
      });
    }
    if (covers.length < 6) throw new Error("too few covers");
    return covers.slice(0, 24);
  },
  ["loom-covers-large"],
  { revalidate: 3600 },
);

export default async function LoomPage() {
  if (isProdView() && manifest.status !== "shipped") notFound();
  const covers = await loadCovers().catch(() => FALLBACK_COVERS);
  return <LoomExperience covers={covers} />;
}
