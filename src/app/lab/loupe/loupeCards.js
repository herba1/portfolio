import { albumById } from "@/app/lab/_music/catalog";

const sleeve = (id, tilt, focus, wear) => {
  const album = albumById(id);
  return {
    key: id,
    src: album.cover,
    name: album.title.replace(/'s Lonely.*$/, ""),
    full: `${album.title}, ${album.artist}`,
    year: String(album.year),
    widthMm: 120,
    aspect: 1,
    tilt,
    focus,
    wear,
  };
};

export const CARDS = [
  sleeve("abbey-road", -0.035, [0.5, 0.62], [2.2, 30.0, 0.6, 0.31]),
  sleeve("sgt-pepper", 0.03, [0.5, 0.45], [-0.5, -40.0, 0.5, 0.72]),
  sleeve("rubber-soul", -0.022, [0.45, 0.4], [0.3, 44.0, 0.0, 0.53]),
  sleeve("magical-mystery-tour", 0.035, [0.5, 0.5], [1.35, 20.0, 0.7, 0.9]),
];

export const ZOOM_MIN = 2;
export const ZOOM_MAX = 20;
export const ZOOM_REST = 4.5;
