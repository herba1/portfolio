import { notFound } from "next/navigation";
import { unstable_cache } from "next/cache";

import { isProdView } from "@/lib/viewMode";
import { getRecentTracks } from "@/lib/spotifyRecent";

import manifest from "./experiment.json";
import StrumExperience from "./StrumExperience";
import { PLEASE_PLEASE_ME, cleanTitle } from "./strumScale";

export const metadata = {
  title: "Strum",
  description: "A type scale strung like a harp: every size is a string set with a song title, and the ratio between sizes is the chord you hear when you sweep across them.",
};

const MIN_TITLES = 4;
const MAX_TITLES = 24;

const FALLBACK_COVERS = PLEASE_PLEASE_ME.map((title) => ({ title }));

const loadCovers = unstable_cache(
  async () => {
    const { tracks } = await getRecentTracks();
    const seen = new Set();
    const covers = [];
    for (const track of tracks) {
      const title = cleanTitle(track.title);
      const key = title.toLowerCase();
      if (!title || seen.has(key)) continue;
      seen.add(key);
      covers.push({ title });
      if (covers.length === MAX_TITLES) break;
    }
    if (covers.length < MIN_TITLES) throw new Error("too few titles");
    return covers;
  },
  ["strum-titles"],
  { revalidate: 3600 },
);

export default async function StrumPage() {
  if (isProdView() && manifest.status !== "shipped") notFound();
  const covers = await loadCovers().catch(() => FALLBACK_COVERS);
  return <StrumExperience covers={covers} />;
}
