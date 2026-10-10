import { notFound } from "next/navigation";
import { unstable_cache } from "next/cache";

import { isProdView } from "@/lib/viewMode";
import { getRecentTracks } from "@/lib/spotifyRecent";

import manifest from "./experiment.json";
import ThreadExperience from "./ThreadExperience";

export const metadata = {
  title: "Thread",
  description: "An Up Next queue strung on an elastic thread: swipe a song off and a soft ripple runs down the rows below and settles.",
};

const MIN_COVERS = 6;
const MAX_COVERS = 24;
const CATALOGUE_TIMEOUT_MS = 4000;
const ARTWORK_SIZE = "200x200bb";

const FALLBACK_TRACKS = [
  ["Here Comes the Sun", "The Beatles", 185000],
  ["Weird Fishes/Arpeggi", "Radiohead", 318000],
  ["Digital Love", "Daft Punk", 301000],
  ["Pink + White", "Frank Ocean", 184000],
  ["Dreams", "Fleetwood Mac", 257000],
  ["This Must Be the Place (Naive Melody)", "Talking Heads", 296000],
  ["Let It Happen", "Tame Impala", 467000],
  ["Holocene", "Bon Iver", 336000],
  ["Space Song", "Beach House", 320000],
  ["Ask Me Why", "The Beatles", 144000],
  ["Sir Duke", "Stevie Wonder", 234000],
  ["Teardrop", "Massive Attack", 330000],
];

const FALLBACK_COVERS = FALLBACK_TRACKS.map(([title, artist, durationMs], index) => ({
  id: `song-${index + 1}`,
  title,
  artist,
  image: null,
  durationMs,
}));

function plain(text) {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

async function catalogueSong(fallback) {
  const query = new URLSearchParams({ term: `${fallback.title} ${fallback.artist}`, entity: "song", limit: "10" });
  const response = await fetch(`https://itunes.apple.com/search?${query}`, {
    signal: AbortSignal.timeout(CATALOGUE_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!response.ok) return fallback;
  const { results = [] } = await response.json();
  const wantedArtist = plain(fallback.artist);
  const wantedTitle = plain(fallback.title).split(" ")[0];
  const byArtist = results.filter((result) => result.artworkUrl100 && plain(result.artistName) === wantedArtist);
  const match = byArtist.find((result) => plain(result.trackName).startsWith(wantedTitle)) ?? byArtist[0];
  if (!match) return fallback;
  return {
    ...fallback,
    id: `itunes-${match.trackId}`,
    image: match.artworkUrl100.replace("100x100bb", ARTWORK_SIZE),
    durationMs: match.trackTimeMillis || fallback.durationMs,
  };
}

async function catalogueCovers() {
  const settled = await Promise.allSettled(FALLBACK_COVERS.map(catalogueSong));
  const covers = settled.map((outcome, index) => (outcome.status === "fulfilled" ? outcome.value : FALLBACK_COVERS[index]));
  if (covers.filter((cover) => cover.image).length < MIN_COVERS) throw new Error("too few catalogue covers");
  return covers;
}

async function recentCovers() {
  const { tracks } = await getRecentTracks();
  const seen = new Set();
  const covers = [];
  for (const track of tracks) {
    if (!track.image || seen.has(track.image)) continue;
    seen.add(track.image);
    covers.push({ id: track.id ?? track.image, title: track.title, artist: track.artist, image: track.image, durationMs: track.durationMs ?? null });
  }
  if (covers.length < MIN_COVERS) throw new Error("too few covers");
  return covers.slice(0, MAX_COVERS);
}

const loadCovers = unstable_cache(
  async () => {
    try {
      return await recentCovers();
    } catch {
      return catalogueCovers();
    }
  },
  ["thread-covers-v2"],
  { revalidate: 3600 },
);

export default async function ThreadPage() {
  if (isProdView() && manifest.status !== "shipped") notFound();
  const covers = await loadCovers().catch(() => FALLBACK_COVERS);
  return <ThreadExperience covers={covers} />;
}
