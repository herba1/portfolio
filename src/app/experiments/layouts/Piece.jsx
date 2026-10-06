import PieceBox from "../PieceBox";
import InkExperience from "@/app/ink/InkExperience";
import RefractExperience from "@/app/refract/RefractExperience";
import HalftoneExperience from "@/app/halftone/HalftoneExperience";
import BackdropExperience from "@/app/backdrop/BackdropExperience";
import SongSearch from "@/app/song-search/SongSearch";
import Deck from "@/app/deck/Deck";
import FlyoutExperience from "@/app/flyout/FlyoutExperience";
import TunerExperience from "@/app/tuner/TunerExperience";
import CoverRing from "@/app/cover-ring/CoverRing";
import AsciiCover from "@/app/ascii-cover/AsciiCover";
import BlobPiece from "@/app/blobs/BlobPiece";

// Every piece, as a component, keyed by its route. Each fills the box it is
// given; `embedded` drops tuning panels and dev controls.
const COMPONENTS = {
  "/ink": InkExperience,
  "/refract": RefractExperience,
  "/halftone": HalftoneExperience,
  "/backdrop": BackdropExperience,
  "/song-search": SongSearch,
  "/deck": Deck,
  "/flyout": FlyoutExperience,
  "/tuner": TunerExperience,
  "/blobs": BlobPiece,
  "/cover-ring": CoverRing,
  "/ascii-cover": AsciiCover,
};

// `data` carries anything a piece needs fetched on the server (Deck's tracks).
// Every piece renders on the server, so its tile arrives with real content;
// the expensive half of the WebGL pieces waits for the viewport inside the
// piece itself (useNearViewport), not here.
export default function Piece({ slug, data, className = "" }) {
  const Component = COMPONENTS[slug];
  if (!Component) return null;
  return (
    <PieceBox className={`xl-piece ${className}`.trim()}>
      <Component embedded {...(data?.[slug] ?? {})} />
    </PieceBox>
  );
}
