"use client";

import { useEffect, useRef, useState } from "react";

import { PLANES } from "./landscapeContent";
import "./landscape.css";

function Plane({ p }) {
  if (p.kind === "title") {
    return (
      <div className="ls-plane ls-title" data-id={p.id}>
        <p className="ls-kicker">{p.kicker}</p>
        <h2 className="ls-title-h">{p.title}</h2>
        <p className="ls-sub">{p.sub}</p>
      </div>
    );
  }
  if (p.kind === "chapter") {
    return (
      <div className="ls-plane ls-chapter" data-id={p.id}>
        <p className="ls-when">
          <span className="ls-n">{p.n}</span>
          {p.when}
        </p>
        <h3 className="ls-chapter-h">{p.title}</h3>
        <p className="ls-line">{p.line}</p>
      </div>
    );
  }
  if (p.kind === "entry") {
    return (
      <div className="ls-plane ls-entry" data-id={p.id}>
        <p className="ls-date">{p.date}</p>
        <h4 className="ls-entry-h">{p.title}</h4>
        <p className="ls-body">{p.body}</p>
      </div>
    );
  }
  return (
    <div className="ls-plane ls-note" data-id={p.id}>
      {p.lines.map((l) => (
        <p key={l}>{l}</p>
      ))}
    </div>
  );
}

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    let cancelled = false;
    let engine = null;
    (async () => {
      const { createLandscape } = await import("./landscapeEngine");
      if (document.fonts?.ready) await document.fonts.ready.catch(() => {});
      if (cancelled) return;
      engine = createLandscape(root, { embedded });
      setReady(true);
    })();
    return () => {
      cancelled = true;
      engine?.destroy();
    };
  }, [embedded]);

  const Root = embedded ? "div" : "main";
  return (
    <Root
      ref={rootRef}
      className="ls"
      data-embedded={embedded ? "" : undefined}
      data-ready={ready ? "" : undefined}
      tabIndex={0}
      aria-label="Slow Weather, the making of a record, as a landscape of text. Scroll, drag or use the arrow keys to fly between levels."
    >
      <div className="ls-world">
        {PLANES.map((p) => (
          <Plane key={p.id} p={p} />
        ))}
      </div>
    </Root>
  );
}
