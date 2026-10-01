import { CARDS, formatDelta, formatPrice } from "./cards";

/* ─────────────────────────────────────────────────────────────────────────
   Kits — what the collection app is a collection OF.

   Everything that moves — the save flight, the tab count, the FLIP reflows,
   the odometer figures, undo — is content-blind. A kit is the part that is
   not: the items, the chips that filter them, the words on each surface and
   the shape of the art. Swap the kit and the same app collects something
   else.

   Every item is normalised to one shape so no surface has to know which kit
   it is drawing:
     id, title, meta (the tile's second line), detail (the ledger row's),
     feedLine, search, alt, image, art (a wash when there is no image),
     value + delta (the live figures' opening values), group (what Profile
     counts distinct of).
   ───────────────────────────────────────────────────────────────────────── */

/* ── Cards — graded baseball cards, the original /psa ─────────────────── */

const CARD_ITEMS = CARDS.map((c) => ({
  id: c.id,
  title: c.player,
  meta: `${c.year} ${c.set}`,
  detail: `${c.year} ${c.set} · PSA ${c.grade}`,
  feedLine: `${c.year} ${c.set} · ${c.player}`,
  search: `${c.player} ${c.set} ${c.variant} ${c.year}`,
  alt: `${c.year} ${c.set} ${c.player}`,
  image: c.image,
  value: c.price,
  delta: c.delta,
  group: c.set,
  grade: c.grade,
  set: c.set,
}));

const byId = (items) => (id) => items.find((it) => it.id === id);
const cardById = byId(CARD_ITEMS);

export const CARDS_KIT = {
  id: "cards",
  items: CARD_ITEMS,
  filters: [
    { id: "all", label: "All" },
    { id: "gem", label: "Gem mint", test: (c) => c.grade === 10 },
    { id: "t206", label: "T206", test: (c) => c.set.startsWith("T206") },
    { id: "goudey", label: "Goudey", test: (c) => c.set === "Goudey" },
    { id: "oldjudge", label: "Old Judge", test: (c) => c.set.startsWith("Old Judge") },
  ],
  // Chosen on ratio — see BlankStack in PsaExperience.
  stack: ["oldjudge-galvin", "t206-mathewson", "t206-cobb"].map(cardById).filter(Boolean),
  feed: [
    { id: "a1", item: CARD_ITEMS[0], event: "Sold at auction", when: "2h" },
    { id: "a2", item: CARD_ITEMS[9], event: "New population high", when: "6h" },
    { id: "a3", item: CARD_ITEMS[4], event: "Price up 5.7%", when: "1d" },
    { id: "a4", item: CARD_ITEMS[6], event: "Graded PSA 10", when: "2d" },
    { id: "a5", item: CARD_ITEMS[2], event: "Listed for sale", when: "3d" },
  ],
  formatValue: formatPrice,
  formatDelta,
  copy: {
    browse: "Add to your bookmarks",
    library: "Collection",
    searchPlaceholder: "Player, set or year",
    noMatch: "No cards match",
    one: "card",
    many: "cards",
    emptyTitle: "Nothing bookmarked yet.",
    emptyBody: "Tap the bookmark on any card and it lands here.",
    cta: "Browse cards",
    since: "Collector since 2019",
    valueLabel: "Value",
    groupLabel: "Sets",
  },
};

/* ── Songs — bookmarking tracks off a listening history ───────────────── */

/* A stable number per id, so a track's invented figures are the same on the
   server pass, the hydration pass and every reload. */
function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/* Streams, log-uniform between 60K and 60M: most tracks land in the low
   millions, a few are hits and a few are deep cuts, which is what gives the
   chips something to split and the column realistic ragging. Invented, like
   the card prices — they exist to judge the layout, not to state a count. */
function figures(id) {
  const h = hash(id);
  const u = (h % 10007) / 10007;
  const value = Math.round(60_000 * 1000 ** u);
  const delta = (((h >>> 14) % 181) - 60) / 10;
  return { value, delta };
}

/* Multi-stop washes for tracks with no artwork (Spotify not configured) — the
   same treatment Deck's fallback covers get, so an empty library still reads
   as considered rather than broken. */
function wash(index) {
  // Golden-angle steps, so neighbouring tiles never share a hue.
  const hue = Math.round(24 + index * 137.508) % 360;
  const a = `hsl(${hue} 62% 72%)`;
  const b = `hsl(${(hue + 28) % 360} 58% 58%)`;
  const c = `hsl(${(hue + 64) % 360} 46% 38%)`;
  return `linear-gradient(148deg, ${a} 0%, ${b} 42%, ${b} 54%, ${c} 100%)`;
}

const FALLBACK_SONGS = [
  ["Lady (Hear Me Tonight)", "Modjo"],
  ["Music Sounds Better with You", "Stardust"],
  ["Windowlicker", "Aphex Twin"],
  ["Teardrop", "Massive Attack"],
  ["Around the World", "Daft Punk"],
  ["Sunset (Bird of Prey)", "Fatboy Slim"],
  ["Midnight City", "M83"],
  ["Archangel", "Burial"],
  ["Innerbloom", "RÜFÜS DU SOL"],
  ["Gosh", "Jamie xx"],
  ["Night Owl", "Galimatias"],
  ["Breathe", "Télépopmusik"],
].map(([title, artist], i) => ({ id: `fallback-${i}`, title, artist, image: null }));

const LIMIT = 12;
const HITS = 10_000_000;
const DEEP = 1_000_000;

function formatCount(value) {
  if (value >= 1_000_000) {
    const m = value / 1_000_000;
    return `${m.toFixed(m >= 10 ? 1 : 2)}M`;
  }
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
  return `${value}`;
}

export function songsKit(tracks) {
  const source = tracks?.length ? tracks.slice(0, LIMIT) : FALLBACK_SONGS;
  const items = source.map((t, i) => {
    const id = `song-${t.id}`;
    return {
      id,
      title: t.title,
      meta: t.artist,
      detail: t.artist,
      feedLine: `${t.title} · ${t.artist}`,
      search: `${t.title} ${t.artist}`,
      alt: `${t.title} by ${t.artist}`,
      image: t.image || null,
      art: t.image ? null : wash(i),
      group: t.artist,
      ...figures(id),
    };
  });
  const at = (i) => items[i % items.length];

  return {
    id: "songs",
    items,
    filters: [
      { id: "all", label: "All" },
      { id: "rising", label: "Rising", test: (s) => s.delta > 0 },
      { id: "hits", label: "Hits", test: (s) => s.value >= HITS },
      { id: "deep", label: "Deep cuts", test: (s) => s.value < DEEP },
    ],
    stack: [at(2), at(1), at(0)],
    feed: [
      { id: "a1", item: at(0), event: "On repeat this week", when: "2h" },
      { id: "a2", item: at(3), event: "New in your top songs", when: "6h" },
      { id: "a3", item: at(1), event: "Streams up 5.7%", when: "1d" },
      { id: "a4", item: at(5), event: "Added to 3 playlists", when: "2d" },
      { id: "a5", item: at(2), event: "Saved by a friend", when: "3d" },
    ],
    formatValue: formatCount,
    formatDelta,
    copy: {
      browse: "Add to your bookmarks",
      library: "Library",
      searchPlaceholder: "Song or artist",
      noMatch: "No songs match",
      one: "song",
      many: "songs",
      emptyTitle: "Nothing saved yet.",
      emptyBody: "Tap the bookmark on any song and it lands here.",
      cta: "Browse songs",
      since: "Listening since 2019",
      valueLabel: "Streams",
      groupLabel: "Artists",
    },
  };
}
