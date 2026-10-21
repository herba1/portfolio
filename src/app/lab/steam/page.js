import { notFound } from "next/navigation";
import { isProdView } from "@/lib/viewMode";
import PieceBox from "@/app/experiments/PieceBox";
import Piece from "./Piece";
import manifest from "./experiment.json";

export const metadata = { title: manifest.title, description: manifest.description };

export default function Page() {
  if (isProdView() && manifest.status !== "shipped") notFound();
  return (
    <PieceBox viewport>
      <Piece />
    </PieceBox>
  );
}
