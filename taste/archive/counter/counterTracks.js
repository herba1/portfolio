const PLEASE_PLEASE_ME = [
  "I Saw Her Standing There",
  "Misery",
  "Anna",
  "Chains",
  "Boys",
  "Ask Me Why",
  "Please Please Me",
  "Love Me Do",
  "P.S. I Love You",
  "Baby It's You",
  "Do You Want to Know a Secret",
  "A Taste of Honey",
  "There's a Place",
  "Twist and Shout",
];

export const FALLBACK_TRACKS = PLEASE_PLEASE_ME.map((title, index) => ({
  id: `ppm-${index + 1}`,
  title,
  artist: "The Beatles",
  image: `/flyout/card-${String((index % 12) + 1).padStart(2, "0")}.jpg`,
  durationMs: null,
}));

const VERSION_SUFFIX = /\s+[-–]\s+(\d{4}\s+)?(remaster(ed)?|live|mono|stereo|single|radio|edit|version|demo|acoustic|from\b|recorded|bonus).*$/i;
const FEATURE_PART = /\s*[([](feat\.?|ft\.?|with|prod\.?)\s[^)\]]*[)\]]/gi;
const REMASTER_PART = /\s*[([][^)\]]*(remaster|version|edit|mix|mono|stereo)[^)\]]*[)\]]/gi;
const VOWELS = /[AEIOUY]/;

function titleCaseWord(word) {
  if (/\d/.test(word)) return word;
  const letters = word.replace(/[^A-Z]/g, "");
  if (letters.length > 0 && letters.length <= 3 && !VOWELS.test(letters)) return word;
  return word.charAt(0) + word.slice(1).toLowerCase();
}

export function cleanTitle(raw) {
  let title = String(raw ?? "").trim();
  title = title.replace(FEATURE_PART, "").replace(REMASTER_PART, "").replace(VERSION_SUFFIX, "").trim();
  const letters = title.replace(/[^A-Za-z]/g, "");
  if (letters.length > 3 && letters === letters.toUpperCase()) {
    title = title.split(/(\s+)/).map((part) => (/\s/.test(part) ? part : titleCaseWord(part))).join("");
  }
  return title || String(raw ?? "");
}

const FALLBACK_IDS = new Set(FALLBACK_TRACKS.map((track) => track.id));

export function normaliseTracks(covers) {
  const list = Array.isArray(covers) && covers.length ? covers : FALLBACK_TRACKS;
  const fromFallback = list === FALLBACK_TRACKS || list.every((cover) => FALLBACK_IDS.has(String(cover.id)));
  const seen = new Set();
  const tracks = [];
  for (const cover of list) {
    const title = cleanTitle(cover.title);
    const key = title.toLowerCase();
    if (!title || seen.has(key)) continue;
    seen.add(key);
    tracks.push({ id: String(cover.id ?? cover.image), title, artist: cover.artist ?? "", image: cover.image });
  }
  if (tracks.length >= 2) return Object.assign(tracks, { isFallback: fromFallback });
  return Object.assign(
    FALLBACK_TRACKS.map((track) => ({ ...track })),
    { isFallback: true },
  );
}
