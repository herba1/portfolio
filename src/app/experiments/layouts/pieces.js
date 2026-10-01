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

// The tile shape that suits each piece: a phone flow is tall, a stack of
// covers is wide, the plates sit near square.
const SPECS = {
  "/ink": { aspect: 4 / 5 },
  "/refract": { aspect: 4 / 3 },
  "/halftone": { aspect: 1 },
  "/backdrop": { aspect: 4 / 5 },
  "/song-search": { aspect: 3 / 2 },
  "/deck": { aspect: 4 / 3 },
  "/psa": { aspect: 9 / 16 },
  "/tuner": { aspect: 4 / 3 },
};
const DEFAULT_SPEC = { aspect: 4 / 3 };

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
