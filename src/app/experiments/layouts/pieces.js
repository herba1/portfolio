import { LAB } from "@/app/lab/registry";
import { EXPERIMENTS } from "../list";

// Every finished piece, in the order the index shows them — shipped lab work
// first, then the hand-built list. Each layout below reads only this.
const SHIPPED_FROM_LAB = LAB.filter((item) => item.status === "shipped").map((item) => ({
  slug: `/lab/${item.slug}`,
  title: item.title,
  description: item.description,
  tags: item.tags,
}));

export const PIECES = [...SHIPPED_FROM_LAB, ...EXPERIMENTS];
