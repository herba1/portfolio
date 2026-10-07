import { notFound } from "next/navigation";
import { unstable_cache } from "next/cache";

import { isProdView } from "@/lib/viewMode";
import { getRecentTracks } from "@/lib/spotifyRecent";

import manifest from "./experiment.json";
import MarbleExperience from "./MarbleExperience";

export const metadata = {
  title: "Marble",
  description: "This week's records dropped on water like marbling ink, combed into feathers you can drag back.",
};

const FALLBACK_COVERS = Array.from({ length: 12 }, (_, index) => ({
  id: `card-${index + 1}`,
  title: `Card ${String(index + 1).padStart(2, "0")}`,
  artist: "Local scans",
  image: `/flyout/card-${String(index + 1).padStart(2, "0")}.jpg`,
}));

const loadCovers = unstable_cache(
  async () => {
    const { tracks } = await getRecentTracks();
    const seen = new Set();
    const covers = [];
    for (const track of tracks) {
      const image = track.imageLarge || track.image;
      if (!image || seen.has(image)) continue;
      seen.add(image);
      covers.push({ id: track.id ?? image, title: track.title, artist: track.artist, image, durationMs: track.durationMs ?? null });
    }
    if (covers.length < 6) throw new Error("too few covers");
    return covers.slice(0, 24);
  },
  ["marble-covers-large"],
  { revalidate: 3600 },
);

export default async function MarblePage() {
  if (isProdView() && manifest.status !== "shipped") notFound();
  const covers = await loadCovers().catch(() => FALLBACK_COVERS);
  return <MarbleExperience covers={covers} />;
}
