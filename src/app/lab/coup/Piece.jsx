"use client";

import { Newsreader } from "next/font/google";
import { useEffect, useRef, useState } from "react";

import "./coup.css";

// The poem's second voice. Mallarmé's page is roman against italic: the
// main sentence and its capitals in one cut, the subordinate threads in
// another, so they read as counter-melodies. Newsreader (Production Type,
// OFL) carries a real optical-size axis, so "opsz" 10 sets the sturdy
// small-text italic beside the grotesk.
const serif = Newsreader({ subsets: ["latin"], axes: ["opsz"], style: ["italic"], display: "block", variable: "--coup-serif-face" });

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
      className={`coup ${serif.variable}`}
      data-ready={ready ? "" : undefined}
      lang="fr"
      aria-label="Un coup de dés jamais n’abolira le hasard"
    />
  );
}
