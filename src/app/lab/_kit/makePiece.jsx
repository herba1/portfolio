"use client";

import { useEffect, useRef, useState } from "react";

import "./kit.css";

// A factory piece is a canvas engine mounted once the box nears the screen.
// `load` returns the engine module's create(host, { embedded }) function.
export function makePiece(name, load) {
  function Piece({ embedded = false }) {
    const hostRef = useRef(null);
    const [ready, setReady] = useState(false);

    useEffect(() => {
      const host = hostRef.current;
      if (!host) return undefined;
      let cancelled = false;
      let engine = null;
      const start = async () => {
        try {
          const create = await load();
          if (cancelled) return;
          engine = await create(host, { embedded });
          if (cancelled) engine?.destroy();
          else setReady(true);
        } catch (error) {
          console.warn(`${name}: could not start`, error);
        }
      };
      const io = new IntersectionObserver(
        ([entry]) => {
          if (!entry.isIntersecting) return;
          io.disconnect();
          start();
        },
        { rootMargin: "240px" },
      );
      io.observe(host);
      return () => {
        cancelled = true;
        io.disconnect();
        engine?.destroy();
      };
    }, [embedded]);

    const Root = embedded ? "div" : "main";
    return <Root ref={hostRef} className={`kit-piece kit-${name}`} data-ready={ready ? "" : undefined} aria-label={name} />;
  }
  Piece.displayName = `Piece(${name})`;
  return Piece;
}
