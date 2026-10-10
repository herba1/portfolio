import { ICONS } from "./oneLineIcons";

export const SHELF_SIZE = 4;

const FALLBACK_TITLES = [
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

export const FALLBACK_TRACKS = FALLBACK_TITLES.map((title, index) => ({
  id: `ppm-${index + 1}`,
  title,
  artist: "The Beatles",
  image: `/flyout/card-${String((index % 12) + 1).padStart(2, "0")}.jpg`,
}));

const SHELF_PLANS = {
  home: { start: 5, step: 1 },
  search: { start: 10, step: 1 },
  library: { start: 20, step: 1, distinctArtists: true },
  liked: { start: 15, step: 1 },
  profile: { start: 0, step: 1 },
};

const FEATURE_PART = /\s*[([](feat\.?|ft\.?|with)\s[^)\]]*[)\]]/gi;
const VERSION_SUFFIX = /\s+[-–]\s+[^-–]*(remaster(ed)?|version|live|mono|stereo|edit|mix)\b.*$/i;

function cleanTitle(title) {
  const cleaned = String(title ?? "").replace(FEATURE_PART, "").replace(VERSION_SUFFIX, "").trim();
  return cleaned || String(title ?? "");
}

export function toShelfTrack(track) {
  return { id: track.id ?? track.image, title: cleanTitle(track.title), artist: track.artist, image: track.image };
}

function pickShelf(tracks, { start, step, distinctArtists = false }) {
  const count = tracks.length;
  const picked = [];
  const ids = new Set();
  const artists = new Set();
  for (let offset = 0; offset < count && picked.length < SHELF_SIZE; offset += 1) {
    const track = tracks[(start + offset * step) % count];
    if (ids.has(track.id)) continue;
    if (distinctArtists && artists.has(track.artist)) continue;
    ids.add(track.id);
    artists.add(track.artist);
    picked.push(track);
  }
  if (distinctArtists && picked.length < SHELF_SIZE) return pickShelf(tracks, { start, step });
  return picked;
}

export function buildShelves(tracks) {
  const usable = (tracks ?? []).filter((track) => track?.image && track.title).map(toShelfTrack);
  const source = usable.length ? usable : FALLBACK_TRACKS;
  return ICONS.map((icon) => pickShelf(source, SHELF_PLANS[icon.key] ?? SHELF_PLANS.home));
}
