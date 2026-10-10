export const BASE_SIZE = 12;
export const MAX_LINES = 12;
export const ROOT_HZ = 1046.5;
export const FLOOR_HZ = 55;
export const DISPLAY_FROM = 20;
export const POP_IN_STAGGER_MS = 45;
export const MIN_BAND = 24;
export const BAND_FACTOR = 1.12;

export const INTERVALS = [
  { name: "Minor second", ratio: 1.067, chord: [0, 2, 4, 7, 11] },
  { name: "Major second", ratio: 1.125, chord: [0, 2, 4, 7, 9] },
  { name: "Minor third", ratio: 1.2, chord: [0, 3, 7, 10] },
  { name: "Major third", ratio: 1.25, chord: [0, 4, 7, 11] },
  { name: "Perfect fourth", ratio: 1.333, chord: [0, 3, 5, 10] },
  { name: "Augmented fourth", ratio: 1.414, chord: [0, 4, 6, 11] },
  { name: "Perfect fifth", ratio: 1.5, chord: [0, 2, 7, 9] },
  { name: "Golden ratio", ratio: 1.618, chord: [0, 3, 8, 10] },
  { name: "Major sixth", ratio: 1.667, chord: [0, 4, 7, 9] },
  { name: "Octave", ratio: 2, chord: [0] },
];

export const DEFAULT_INTERVAL = 3;

export const PLEASE_PLEASE_ME = [
  "I Saw Her Standing There",
  "Misery",
  "Anna",
  "Chains",
  "Boys",
  "Ask Me Why",
  "Please Please Me",
  "Love Me Do",
  "P.S. I Love You",
  "Baby It’s You",
  "Do You Want to Know a Secret",
  "A Taste of Honey",
  "There’s a Place",
  "Twist and Shout",
];

export function lawTracking(size) {
  const value = -0.043 * (size - BASE_SIZE);
  return Math.abs(value) < 0.0005 ? 0 : value;
}

export function sizeAt(ratio, index) {
  return BASE_SIZE * ratio ** index;
}

export function bandFor(size) {
  return Math.max(MIN_BAND, size * BAND_FACTOR);
}

export function baselineDrop(size) {
  return bandFor(size) * 0.5 + size * 0.34;
}

export function formatSize(size) {
  return size.toFixed(1);
}

export function formatTracking(size) {
  const value = lawTracking(size);
  if (Math.abs(value) < 0.005) return "0.00";
  return `${value < 0 ? "−" : ""}${Math.abs(value).toFixed(2)}`;
}

const SMALL_WORDS = new Set(["a", "an", "and", "as", "at", "but", "by", "for", "in", "of", "on", "or", "the", "to", "with"]);

function titleCase(text) {
  return text
    .split(" ")
    .map((word, index) => {
      if (!word) return word;
      if (index > 0 && SMALL_WORDS.has(word)) return word;
      return word[0].toUpperCase() + word.slice(1);
    })
    .join(" ");
}

export function cleanTitle(raw) {
  if (!raw) return "";
  let text = String(raw)
    .replace(/\s+[-–—]\s+.*(remaster|live|mono|stereo|version|edit|mix|demo|from|session|take).*$/i, "")
    .replace(/\s*[([][^)\]]*[)\]]/g, "")
    .replace(/'/g, "’")
    .replace(/\s+/g, " ")
    .trim();
  if (text && text === text.toLowerCase()) text = titleCase(text);
  return text;
}

export function pickTitles(covers) {
  const seen = new Set();
  const titles = [];
  const fromCovers = Array.isArray(covers) && !covers.every((cover) => cover?.artist === "Local scans");
  const source = fromCovers ? covers.map((cover) => cover?.title) : [];
  for (const raw of [...source, ...PLEASE_PLEASE_ME]) {
    const title = cleanTitle(raw);
    const key = title.toLowerCase();
    if (!title || title.length > 48 || seen.has(key)) continue;
    seen.add(key);
    titles.push(title);
    if (titles.length === MAX_LINES) break;
  }
  return titles
    .map((title, order) => ({ title, order }))
    .sort((a, b) => b.title.length - a.title.length || a.order - b.order)
    .map((entry) => entry.title);
}

function midiToHz(midi) {
  return 440 * 2 ** ((midi - 69) / 12);
}

export function voiceScale(interval, count = MAX_LINES) {
  const frequencies = new Float64Array(count);
  const tones = new Set(interval.chord);
  const floorMidi = 69 + 12 * Math.log2(FLOOR_HZ / 440);
  let previous = Infinity;
  for (let index = 0; index < count; index += 1) {
    const trueHz = Math.max(FLOOR_HZ, ROOT_HZ / interval.ratio ** index);
    const trueMidi = 69 + 12 * Math.log2(trueHz / 440);
    let best = null;
    const top = Math.min(previous - 1, Math.round(trueMidi) + 12);
    for (let midi = top; midi >= Math.ceil(floorMidi) && midi >= trueMidi - 13; midi -= 1) {
      if (!tones.has(((midi % 12) + 12) % 12)) continue;
      if (best === null || Math.abs(midi - trueMidi) < Math.abs(best - trueMidi)) best = midi;
    }
    if (best === null) best = Number.isFinite(previous) ? previous : 84;
    previous = best;
    frequencies[index] = midiToHz(best);
  }
  return frequencies;
}
