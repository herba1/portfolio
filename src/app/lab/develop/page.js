import { notFound } from "next/navigation";
import { unstable_cache } from "next/cache";

import { isProdView } from "@/lib/viewMode";
import { getRecentTracks } from "@/lib/spotifyRecent";

import manifest from "./experiment.json";
import DevelopExperience from "./DevelopExperience";

export const metadata = {
  title: "Develop",
  description: "A sheet of photo paper in a tray of developer. Hold where you want the developer to run and the print rises out of the white wherever the wave has washed.",
};

const loadCovers = unstable_cache(
  async () => {
    const { tracks } = await getRecentTracks();
    const seen = new Set();
    const covers = [];
    for (const track of tracks) {
      if (!track.image || seen.has(track.image)) continue;
      seen.add(track.image);
      covers.push({ id: track.id ?? track.image, title: track.title, artist: track.artist, image: track.image });
    }
    return covers.slice(0, 8);
  },
  ["develop-covers"],
  { revalidate: 3600 },
);

export default async function DevelopPage() {
  if (isProdView() && manifest.status !== "shipped") notFound();
  const covers = await loadCovers().catch(() => []);
  return <DevelopExperience covers={covers} />;
}
