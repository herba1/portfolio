import Board from "./Board";
import { pieceData } from "../pieceData";
import { PIECES } from "../pieces";

// C — Board. A salon hang on an endless wall: pieces at different sizes, each
// with a wall label beside it, all running. The page opens fitted so you see
// the whole wall; drag the wall to move, pinch or ⌘-scroll to get closer.
export default async function BoardLayout() {
  return <Board pieces={PIECES} data={await pieceData()} />;
}
