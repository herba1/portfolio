import PieceBox from "../PieceBox";
import LivePiece from "./LivePiece";
import { POSTERS } from "./posters";

// A tile on the index. The server sends only the poster and the props a piece
// needs fetched (Deck's tracks); the piece itself is a lazy chunk that
// LivePiece mounts when the tile nears the viewport. `priority` marks the
// tiles in the first screen, whose posters load ahead of everything else.
export default function Piece({ slug, data, title, priority = false, className = "" }) {
  return (
    <PieceBox className={`xl-piece ${className}`.trim()}>
      <LivePiece slug={slug} data={data?.[slug]} poster={POSTERS[slug]} priority={priority} title={title} />
    </PieceBox>
  );
}
