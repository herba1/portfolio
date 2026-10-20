import { ALBUMS } from "@/app/lab/_music/catalog";

const LABELS = [
  { paper: "#1d1b19", ink: "#f1e9d6" },
  { paper: "#ece4cf", ink: "#1d1b19" },
  { paper: "#c8432b", ink: "#f6efe2" },
  { paper: "#2f5d8a", ink: "#f2ede2" },
  { paper: "#e2b13c", ink: "#1d1b19" },
];

const BACKS = ["#f3ede1", "#eee6d6", "#f5f1e8", "#ebe3d2", "#f1ebdd"];

export const MAX_SLEEVES = 16;
export const MIN_SLEEVES = 12;

export function toSleeves(tracks) {
  const albums = new Map();
  for (const track of tracks) {
    const src = track.imageLarge || track.image;
    if (!src) continue;
    const key = track.album || src;
    const album = albums.get(key);
    if (album) {
      if (album.songs.length < 6 && !album.songs.includes(track.title)) album.songs.push(track.title);
      continue;
    }
    if (albums.size === MAX_SLEEVES) continue;
    albums.set(key, {
      key,
      src,
      title: track.album || track.title,
      artist: track.artist,
      year: track.year || null,
      songs: [track.title],
      id: track.id || key,
    });
  }
  const unique = [...albums.values()];
  for (const album of unique) {
    const known = ALBUMS.find((a) => a.title.toLowerCase() === String(album.title).toLowerCase() && a.artist === album.artist);
    if (known) {
      album.tracks = known.tracks.slice(0, 8);
      if (!album.year) album.year = known.year;
    } else album.tracks = album.songs;
  }
  if (!unique.length) return [];
  const count = Math.max(unique.length, Math.min(MIN_SLEEVES, unique.length * 2));
  const sleeves = [];
  for (let i = 0; i < count; i += 1) {
    const album = unique[i % unique.length];
    const copy = Math.floor(i / unique.length);
    sleeves.push({
      id: copy ? `${album.id}-copy-${copy}` : album.id,
      src: album.src,
      title: album.title,
      song: album.songs[copy % album.songs.length],
      songs: album.songs,
      tracks: album.tracks,
      artist: album.artist,
      year: album.year,
      label: LABELS[i % LABELS.length],
      back: BACKS[i % BACKS.length],
    });
  }
  return sleeves;
}
