import PieceBox from "../PieceBox";
import LivePiece from "./LivePiece";
import { POSTERS } from "./posters";

// A tile on the index. The server sends only the poster and the props a piece
// needs fetched (Deck's tracks); the piece itself is a lazy chunk that
// LivePiece mounts when the tile nears the viewport. `priority` is the media
// query under which the tile is in the first screen, so its poster loads
// ahead of everything else there.
export default function Piece({ slug, data, title, priority = null, className = "" }) {
  return (
    <PieceBox className={`xl-piece ${className}`.trim()}>
      <LivePiece slug={slug} data={data?.[slug]} poster={POSTERS[slug]} priority={priority} title={title} />
    </PieceBox>
  );
}
