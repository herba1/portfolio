import { SPLATS } from "./data";
import SplatStage from "./stage/SplatStage";
import "./splats.css";

// One stage for every splat route. The layout remounts on each navigation
// (PageTransition keys by pathname); the stage underneath is a singleton and
// survives it — see stage/stage.js.
export default function SplatsLayout({ children }) {
  return (
    <>
      <SplatStage items={SPLATS} />
      {children}
    </>
  );
}
