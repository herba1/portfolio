import Link from "next/link";
import { PIECES } from "../pieces";

// B — Slices. The screen cut into one full-height slot per piece. Each piece
// runs at true size behind its slot, centred, so you see a real strip of it;
// the slot under the pointer opens wide and the rest close up but stay live.
export default function SlicesLayout() {
  return (
    <main className="xl-slices">
      <h1 className="sr-only">Experiments</h1>
      {PIECES.map((piece) => (
        <section key={piece.slug} className="xl-slice" aria-label={piece.title}>
          <div className="xl-slice__window">
            <iframe src={piece.slug} title={piece.title} allow="microphone; autoplay; clipboard-write" />
          </div>
          <Link href={piece.slug} className="xl-slice__caption">
            <span className="text-ink-secondary text-ui-lg tabular-nums">{piece.index}</span>
            <span className="text-ink text-heading-sm truncate">{piece.title}</span>
          </Link>
        </section>
      ))}
    </main>
  );
}
