import { albumById } from "@/app/lab/_music/catalog";

const press = (id, style) => {
  const album = albumById(id);
  return {
    key: album.id,
    label: album.title,
    src: album.cover,
    title: album.title,
    artist: album.artist,
    year: album.year,
    tracks: album.tracks,
    ...style,
  };
};

export const PRESETS = [
  press("revolver", { paper: "#f1eee6", ink: "#151513", tone: [0.62, 0.03, 1.4] }),
  press("abbey-road", { paper: "#e4ebf0", ink: "#1b2a38", tone: [0.04, 0.75, 1.3] }),
  press("rubber-soul", { paper: "#ecdcbc", ink: "#3a2412", tone: [0.02, 0.55, 1.1] }),
  press("sgt-pepper", { label: "Sgt. Pepper", paper: "#f2d64b", ink: "#1f1a3a", tone: [0.04, 0.7, 1.3] }),
  press("let-it-be", { paper: "#161616", ink: "#f1eee6", tone: [0.01, 0.5, 1.2] }),
];
