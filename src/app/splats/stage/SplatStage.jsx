"use client";

import { useLayoutEffect, useRef } from "react";
import { attach, defineActors, inspect, manualClock } from "./stage";

// The fixed layer the stage's canvas lives in. Rendered by the splats layout,
// so it exists on the index and on every article. The element is named
// `splat-stage` for view transitions (see transitions.css): during a route
// change its old snapshot is hidden and the live canvas keeps painting, so a
// splat in flight is never frozen into a screenshot.
export default function SplatStage({ items }) {
  const hostRef = useRef(null);

  useLayoutEffect(() => {
    defineActors(items);
    const detach = attach(hostRef.current);
    if (process.env.NODE_ENV !== "production") {
      window.__splatStage = inspect;
      window.__splatClock = manualClock;
    }
    return detach;
  }, [items]);

  return <div ref={hostRef} className="splat-stage" aria-hidden="true" />;
}
