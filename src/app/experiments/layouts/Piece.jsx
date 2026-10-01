import Deferred from "./Deferred";
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

// `data` carries anything a piece needs fetched on the server (Deck's tracks).
// `wave` is the tile's step in the entrance; the piece mounts on that beat.
const MOUNT_STEP = 90; // ms per wave step

export default function Piece({ slug, data, wave = 0, className = "" }) {
  const Component = COMPONENTS[slug];
  if (!Component) return null;
  return (
    <Deferred className={`xl-piece ${className}`.trim()} delay={wave * MOUNT_STEP}>
      <Component embedded {...(data?.[slug] ?? {})} />
    </Deferred>
  );
}
