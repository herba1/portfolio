import Piece from "../Piece";
import { pieceData } from "../pieceData";
import { PIECES } from "../pieces";
import IntroSettle from "../IntroSettle";

// Static, refreshed hourly: the only server data is the Spotify read, which
// pieceData caches on the same clock — so the page is served from the edge
// instead of waiting on Spotify per request.
export const revalidate = 3600;

// Bento. One screen, every piece in a tile cut to its own shape: the phone
// flow runs tall, the cover stack and the lens plate get width, the plates
// stay squarish. No captions — each piece is mounted as a component, lays
// itself out for its tile and speaks for itself.
// Grid area, and the entrance wave: row + column of the tile's top-left
// cell, so the sweep crosses the bento corner to corner.
const AREAS = {
  "/ink": { area: "ink", wave: 0 },
  "/refract": { area: "refract", wave: 1 },
  "/halftone": { area: "halftone", wave: 1 },
  "/psa": { area: "psa", wave: 2 },
  "/deck": { area: "deck", wave: 2 },
  "/backdrop": { area: "backdrop", wave: 3 },
  "/song-search": { area: "song", wave: 3 },
  "/tuner": { area: "tuner", wave: 4 },
};

export default async function BentoLayout() {
  const data = await pieceData();
  return (
    <main className="xl-bento">
      <h1 className="sr-only">Experiments</h1>
      <ul className="xl-bento__grid">
        {PIECES.map((piece, i) => (
          <li
            key={piece.slug}
            className="xl-bento__tile xl-tile"
            aria-label={piece.title}
            style={{
              gridArea: AREAS[piece.slug]?.area ?? "auto",
              "--wave": AREAS[piece.slug]?.wave ?? i,
            }}
          >
            <Piece slug={piece.slug} data={data} />
          </li>
        ))}
      </ul>
      <IntroSettle />
    </main>
  );
}
