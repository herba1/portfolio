"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";

// Lightweight orchestrator for the one-shot welcome burst.
//
// It imports nothing heavy: the gravity engine + renderer live in
// IntroSplashStage, which is lazy-loaded (ssr:false) only once we've decided to
// play. We also wait for the main thread to go idle before mounting it, so the
// burst never competes with hydration or first paint.
//
// Plays on every full page load — first visit, refresh, new tab, external link.
// It does NOT replay on in-app (soft) navigation, because the root layout and
// this component stay mounted across client-side route changes. Skipped under
// prefers-reduced-motion.
const Stage = dynamic(() => import("./IntroSplashStage"), { ssr: false });

// Module-scoped: survives a StrictMode setup→cleanup→setup cycle (and any
// remount within the same page load) so the burst fires exactly once per load —
// this is what kills the dev-mode "double start". It resets on a real page
// reload, so a refresh replays the burst as intended.
let hasCommitted = false;

export default function IntroSplash() {
  const [play, setPlay] = useState(false);

  useEffect(() => {
    if (hasCommitted) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;

    // Commit only when the deferred start actually fires. Committing here (not
    // at effect setup) lets StrictMode's cleanup cancel the first schedule while
    // the second schedule still runs — exactly once, never twice.
    const start = () => {
      if (hasCommitted) return;
      hasCommitted = true;
      setPlay(true);
    };

    let idleId;
    let timeoutId;
    if ("requestIdleCallback" in window) {
      idleId = window.requestIdleCallback(start, { timeout: 1500 });
    } else {
      timeoutId = window.setTimeout(start, 300);
    }

    return () => {
      if (idleId != null && "cancelIdleCallback" in window) {
        window.cancelIdleCallback(idleId);
      }
      if (timeoutId != null) window.clearTimeout(timeoutId);
    };
  }, []);

  if (!play) return null;
  return <Stage onDone={() => setPlay(false)} />;
}
