"use client";

import { useEffect } from "react";

// Drives a field with a requestAnimationFrame loop (for DOM / canvas renderers).
// Each frame: measure → field.step(dt) → place(particles). Handles resize and
// prefers-reduced-motion. R3F renderers don't use this — they step the field
// from their own useFrame instead.
//
//   useFieldLoop(field, place, [deps])
//     field  — from createField()
//     place  — (particles) => void, paints the current frame
//     deps   — re-bind the loop when these change (e.g. the particle set)
export function useFieldLoop(field, place, deps = []) {
  useEffect(() => {
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const measure = () => field.resize(window.innerWidth, window.innerHeight);
    measure();
    window.addEventListener("resize", measure);

    if (reduce) {
      field.settleStatic();
      place(field.particles);
      return () => window.removeEventListener("resize", measure);
    }

    let raf = 0;
    let last = performance.now();
    const tick = (now) => {
      const dt = Math.min((now - last) / 1000, 0.04); // clamp tab-switch jumps
      last = now;
      field.step(dt);
      place(field.particles);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", measure);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
