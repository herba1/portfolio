import Piece from "../Piece";
import { pieceData } from "../pieceData";
import { PIECES } from "../pieces";

// Bento. One screen, every piece in a tile cut to its own shape: the phone
// flow runs tall, the cover stack and the lens plate get width, the plates
// stay squarish. No captions — each piece is mounted as a component, lays
// itself out for its tile and speaks for itself.
const AREAS = {
  "/ink": "ink",
  "/refract": "refract",
  "/halftone": "halftone",
  "/backdrop": "backdrop",
  "/song-search": "song",
  "/deck": "deck",
  "/psa": "psa",
  "/tuner": "tuner",
};

export default async function BentoLayout() {
  const data = await pieceData();
  return (
    <main className="xl-bento">
      <h1 className="sr-only">Experiments</h1>
      <ul className="xl-bento__grid">
        {PIECES.map((piece) => (
          <li
            key={piece.slug}
            className="xl-bento__tile"
            aria-label={piece.title}
            style={{ gridArea: AREAS[piece.slug] ?? "auto" }}
          >
            <Piece slug={piece.slug} data={data} />
          </li>
        ))}
      </ul>
    </main>
  );
}
