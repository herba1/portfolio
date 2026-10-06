"use client";

import { useEffect } from "react";

/* Once the entrance has landed, tell the pieces to measure again.

   A WebGL piece sizes its drawing buffer from getBoundingClientRect, which
   reports the TRANSFORMED box — so a canvas that mounted mid-tilt is a few
   percent small, and nothing re-measures on its own, because the layout
   never changed. One resize after the last tile settles is what react-three's
   measure (and anything else listening) re-reads. Coalesced, so eight
   landings cost one event. */
export default function IntroSettle() {
  useEffect(() => {
    let timer = 0;
    const onEnd = (event) => {
      if (event.animationName !== "xl-tile-rise") return;
      clearTimeout(timer);
      timer = setTimeout(() => window.dispatchEvent(new Event("resize")), 60);
    };
    document.addEventListener("animationend", onEnd);
    return () => {
      document.removeEventListener("animationend", onEnd);
      clearTimeout(timer);
    };
  }, []);
  return null;
}
