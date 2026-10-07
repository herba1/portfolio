import { notFound } from "next/navigation";
import { unstable_cache } from "next/cache";

import { isProdView } from "@/lib/viewMode";
import { getRecentTracks } from "@/lib/spotifyRecent";
import { CARDS } from "@/app/flyout/cards";

import manifest from "./experiment.json";
import OneLineExperience from "./OneLineExperience";

export const metadata = {
  title: "One line",
  description: "A tab bar drawn with a single pen line that pulls out of one icon, runs along the bar and threads itself into the next.",
};

const MIN_COVERS = 6;
const MAX_COVERS = 30;
const ALBUMS_PER_ARTIST = 5;
const CATALOGUE_TIMEOUT_MS = 4000;
const CATALOGUE_ARTISTS = ["Radiohead", "Daft Punk", "Björk", "Talking Heads", "Kendrick Lamar", "The Beatles"];
const SKIPPED_ALBUM = /\s-\s(single|ep)$|greatest hits|best of|collectors|soundtrack|reconfigured/i;

const FALLBACK_COVERS = CARDS.map((card) => ({
  id: card.id,
  title: card.variant,
  artist: card.player,
  image: card.image,
}));

function plain(text) {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

function albumTitle(name) {
  return String(name ?? "")
    .replace(/\s*[([].*$/, "")
    .trim();
}

async function artistAlbums(artist) {
  const query = new URLSearchParams({ term: plain(artist), entity: "album", attribute: "artistTerm", limit: "20" });
  const response = await fetch(`https://itunes.apple.com/search?${query}`, {
    signal: AbortSignal.timeout(CATALOGUE_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!response.ok) return [];
  const { results = [] } = await response.json();
  const wanted = plain(artist);
  const seen = new Set();
  const albums = [];
  for (const result of results) {
    if (albums.length >= ALBUMS_PER_ARTIST) break;
    if (!result.artworkUrl100 || plain(result.artistName) !== wanted) continue;
    if (SKIPPED_ALBUM.test(result.collectionName ?? "")) continue;
    const title = albumTitle(result.collectionName);
    const key = plain(title);
    if (!title || seen.has(key)) continue;
    seen.add(key);
    albums.push({
      id: `itunes-${result.collectionId}`,
      title,
      artist: result.artistName,
      image: result.artworkUrl100.replace("100x100bb", "600x600bb"),
    });
  }
  return albums;
}

async function catalogueCovers() {
  const settled = await Promise.allSettled(CATALOGUE_ARTISTS.map(artistAlbums));
  const shelves = settled.map((outcome) => (outcome.status === "fulfilled" ? outcome.value : []));
  const covers = [];
  for (let round = 0; round < ALBUMS_PER_ARTIST; round += 1) {
    for (const shelf of shelves) if (shelf[round]) covers.push(shelf[round]);
  }
  if (covers.length < MIN_COVERS) throw new Error("too few catalogue covers");
  return covers.slice(0, MAX_COVERS);
}

async function recentCovers() {
  const { tracks } = await getRecentTracks();
  const seen = new Set();
  const covers = [];
  for (const track of tracks) {
    if (!track.image || seen.has(track.image)) continue;
    seen.add(track.image);
    covers.push({ id: track.id ?? track.image, title: track.title, artist: track.artist, image: track.image });
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
  ["one-line-covers"],
  { revalidate: 3600 },
);

export default async function OneLinePage() {
  if (isProdView() && manifest.status !== "shipped") notFound();
  const covers = await loadCovers().catch(() => FALLBACK_COVERS);
  return <OneLineExperience covers={covers} />;
}
