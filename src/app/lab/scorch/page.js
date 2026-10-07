import { notFound } from "next/navigation";
import { unstable_cache } from "next/cache";

import { isProdView } from "@/lib/viewMode";
import { getRecentTracks } from "@/lib/spotifyRecent";
import { CARDS } from "@/app/flyout/cards";

import manifest from "./experiment.json";
import ScorchExperience from "./ScorchExperience";

export const metadata = {
  title: "Scorch",
  description: "Hold your finger on an album cover until it catches: a glowing char line creeps outward, racing along the dark ink like a fuse, and burns through to the next cover underneath.",
};

const FALLBACK_COVERS = CARDS.map((card) => ({
  id: card.id,
  title: card.player,
  artist: `${card.year} ${card.set}`,
  image: card.image,
}));

const loadCovers = unstable_cache(
  async () => {
    const { tracks } = await getRecentTracks();
    const seen = new Set();
    const covers = [];
    for (const track of tracks) {
      const image = track.imageLarge ?? track.image;
      if (!image || seen.has(image)) continue;
      seen.add(image);
      covers.push({ id: track.id ?? image, title: track.title, artist: track.artist, image, durationMs: track.durationMs ?? null });
    }
    if (covers.length < 6) throw new Error("too few covers");
    return covers.slice(0, 24);
  },
  ["scorch-covers-large"],
  { revalidate: 3600 },
);

export default async function ScorchPage() {
  if (isProdView() && manifest.status !== "shipped") notFound();
  const covers = await loadCovers().catch(() => FALLBACK_COVERS);
  return <ScorchExperience covers={covers} />;
}
