import Piece from "../Piece";
import { pieceData } from "../pieceData";

// Test bench: one piece in boxes of several shapes at once, side by side.
// /experiments/layouts/box?piece=deck
const BOXES = [
  [340, 440],
  [440, 560],
  [720, 450],
  [1000, 640],
];

export default async function BoxBench({ searchParams }) {
  const { piece = "ink" } = await searchParams;
  const slug = `/${piece}`;
  const data = await pieceData();
  return (
    <main className="flex flex-wrap items-start gap-4 px-6 pt-20 pb-24">
      {BOXES.map(([w, h]) => (
        <div key={`${w}x${h}`} style={{ width: w, height: h }} className="xl-bench">
          <Piece slug={slug} data={data} />
        </div>
      ))}
    </main>
  );
}
