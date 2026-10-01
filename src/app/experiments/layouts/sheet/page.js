import Piece from "../Piece";
import { pieceData } from "../pieceData";
import { PIECES } from "../pieces";

// Sheet. A strict grid that fills exactly one screen: every piece at the
// same size, running, nothing but the pieces.
export default async function SheetLayout() {
  const data = await pieceData();
  return (
    <main className="xl-sheet">
      <h1 className="sr-only">Experiments</h1>
      <ul className="xl-sheet__grid">
        {PIECES.map((piece) => (
          <li key={piece.slug} className="xl-sheet__cell" aria-label={piece.title}>
            <Piece slug={piece.slug} data={data} />
          </li>
        ))}
      </ul>
    </main>
  );
}
