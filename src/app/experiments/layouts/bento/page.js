import Link from "next/link";
import Piece from "../Piece";
import { pieceData } from "../pieceData";
import { PIECES } from "../pieces";

// A — Bento. One screen, every piece in a tile cut to its own shape: the
// phone flow runs the full height, the cover stack and the lens plate get
// width, the plates stay squarish. Each piece is mounted as a component and
// lays itself out for its tile.
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
          <li key={piece.slug} className="xl-bento__tile" style={{ gridArea: AREAS[piece.slug] ?? "auto" }}>
            <Link href={piece.slug} className="xl-caption xl-caption--top">
              <span className="text-ink-secondary text-ui-lg tabular-nums">{piece.index}</span>
              <span className="text-ink text-heading-sm">{piece.title}</span>
              <span className="text-ink-secondary text-ui-lg ml-auto truncate">{piece.tags.join(", ")}</span>
            </Link>
            <Piece slug={piece.slug} data={data} />
          </li>
        ))}
      </ul>
    </main>
  );
}
