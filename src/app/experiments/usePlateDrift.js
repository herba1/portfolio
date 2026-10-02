"use client";

import { useEffect } from "react";

const REACH = 10; // px of lean at the plate's edge

/* A plate that answers the cursor, slightly. Embedded on the experiments
   index the shader pieces have no panel, so this is the one thing that says
   they are live.

   It never re-renders the shader. The lean is a CSS transform on the
   finished canvas — the hook only writes two custom properties on pointer
   move, and the transition in layouts.css eases them on the compositor — so
   the plate costs no GPU work and no React render however much it moves.
   Touch screens get a scroll-driven parallax instead, entirely in CSS (see
   [data-plate] in layouts.css); there is nothing to hover on a phone. */
export default function usePlateDrift(ref, enabled) {
  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el) return undefined;
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return undefined;

    const onMove = (e) => {
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      // Away from the cursor: a surface tilting under the hand, not an
      // image chasing it.
      el.style.setProperty("--drift-x", `${(-px * REACH * 2).toFixed(1)}px`);
      el.style.setProperty("--drift-y", `${(-py * REACH * 2).toFixed(1)}px`);
    };
    const onLeave = () => {
      el.style.setProperty("--drift-x", "0px");
      el.style.setProperty("--drift-y", "0px");
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    return () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
    };
  }, [ref, enabled]);
}
