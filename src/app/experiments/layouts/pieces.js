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

export const PIECES = [...SHIPPED_FROM_LAB, ...EXPERIMENTS].map((piece, index) => ({
  ...piece,
  index: String(index + 1).padStart(2, "0"),
}));

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function shortDate(iso) {
  if (!iso) return "";
  const [, m, d] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}
