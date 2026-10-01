import { CARDS, formatDelta, formatPrice } from "./cards";

/* ─────────────────────────────────────────────────────────────────────────
   Kits — what the collection app is a collection OF.

   Everything that moves — the save flight, the tab count, the FLIP reflows,
   the odometer figures, undo — is content-blind. A kit is the part that is
   not: the items, the chips that filter them, the words on each surface and
   the shape of the art. Swap the kit and the same app collects something
   else.

   Every item is normalised to one shape so no surface has to know which kit
   it is drawing: id, title, meta (the tile's second line), alt, image and
   art (a wash when there is no image). A kit with the full app adds detail
   (the ledger row's line), feedLine, search, value + delta (the live
   figures' opening values) and group (what Profile counts distinct of).
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
  // The whole app: live figures on every tile, five tabs.
  figures: true,
  tabs: ["browse", "search", "collection", "activity", "profile"],
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

export function songsKit(tracks) {
  const source = tracks?.length ? tracks.slice(0, LIMIT) : FALLBACK_SONGS;
  const items = source.map((t, i) => {
    const id = `song-${t.id}`;
    return {
      id,
      title: t.title,
      meta: t.artist,
      alt: `${t.title} by ${t.artist}`,
      image: t.image || null,
      art: t.image ? null : wash(i),
    };
  });
  /* Only the gesture. A song has no price worth rolling and the other four
     tabs have nothing to say about one, so this kit is the save and nothing
     around it: the grid, the bookmark, the flight into the one footer target,
     its count and undo. */
  return {
    id: "songs",
    items,
    figures: false,
    filters: [],
    tabs: ["collection"],
    copy: {
      browse: "Add to your bookmarks",
      library: "Saved",
    },
  };
}
