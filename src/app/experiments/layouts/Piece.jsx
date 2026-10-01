import PieceBox from "../PieceBox";
import InkExperience from "@/app/ink/InkExperience";
import RefractExperience from "@/app/refract/RefractExperience";
import HalftoneExperience from "@/app/halftone/HalftoneExperience";
import BackdropExperience from "@/app/backdrop/BackdropExperience";
import SongSearch from "@/app/song-search/SongSearch";
import Deck from "@/app/deck/Deck";
import PsaExperience from "@/app/psa/PsaExperience";
import TunerExperience from "@/app/tuner/TunerExperience";

// Every piece, as a component, keyed by its route. Each fills the box it is
// given; `embedded` drops tuning panels and dev controls.
const COMPONENTS = {
  "/ink": InkExperience,
  "/refract": RefractExperience,
  "/halftone": HalftoneExperience,
  "/backdrop": BackdropExperience,
  "/song-search": SongSearch,
  "/deck": Deck,
  "/psa": PsaExperience,
  "/tuner": TunerExperience,
};

export function hasPiece(slug) {
  return slug in COMPONENTS;
}

// `data` carries anything a piece needs fetched on the server (Deck's tracks).
export default function Piece({ slug, data, className = "" }) {
  const Component = COMPONENTS[slug];
  if (!Component) return null;
  return (
    <PieceBox className={`xl-piece ${className}`.trim()}>
      <Component embedded {...(data?.[slug] ?? {})} />
    </PieceBox>
  );
}
