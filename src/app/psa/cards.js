/* ─────────────────────────────────────────────────────────────────────────
   Sample inventory for /psa.

   Real scans, real cards. Every image in /public/psa is public domain or
   CC0 — nine from the Library of Congress (Benjamin K. Edwards collection,
   American Tobacco Company issues), two from the Met's Burdick collection,
   one 1933 Goudey. See /public/psa/CREDITS.md for per-file provenance.

   The GRADES, PRICES, DELTAS and POPULATION figures are invented. They exist
   to give the number columns realistic width and realistic ragging so the
   layouts can be judged honestly; they do not state a market.

   Anything with a missing or broken scan falls back to the drawn empty face,
   so the layouts hold up either way.
   ───────────────────────────────────────────────────────────────────────── */

export const CARDS = [
  {
    id: "t206-wagner",
    player: "Honus Wagner",
    year: 1909,
    set: "T206 White Border",
    variant: "Piedmont 150",
    grade: 8,
    price: 7250000,
    delta: 4.2,
    pop: 3,
    cert: "48291066",
    image: "/psa/card-01.jpg",
  },
  {
    id: "t206-cobb",
    player: "Ty Cobb",
    year: 1909,
    set: "T206 White Border",
    variant: "Bat on Shoulder",
    grade: 9,
    price: 412000,
    delta: -1.8,
    pop: 11,
    cert: "48291067",
    image: "/psa/card-02.jpg",
  },
  {
    id: "t206-mathewson",
    player: "Christy Mathewson",
    year: 1909,
    set: "T206 White Border",
    variant: "New York Giants",
    grade: 9,
    price: 96500,
    delta: 2.4,
    pop: 27,
    cert: "48291068",
    image: "/psa/card-03.jpg",
  },
  {
    id: "t206-young",
    player: "Cy Young",
    year: 1909,
    set: "T206 White Border",
    variant: "Cleveland Naps",
    grade: 8,
    price: 58400,
    delta: -3.1,
    pop: 42,
    cert: "48291069",
    image: "/psa/card-04.jpg",
  },
  {
    id: "t206-johnson",
    player: "Walter Johnson",
    year: 1909,
    set: "T206 White Border",
    variant: "Washington Nationals",
    grade: 9,
    price: 121000,
    delta: 5.7,
    pop: 19,
    cert: "48291070",
    image: "/psa/card-05.jpg",
  },
  {
    id: "t206-lajoie",
    player: "Nap Lajoie",
    year: 1909,
    set: "T206 White Border",
    variant: "Cleveland Naps",
    grade: 8,
    price: 41900,
    delta: 3.3,
    pop: 54,
    cert: "48291071",
    image: "/psa/card-06.jpg",
  },
  {
    id: "t206-speaker",
    player: "Tris Speaker",
    year: 1911,
    set: "T206 White Border",
    variant: "Boston Red Sox",
    grade: 10,
    price: 305000,
    delta: -2.2,
    pop: 2,
    cert: "48291072",
    image: "/psa/card-07.jpg",
  },
  {
    id: "t206-keeler",
    player: "Willie Keeler",
    year: 1909,
    set: "T206 White Border",
    variant: "New York Highlanders",
    grade: 7,
    price: 34800,
    delta: 1.2,
    pop: 61,
    cert: "48291073",
    image: "/psa/card-08.jpg",
  },
  {
    id: "t206-tinker",
    player: "Joe Tinker",
    year: 1909,
    set: "T206 White Border",
    variant: "Chicago Cubs",
    grade: 8,
    price: 22400,
    delta: -0.6,
    pop: 88,
    cert: "48291074",
    image: "/psa/card-09.jpg",
  },
  {
    id: "goudey-ruth",
    player: "Babe Ruth",
    year: 1933,
    set: "Goudey",
    variant: "#181 Big League",
    grade: 10,
    price: 1580000,
    delta: 9.6,
    pop: 1,
    cert: "48291075",
    image: "/psa/card-10.jpg",
  },
  {
    id: "oldjudge-galvin",
    player: "Pud Galvin",
    year: 1887,
    set: "Old Judge N172",
    variant: "Pittsburgh",
    grade: 7,
    price: 68200,
    delta: 6.1,
    pop: 14,
    cert: "48291076",
    image: "/psa/card-11.jpg",
  },
  {
    id: "oldjudge-kelly",
    player: "King Kelly",
    year: 1889,
    set: "Old Judge N172",
    variant: "Boston",
    grade: 8,
    price: 274000,
    delta: 0.9,
    pop: 8,
    cert: "48291077",
    image: "/psa/card-12.jpg",
  },
];

/* Every scan the surfaces can ever show, for preloading in one call. */
export const CARD_IMAGES = CARDS.map((c) => c.image).filter(Boolean);

/* Compact currency. A collection screen is a column of figures, so the goal
   is equal width and instant comparison, not exact cents — $7.25M reads
   against $412K far faster than $7,250,000 reads against $412,000. */
export function formatPrice(value) {
  if (value >= 1_000_000) {
    const millions = value / 1_000_000;
    return `$${millions.toFixed(millions >= 10 ? 1 : 2)}M`;
  }
  if (value >= 1_000) return `$${Math.round(value / 1_000)}K`;
  return `$${value}`;
}

export function formatDelta(value) {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}
