import { albumById } from "@/app/lab/_music/catalog";

export const ALBUM_CHOICES = ["sgt-pepper", "magical-mystery-tour", "abbey-road", "rubber-soul", "help"].map((id) => {
  const album = albumById(id);
  return { id, title: album.title, short: id === "sgt-pepper" ? "Sgt. Pepper" : album.title, year: album.year, cover: album.cover };
});

export const LAMP = [1.0, 0.93, 0.84];
