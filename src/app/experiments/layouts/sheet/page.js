import Piece from "../Piece";
import { pieceData } from "../pieceData";
import { PIECES } from "../pieces";
import IntroSettle from "../IntroSettle";

const COLUMNS = 4;
const wave = (i) => (i % COLUMNS) + Math.floor(i / COLUMNS);

// Sheet. A strict grid that fills exactly one screen: every piece at the
// same size, running, nothing but the pieces.
export default async function SheetLayout() {
  const data = await pieceData();
  return (
    <main className="xl-sheet">
      <h1 className="sr-only">Experiments</h1>
      <ul className="xl-sheet__grid">
        {PIECES.map((piece, i) => (
          <li
            key={piece.slug}
            className="xl-sheet__cell xl-tile"
            aria-label={piece.title}
            // Row + column on the four-up grid: the entrance wave's diagonal.
            style={{ "--wave": wave(i) }}
          >
            <Piece slug={piece.slug} data={data} wave={wave(i)} />
          </li>
        ))}
      </ul>
      <IntroSettle />
    </main>
  );
}
