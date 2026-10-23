import Piece from "../Piece";
import { pieceData } from "../pieceData";
import { PIECES } from "../pieces";
import IntroSettle from "../IntroSettle";
import OffscreenPause from "../OffscreenPause";
import ScrollGuard from "../ScrollGuard";
import TileDemos from "../TileDemos";
import { DEMOS } from "../demos";
import AudioGate from "../AudioGate";

// Static, refreshed hourly: the only server data is the Spotify read, which
// pieceData caches on the same clock — so the page is served from the edge
// instead of waiting on Spotify per request.
export const revalidate = 3600;

// Bento. One screen, every piece in a tile cut to its own shape: the phone
// flow runs tall, the cover stack and the lens plate get width, the plates
// stay squarish. No captions — each piece is mounted as a component, lays
// itself out for its tile and speaks for itself.
// Grid area, and the entrance order: row band first, then left to right within
// it, so the tiles drop in like a mosaic filling from the top-left.
const AREAS = {
  "/ink": { area: "ink", wave: 3, dx: -1 },
  "/refract": { area: "refract", wave: 0, dx: 0 },
  "/halftone": { area: "halftone", wave: 4, dx: 0 },
  "/flyout": { area: "flyout", wave: 2, dx: 1 },
  "/deck": { area: "deck", wave: 6, dx: 0 },
  "/backdrop": { area: "backdrop", wave: 8, dx: 1 },
  "/song-search": { area: "song", wave: 9, dx: -1 },
  "/tuner": { area: "tuner", wave: 10, dx: 0 },
  "/blobs": { area: "flowers", wave: 11, dx: 0 },
  "/cover-ring": { area: "ring", wave: 12, dx: -1 },
  "/wet-ink": { area: "wetink", wave: 15, dx: -1 },
  "/one-line": { area: "oneline", wave: 16, dx: 1 },
  "/counter": { area: "counter", wave: 14, dx: 0 },
  "/taffy": { area: "taffy", wave: 17, dx: 0 },
  "/scorch": { area: "scorch", wave: 18, dx: -1 },
  "/stir": { area: "stir", wave: 19, dx: 1 },
};

const PLACED = PIECES.filter((piece) => AREAS[piece.slug]);

// Studies take a whole row or half of one (their manifest's tile.shape), each
// as tall as the screen. A half waits in source order for the next half to
// share its row, so reading order and tab order follow the rows as drawn;
// an odd one out takes the row.
function pairHalves(pieces) {
  const ordered = [];
  let waiting = null;
  for (const piece of pieces) {
    if (piece.tile?.shape !== "tall") ordered.push({ piece, shape: "wide" });
    else if (waiting) {
      ordered.push(waiting, { piece, shape: "tall" });
      waiting = null;
    } else waiting = { piece, shape: "tall" };
  }
  if (waiting) ordered.push({ ...waiting, shape: "wide" });
  return ordered;
}
// The lab studies lead, newest first (the registry's order), with the
// 8-Bit Player up front; the older hand-placed mosaic follows them.
const FEATURED = ["/lab/skin"];
const featuredFirst = (pieces) => [...pieces].sort((a, b) => (FEATURED.includes(b.slug) ? 1 : 0) - (FEATURED.includes(a.slug) ? 1 : 0));
const STUDIES = pairHalves(featuredFirst(PIECES.filter((piece) => !AREAS[piece.slug])));
// The first row of studies is the first screen everywhere.
const firstScreen = (index) => (index < 2 ? "all" : null);

// Takes the tile's touch on a phone (ScrollGuard): until it is pressed a
// finger only swipes a piece sideways and the page keeps vertical scroll.
// The idle demo a tile hands to TileDemos, as JSON on the tile.
const demoOf = (piece) => {
  const demo = piece.demo ?? DEMOS[piece.slug];
  return demo ? JSON.stringify(demo) : undefined;
};

function FocusButton() {
  return (
    <button type="button" className="xl-focus" data-tile-focus aria-pressed="false">
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        <path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" />
      </svg>
      <span className="xl-focus__idle">Focus</span>
      <span className="xl-focus__on">Done</span>
    </button>
  );
}

export default async function BentoLayout() {
  const data = await pieceData();
  return (
    <main className="xl-bento">
      <h1 className="sr-only">Experiments</h1>
      {STUDIES.length ? (
        <ul className="xl-bento__grid xl-bento__grid--studies">
          {STUDIES.map(({ piece, shape }, i) => (
            <li
              key={piece.slug}
              className="xl-bento__tile xl-tile xl-tile--study"
              data-slug={piece.slug}
              data-shape={shape}
              data-demo={demoOf(piece)}
              aria-label={piece.title}
            >
              <Piece slug={piece.slug} data={data} title={piece.title} priority={firstScreen(i)} />
              <FocusButton />
            </li>
          ))}
        </ul>
      ) : null}
      <ul className="xl-bento__grid">
        {PLACED.map((piece, i) => (
          <li
            key={piece.slug}
            className="xl-bento__tile xl-tile"
            data-slug={piece.slug}
            data-demo={demoOf(piece)}
            aria-label={piece.title}
            style={{
              gridArea: AREAS[piece.slug]?.area ?? "auto",
              "--wave": AREAS[piece.slug]?.wave ?? i,
              "--dx": AREAS[piece.slug]?.dx ?? 0,
            }}
          >
            <Piece slug={piece.slug} data={data} title={piece.title} />
            <FocusButton />
          </li>
        ))}
      </ul>
      <OffscreenPause />
      <AudioGate />
      <ScrollGuard />
      <TileDemos />
      <IntroSettle />
    </main>
  );
}
