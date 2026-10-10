import { notFound } from "next/navigation";
import { unstable_cache } from "next/cache";

import { isProdView } from "@/lib/viewMode";
import { getRecentTracks } from "@/lib/spotifyRecent";

import manifest from "./experiment.json";
import TearOffExperience from "./TearOffExperience";

export const metadata = {
  title: "Tear-off",
  description: "A roll of ticket stubs printed with Herb's recently played songs. Twist one and the perforation unzips hole by hole, yank it and it snaps clean, then feed the stub into the reader to hear it.",
};

const FALLBACK_TITLES = [
  "I Saw Her Standing There",
  "Misery",
  "Anna (Go to Him)",
  "Chains",
  "Boys",
  "Ask Me Why",
  "Please Please Me",
  "Love Me Do",
  "P.S. I Love You",
  "Baby It's You",
  "Do You Want to Know a Secret",
  "A Taste of Honey",
];

const FALLBACK_COVERS = FALLBACK_TITLES.map((title, index) => ({
  id: `card-${index + 1}`,
  title,
  artist: "The Beatles",
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
      covers.push({ id: track.id ?? track.image, title: track.title, artist: track.artist, image: track.image, durationMs: track.durationMs ?? null });
    }
    if (covers.length < 6) throw new Error("too few covers");
    return covers.slice(0, 24);
  },
  ["tear-off-covers"],
  { revalidate: 3600 },
);

export default async function TearOffPage() {
  if (isProdView() && manifest.status !== "shipped") notFound();
  const covers = await loadCovers().catch(() => FALLBACK_COVERS);
  return <TearOffExperience covers={covers} />;
}
