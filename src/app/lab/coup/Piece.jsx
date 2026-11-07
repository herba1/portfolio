"use client";

import { useEffect, useRef, useState } from "react";

import "./coup.css";

export default function Piece({ embedded = false }) {
  const ref = useRef(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const host = ref.current;
    if (!host) return undefined;
    let cancelled = false;
    let engine = null;
    const start = async () => {
      const { createCoup } = await import("./coupEngine");
      if (cancelled) return;
      engine = await createCoup(host, { embedded });
      if (cancelled) engine?.destroy();
      else setReady(true);
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
  return (
    <Root
      ref={ref}
      className="coup"
      data-ready={ready ? "" : undefined}
      lang="fr"
      aria-label="Un coup de dés jamais n’abolira le hasard"
    />
  );
}
