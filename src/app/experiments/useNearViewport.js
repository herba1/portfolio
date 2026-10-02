"use client";

import { useEffect, useState } from "react";

/* True once the element has come within `margin` of the viewport, and true
   for good after that.

   For the expensive half of a piece — a WebGL context, a shader compile — so
   a page carrying several of them (the experiments index, stacked on a
   phone) only brings up the ones you can see or are about to. On a piece's
   own page it is on screen from the first frame, so this resolves on the
   observer's first report and costs nothing. */
export default function useNearViewport(ref, margin = "25% 0px") {
  const [near, setNear] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || near) return undefined;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        io.disconnect();
        setNear(true);
      },
      { rootMargin: margin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, margin, near]);

  return near;
}
