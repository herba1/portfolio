"use client";

import { useEffect, useRef, useState } from "react";

/* Mount a browser-only component without going through Suspense.
 *
 * next/dynamic({ ssr: false }) mounts via React.lazy, so the component's
 * arrival on the client is a *Suspense reveal*. Every page sits inside
 * <ViewTransition name="page-content"> (see layout.js), and React runs a view
 * transition on Suspense reveals — so a lazy chunk landing a beat after
 * hydration replays the whole-page `page-enter` keyframes: the page drops 2%
 * and slides back up, with the old snapshot cross-fading out. That's the
 * post-load "flash" — and a page with two such chunks flashes twice.
 *
 * Resolving the import in an effect and swapping the component in with plain
 * state keeps the mount an ordinary update, which React never view-transitions.
 * `fallback` renders until then, so it can reserve layout height.
 */
export default function ClientOnly({ load, fallback = null, ...props }) {
  const [Comp, setComp] = useState(null);
  // The `load` thunk is usually written inline, so it's a new function every
  // render — pin it to a ref and import exactly once, on mount.
  const loadRef = useRef(load);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve(loadRef.current()).then((mod) => {
      if (!cancelled) setComp(() => mod.default ?? mod);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return Comp ? <Comp {...props} /> : fallback;
}
