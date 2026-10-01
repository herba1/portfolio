import Link from "next/link";
import Piece from "../Piece";
import { pieceData } from "../pieceData";
import { PIECES, shortDate } from "../pieces";

// D — Timeline. Pieces stack up from the day they shipped, so the page reads
// as a skyline of output. Columns are evenly spaced for room; the calendar
// rule underneath is to scale, and a leader ties each column to its true day.
const DAY = 86400000;

const byDate = new Map();
for (const piece of [...PIECES].sort((a, b) => (a.date < b.date ? -1 : 1))) {
  if (!byDate.has(piece.date)) byDate.set(piece.date, []);
  byDate.get(piece.date).push(piece);
}
const COLUMNS = [...byDate.entries()].map(([date, pieces]) => ({ date, pieces }));

const first = new Date(COLUMNS[0].date);
const start = new Date(first.getFullYear(), first.getMonth(), 1);
const lastDate = new Date(COLUMNS.at(-1).date);
const end = new Date(lastDate.getFullYear(), lastDate.getMonth() + 1, 1);
const span = end - start;
const at = (iso) => ((new Date(iso) - start) / span) * 100;

const MONTH_TICKS = [];
for (let d = new Date(start); d < end; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
  MONTH_TICKS.push({ pct: ((d - start) / span) * 100, label: d.toLocaleString("en-US", { month: "short" }) });
}
const DAY_COUNT = Math.round(span / DAY);

export default async function TimelineLayout() {
  const data = await pieceData();
  const n = COLUMNS.length;
  return (
    <main className="xl-timeline" style={{ "--cols": n }}>
      <header className="xl-sheet__head">
        <h1 className="text-ink text-title-sm">Experiments</h1>
        <span className="text-ink-secondary text-ui-lg tabular-nums">
          {PIECES.length} pieces over {DAY_COUNT} days
        </span>
      </header>

      <div className="xl-timeline__skyline">
        {COLUMNS.map((col) => (
          <div key={col.date} className="xl-timeline__col">
            {[...col.pieces].reverse().map((piece) => (
              <div key={piece.slug} className="xl-timeline__piece">
                <div className="xl-timeline__frame" style={{ "--aspect": Math.min(piece.aspect, 4 / 5) }}>
                  <Piece slug={piece.slug} data={data} />
                </div>
                <Link href={piece.slug} className="xl-caption">
                  <span className="text-ink text-heading-sm">{piece.title}</span>
                  <span className="text-ink-secondary text-ui-lg ml-auto truncate">{piece.tags.join(", ")}</span>
                </Link>
              </div>
            ))}
            <span className="xl-timeline__date text-ink text-ui-lg tabular-nums">{shortDate(col.date)}</span>
          </div>
        ))}
      </div>

      <svg className="xl-timeline__leaders" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        {COLUMNS.map((col, i) => (
          <line
            key={col.date}
            x1={((i + 0.5) / n) * 100}
            y1="0"
            x2={at(col.date)}
            y2="100"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>

      <div className="xl-timeline__axis">
        {MONTH_TICKS.map((tick) => (
          <span key={tick.pct} className="xl-timeline__month text-ink-secondary text-ui-lg" style={{ left: `${tick.pct}%` }}>
            {tick.label}
          </span>
        ))}
        {COLUMNS.map((col) => (
          <span key={col.date} className="xl-timeline__day" style={{ left: `${at(col.date)}%` }} />
        ))}
      </div>
    </main>
  );
}
