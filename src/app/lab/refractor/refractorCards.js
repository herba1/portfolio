import { ALBUMS, FALLBACK_TRACKS } from "@/app/lab/_music/catalog";

const byTitle = new Map(ALBUMS.map((album) => [album.title.toLowerCase(), album]));

const slug = (text) =>
  String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

export function cardsFromTracks(tracks, limit = 8) {
  const groups = new Map();
  for (const track of tracks) {
    const name = track.album || track.title;
    const key = slug(`${track.artist}-${name}`);
    if (!groups.has(key)) {
      const known = byTitle.get(String(name).toLowerCase());
      groups.set(key, {
        key,
        src: known ? known.cover : track.imageLarge || track.image,
        remote: !known && /^https?:/.test(track.imageLarge || track.image || ""),
        title: name,
        artist: track.artist,
        year: known ? known.year : track.year || null,
        songs: [],
        tracks: known ? known.tracks : [],
      });
    }
    groups.get(key).songs.push(track.title);
  }
  const cards = [...groups.values()].slice(0, limit).map((card) => ({
    ...card,
    tracks: card.tracks.length ? card.tracks : card.songs,
  }));
  return cards.map((card, i) => ({ ...card, number: i + 1, count: cards.length }));
}

export const DEFAULT_CARDS = cardsFromTracks(FALLBACK_TRACKS);

export const FOILS = [
  { key: "silver", name: "Silver", note: "Aluminium pressing" },
  { key: "gold", name: "Gold", note: "Gold recordable" },
  { key: "black", name: "Black", note: "Black polycarbonate" },
];
