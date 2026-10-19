import { albumById } from "@/app/lab/_music/catalog";

export const FRAME_COUNT = 7;
export const SPLIT = 1.5;

const card = (key, albumId, song, side, paper, ink) => {
  const album = albumById(albumId);
  return {
    key,
    album,
    song,
    side,
    paper,
    ink,
    src: album.cover,
    full: `${album.title} (${album.year}), turning into ${song}`,
    aspect: 1,
    dir: 1,
  };
};

export const CARDS = [
  card("sun", "abbey-road", "Here Comes the Sun", "Side two, track one", "#f3b23c", "#1b1712"),
  card("wood", "rubber-soul", "Norwegian Wood", "Side one, track two", "#173826", "#f0743a"),
  card("knows", "revolver", "Tomorrow Never Knows", "Side two, track seven", "#111111", "#f4f1ea"),
  card("fields", "magical-mystery-tour", "Strawberry Fields Forever", "Side two, track two", "#d8283f", "#fbe3e0"),
];
