import { notFound } from "next/navigation";
import { unstable_cache } from "next/cache";

import { isProdView } from "@/lib/viewMode";
import { getRecentTracks } from "@/lib/spotifyRecent";

import manifest from "./experiment.json";
import ChopExperience from "./ChopExperience";

export const metadata = {
  title: "Chop",
  description: "An album cover cut into sixteen pads, each holding its own beat of the song. Tap them in order and the song plays; tap them out of order and you've remixed it.",
};

const FALLBACK_SONGS = [
  ["I Want You Back", "The Jackson 5"],
  ["Superstition", "Stevie Wonder"],
  ["Le Freak", "Chic"],
  ["September", "Earth, Wind & Fire"],
  ["Cissy Strut", "The Meters"],
  ["Billie Jean", "Michael Jackson"],
  ["Lovely Day", "Bill Withers"],
  ["Be My Baby", "The Ronettes"],
];

const FALLBACK_COVERS = FALLBACK_SONGS.map(([title, artist], index) => {
  const image = `/flyout/card-${String(index + 1).padStart(2, "0")}.jpg`;
  return { id: `fallback-${index + 1}`, title, artist, image, imageLarge: image, durationMs: null };
});

const loadCovers = unstable_cache(
  async () => {
    const { tracks } = await getRecentTracks();
    const seen = new Set();
    const covers = [];
    for (const track of tracks) {
      if (!track.image || seen.has(track.image)) continue;
      seen.add(track.image);
      covers.push({ id: track.id ?? track.image, title: track.title, artist: track.artist, image: track.image, imageLarge: track.imageLarge ?? track.image, durationMs: track.durationMs ?? null });
    }
    if (covers.length < 6) throw new Error("too few covers");
    return covers.slice(0, 24);
  },
  ["chop-covers-large"],
  { revalidate: 3600 },
);

export default async function ChopPage() {
  if (isProdView() && manifest.status !== "shipped") notFound();
  const covers = await loadCovers().catch(() => FALLBACK_COVERS);
  return <ChopExperience covers={covers} />;
}
