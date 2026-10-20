import { albumById } from "@/app/lab/_music/catalog";

export const BANDS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
export const MAX_DB = 12;

export const bandLabel = (f) => (f >= 1000 ? `${f / 1000}k` : String(f));

const make = (id, name, gains, accent) => ({ id, name, gains, accent, album: id === "flat" ? null : albumById(id) });

export const PRESETS = [
  make("flat", "Flat", [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [236, 236, 232]),
  make("revolver", "Revolver", [4, 6, 3, 0, -2, -1, 2, 4, 5, 3], [226, 226, 222]),
  make("abbey-road", "Abbey Road", [5, 4, 2, 0, -2, -1, 1, 2, 4, 2], [143, 208, 240]),
  make("rubber-soul", "Rubber Soul", [-3, -1, 2, 4, 5, 3, 1, 0, -2, -4], [236, 128, 64]),
  make("sgt-pepper", "Sgt. Pepper", [7, 5, 0, -3, -5, -3, 1, 5, 7, 9], [255, 92, 84]),
  make("let-it-be", "Let It Be", [2, 3, 4, 2, 0, 1, 3, 2, -1, -3], [240, 196, 150]),
  make("help", "Help!", [-2, 0, 3, 2, -1, 2, 5, 6, 3, 1], [72, 160, 240]),
];
