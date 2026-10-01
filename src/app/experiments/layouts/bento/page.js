import Link from "next/link";
import LiveFrame from "../LiveFrame";
import { PIECES } from "../pieces";

// A — Bento. One screen, every piece in a tile cut to its own shape: the
// phone flow runs the full height, the cover stack and the lens plate get
// width, the plates stay squarish. Each runs at the size it reads best.
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

export default function BentoLayout() {
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
            <LiveFrame src={piece.slug} title={piece.title} base={piece.base} />
          </li>
        ))}
      </ul>
    </main>
  );
}
