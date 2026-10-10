import { notFound } from "next/navigation";
import { getCachedRecentTracks } from "@/lib/spotifyRecent";
import RankLab from "./RankLab";

export const metadata = { title: "Most played options", robots: { index: false } };

const SAMPLE_TRACKS = 8;

const FALLBACK_TRACK = {
  title: "You Take The Dark Out Of The Night",
  artist: "Emitt Rhodes",
  image: null,
  imageLarge: null,
  artistImage: null,
};

export default async function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  const { tracks, mode } = await getCachedRecentTracks();
  const ranked = tracks.map((track, i) => ({ ...track, rank: i + 1 }));
  const seen = new Set();
  const samples = ranked.filter((track) => {
    if (!track.image || seen.has(track.image)) return false;
    seen.add(track.image);
    return true;
  });
  const picked = samples.length ? samples.slice(0, SAMPLE_TRACKS) : [{ ...FALLBACK_TRACK, rank: 1 }];
  return <RankLab tracks={picked} mode={mode} total={tracks.length || 50} />;
}
