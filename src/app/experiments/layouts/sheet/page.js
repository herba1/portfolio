import Link from "next/link";
import LiveFrame from "../LiveFrame";
import { PIECES, shortDate } from "../pieces";

// B — Contact sheet. A strict grid that fills exactly one screen: every piece
// at the same size, running, with a caption rule under it like a proof sheet.
export default function SheetLayout() {
  return (
    <main className="xl-sheet">
      <header className="xl-sheet__head">
        <h1 className="text-ink text-title-sm">Experiments</h1>
        <span className="text-ink-secondary text-ui-lg tabular-nums">{PIECES.length} pieces, all running</span>
      </header>
      <ul className="xl-sheet__grid">
        {PIECES.map((piece) => (
          <li key={piece.slug} className="xl-sheet__cell">
            <LiveFrame src={piece.slug} title={piece.title} base={piece.base} />
            <Link href={piece.slug} className="xl-caption">
              <span className="text-ink-secondary text-ui-lg tabular-nums">{piece.index}</span>
              <span className="text-ink text-heading-sm">{piece.title}</span>
              <span className="text-ink-secondary text-ui-lg ml-auto tabular-nums">{shortDate(piece.date)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
