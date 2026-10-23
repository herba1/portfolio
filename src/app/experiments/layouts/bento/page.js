import Piece from "../Piece";
import { pieceData } from "../pieceData";
import { PIECES } from "../pieces";
import IntroSettle from "../IntroSettle";
import PlateHand from "../PlateHand";
import OffscreenPause from "../OffscreenPause";
import ScrollGuard from "../ScrollGuard";

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
  "/ascii-cover": { area: "ascii", wave: 13, dx: 1 },
  "/wet-ink": { area: "wetink", wave: 15, dx: -1 },
  "/one-line": { area: "oneline", wave: 16, dx: 1 },
  "/counter": { area: "counter", wave: 14, dx: 0 },
  "/taffy": { area: "taffy", wave: 17, dx: 0 },
  "/scorch": { area: "scorch", wave: 18, dx: -1 },
  "/stir": { area: "stir", wave: 19, dx: 1 },
};

const PLACED = PIECES.filter((piece) => AREAS[piece.slug]);

// Which tiles fill the first screen: the bento's top waves on a desktop, the
// first two of the stack on a phone (which follows source order).
const DESKTOP = "(min-width: 900px)";
const PHONE = "(max-width: 899px)";
function firstScreen(slug, index) {
  const desktop = (AREAS[slug]?.wave ?? 99) < 5;
  const phone = index < 2;
  if (desktop && phone) return "all";
  return desktop ? DESKTOP : phone ? PHONE : null;
}
// Studies take a whole row or half of one (their manifest's tile.shape), each
// as tall as the screen. Halves pair up; an odd one out takes the row.
const STUDIES = PIECES.filter((piece) => !AREAS[piece.slug]);
const TALL = STUDIES.filter((piece) => piece.tile?.shape === "tall");
const shapeOf = (piece) => (piece.tile?.shape === "tall" && !(TALL.length % 2 && piece === TALL.at(-1)) ? "tall" : "wide");

export default async function BentoLayout() {
  const data = await pieceData();
  return (
    <main className="xl-bento">
      <h1 className="sr-only">Experiments</h1>
      <ul className="xl-bento__grid">
        {PLACED.map((piece, i) => (
          <li
            key={piece.slug}
            className="xl-bento__tile xl-tile"
            data-slug={piece.slug}
            aria-label={piece.title}
            style={{
              gridArea: AREAS[piece.slug]?.area ?? "auto",
              "--wave": AREAS[piece.slug]?.wave ?? i,
              "--dx": AREAS[piece.slug]?.dx ?? 0,
            }}
          >
            <Piece slug={piece.slug} data={data} title={piece.title} priority={firstScreen(piece.slug, i)} />
          </li>
        ))}
      </ul>
      {STUDIES.length ? (
        <ul className="xl-bento__grid xl-bento__grid--studies">
          {STUDIES.map((piece) => (
            <li
              key={piece.slug}
              className="xl-bento__tile xl-tile xl-tile--study"
              data-slug={piece.slug}
              data-shape={shapeOf(piece)}
              aria-label={piece.title}
            >
              <Piece slug={piece.slug} data={data} title={piece.title} />
            </li>
          ))}
        </ul>
      ) : null}
      <PlateHand />
      <OffscreenPause />
      <ScrollGuard />
      <IntroSettle />
    </main>
  );
}
