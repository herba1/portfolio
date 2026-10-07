export const MAX_GLYPHS = 20;
export const MAX_SEGMENTS = 14;
export const MAX_GRABS = 3;

export const TAFFY_BASE = {
  snapLength: 2.1,
  fillet: 0.35,
  stiffness: 260,
  damping: 13,
  retractMs: 240,
  sag: 1,
};

export const TAFFY_PRESETS = [
  { name: "Taffy", values: {} },
  { name: "Mozzarella", values: { snapLength: 3.4, fillet: 0.62, stiffness: 170, damping: 9, retractMs: 380, sag: 1.6 } },
  { name: "Rubber", values: { snapLength: 1.3, fillet: 0.22, stiffness: 420, damping: 15, retractMs: 130, sag: 0.35 } },
];

export const DEFAULT_PRESET = TAFFY_PRESETS[0];

export const presetValues = (preset) => ({ ...TAFFY_BASE, ...preset.values });

export const TAFFY_CONTROLS = [
  { key: "snapLength", label: "Snap length", min: 1.2, max: 4, step: 0.1, digits: 1, unit: "caps" },
  { key: "fillet", label: "Fillet", min: 0.1, max: 0.8, step: 0.01, digits: 2, unit: "stem" },
  { key: "stiffness", label: "Spring stiffness", min: 120, max: 520, step: 10, digits: 0, unit: "" },
  { key: "damping", label: "Wobble damping", min: 4, max: 30, step: 1, digits: 0, unit: "" },
];

export const FALLBACK_TITLES = [
  { id: "ppm-ask-me-why", title: "Ask Me Why", artist: "The Beatles", image: "/cast/john.webp" },
  { id: "ppm-misery", title: "Misery", artist: "The Beatles", image: "/cast/paul.webp" },
  { id: "ppm-chains", title: "Chains", artist: "The Beatles", image: "/cast/george.webp" },
  { id: "ppm-love-me-do", title: "Love Me Do", artist: "The Beatles", image: "/cast/paul.webp" },
  { id: "ppm-boys", title: "Boys", artist: "The Beatles", image: "/cast/john.webp" },
  { id: "ppm-anna", title: "Anna", artist: "The Beatles", image: "/cast/john.webp" },
  { id: "ppm-place", title: "There's a Place", artist: "The Beatles", image: "/cast/george.webp" },
  { id: "ppm-ps", title: "P.S. I Love You", artist: "The Beatles", image: "/cast/paul.webp" },
  { id: "ppm-baby", title: "Baby It's You", artist: "The Beatles", image: "/cast/john.webp" },
  { id: "ppm-honey", title: "A Taste of Honey", artist: "The Beatles", image: "/cast/paul.webp" },
  { id: "ppm-twist", title: "Twist and Shout", artist: "The Beatles", image: "/cast/john.webp" },
  { id: "ppm-please", title: "Please Please Me", artist: "The Beatles", image: "/cast/george.webp" },
];

const PLAYABLE = /^[\p{L}\p{N} '’&.,!?-]+$/u;
const PLACEHOLDER = /^Card \d+$/;

function cleanTitle(raw) {
  const base = String(raw || "")
    .split(" - ")[0]
    .replace(/\s*[([].*?[)\]]\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const letters = base.replace(/[^\p{L}]/gu, "");
  const shouting = letters.length > 1 && letters === letters.toLocaleUpperCase() && letters !== letters.toLocaleLowerCase();
  if (!shouting) return base;
  return base
    .toLocaleLowerCase()
    .split(" ")
    .map((word) => (word ? word[0].toLocaleUpperCase() + word.slice(1) : word))
    .join(" ");
}

const glyphCount = (text) => text.replace(/ /g, "").length;

export function pickTitles(covers, limit = 12) {
  const seen = new Set();
  const picked = [];
  for (const cover of covers || []) {
    if (cover.artist === "Local scans" && PLACEHOLDER.test(cover.title || "")) continue;
    const title = cleanTitle(cover.title);
    const key = title.toLocaleLowerCase();
    if (!title || seen.has(key)) continue;
    if (title.length > 14 || glyphCount(title) > MAX_GLYPHS || !PLAYABLE.test(title)) continue;
    seen.add(key);
    picked.push({ id: cover.id, title, artist: cover.artist || "", image: cover.image || null });
    if (picked.length >= limit) return picked;
  }
  for (const fallback of FALLBACK_TITLES) {
    if (picked.length >= limit) break;
    const key = fallback.title.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(fallback);
  }
  return picked;
}
