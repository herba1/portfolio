"use client";

import { useEffect, useRef, useState } from "react";
import PieceBox from "../PieceBox";

/* A piece's box that mounts the piece only once it is near the viewport, and
   then on its beat in the entrance wave rather than all at once.

   Mounting is the expensive moment — a shader compiles, a WebGL context
   comes up, art decodes — and eight of them in one tick is a long task
   squarely inside the entrance. Spread across the wave, each lands as its
   own tile rises. Stacked on a phone, the pieces below the fold do not
   mount at all until they are scrolled near, so the first screen pays for
   the first screen only. Once mounted a piece stays mounted. */
export default function Deferred({ delay = 0, className = "", children }) {
  const ref = useRef(null);
  const [on, setOn] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    let timer = 0;
    let first = true;
    const io = new IntersectionObserver(
      ([entry]) => {
        // Only the first report can be "on screen at load"; anything that
        // turns up later scrolled in, and has no wave to wait for.
        const wait = first ? delay : 0;
        first = false;
        if (!entry.isIntersecting) return;
        io.disconnect();
        timer = setTimeout(() => setOn(true), wait);
      },
      { rootMargin: "50% 0px" },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      clearTimeout(timer);
    };
  }, [delay]);

  return (
    <PieceBox ref={ref} className={className}>
      {on ? children : null}
    </PieceBox>
  );
}
