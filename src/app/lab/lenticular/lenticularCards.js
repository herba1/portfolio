import { albumById } from "@/app/lab/_music/catalog";

export const FRAME_COUNT = 7;
export const SPLIT = 1.5;

const card = (key, albumId, song, side, look) => {
  const album = albumById(albumId);
  return {
    key,
    album,
    song,
    side,
    look,
    paper: look.ramp[Math.floor(look.ramp.length / 2)],
    src: album.cover,
    full: `${album.title} (${album.year}), turning into ${song}`,
    aspect: 1,
    dir: 1,
  };
};

export const CARDS = [
  card("sun", "abbey-road", "Here Comes the Sun", "Side two, track one", {
    ramp: ["#2b1030", "#7a2342", "#d9562c", "#f6a23a", "#ffe6a1"],
    zoom: 1.12,
    focus: [0.5, 0.64],
    ink: "#ffe6a1",
    place: "top",
    plate: true,
    lines: 1,
    max: 84,
  }),
  card("wood", "rubber-soul", "Norwegian Wood", "Side one, track two", {
    ramp: ["#0a1710", "#173826", "#3f6b3a", "#d9823f", "#fbe3c4"],
    zoom: 1.18,
    focus: [0.62, 0.56],
    ink: "#fbe3c4",
    place: "bottom",
  }),
  card("knows", "revolver", "Tomorrow Never Knows", "Side two, track seven", {
    ramp: ["#121212", "#2b1810", "#d4441d", "#f2662a", "#ff8a3d"],
    zoom: 1.14,
    focus: [0.5, 0.42],
    ink: "#ffe3c6",
    plateColor: "#121212",
    place: "bottom",
    plate: true,
    lines: 1,
    max: 84,
  }),
  card("fields", "magical-mystery-tour", "Strawberry Fields Forever", "Side two, track two", {
    ramp: ["#33040e", "#8f0d27", "#e0243f", "#ff9aa6", "#fff1ec"],
    zoom: 1.1,
    focus: [0.5, 0.5],
    ink: "#fff1ec",
    place: "bottom",
    plate: true,
    lines: 1,
    max: 84,
  }),
];
