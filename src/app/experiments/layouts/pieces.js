import { LAB } from "@/app/lab/registry";
import { EXPERIMENTS } from "../list";

// Every finished piece, in the order the index shows them — shipped lab work
// first, then the hand-built list. Each layout below reads only this.
const SHIPPED_FROM_LAB = LAB.filter((item) => item.status === "shipped").map((item) => ({
  slug: `/lab/${item.slug}`,
  title: item.title,
  description: item.description,
  tags: item.tags,
  date: item.createdAt?.slice(0, 10),
}));

// How each piece wants to be framed. `base` is the narrowest width its main
// interaction reads well at — a frame narrower than that renders at `base`
// and scales down; a wider one renders at its true size. `aspect` is the
// tile shape that suits it: a phone flow is tall, a stack of covers is wide.
const SPECS = {
  "/ink": { base: 360, aspect: 4 / 5 },
  "/refract": { base: 360, aspect: 4 / 3 },
  "/halftone": { base: 360, aspect: 1 },
  "/backdrop": { base: 400, aspect: 4 / 5 },
  "/song-search": { base: 440, aspect: 3 / 2 },
  "/deck": { base: 720, aspect: 4 / 3 },
  "/psa": { base: 400, aspect: 9 / 16 },
  "/tuner": { base: 600, aspect: 4 / 3 },
};
const DEFAULT_SPEC = { base: 480, aspect: 4 / 3 };

export const PIECES = [...SHIPPED_FROM_LAB, ...EXPERIMENTS].map((piece, index) => ({
  ...piece,
  ...(SPECS[piece.slug] ?? DEFAULT_SPEC),
  index: String(index + 1).padStart(2, "0"),
}));

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function shortDate(iso) {
  if (!iso) return "";
  const [, m, d] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}
