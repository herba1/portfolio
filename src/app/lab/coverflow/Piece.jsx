"use client";

import { useEffect, useRef, useState } from "react";

import { ALBUMS } from "@/app/lab/_music/catalog";

import { createFlow } from "./flow";
import { createTicks } from "./tick";
import "./coverflow.css";

const START = ALBUMS.findIndex((a) => a.id === "revolver");
function Chevron({ dir }) {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d={dir < 0 ? "M10 3.5 5.5 8l4.5 4.5" : "M6 3.5 10.5 8 6 12.5"} />
    </svg>
  );
}

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const flowRef = useRef(null);
  const [center, setCenter] = useState(START);

  useEffect(() => {
    const root = rootRef.current;
    const ticks = createTicks();
    const wake = () => ticks.wake();
    root.addEventListener("pointerdown", wake);
    root.addEventListener("keydown", wake);
    const flow = createFlow(root, {
      count: ALBUMS.length,
      start: START,
      onCenter: setCenter,
      onTick: ticks.tick,
    });
    flowRef.current = flow;
    return () => {
      root.removeEventListener("pointerdown", wake);
      root.removeEventListener("keydown", wake);
      flow.destroy();
      ticks.destroy();
      flowRef.current = null;
    };
  }, []);

  const album = ALBUMS[center];

  return (
    <div
      ref={rootRef}
      className="cf"
      data-embedded={embedded ? "true" : "false"}
      tabIndex={0}
      role="listbox"
      aria-label="Albums"
      aria-activedescendant={`cf-item-${album.id}`}
    >
      {!embedded && <h1 className="cf-heading text-heading">Cover Flow</h1>}

      <div className="cf-stage" data-cf-stage>
        {ALBUMS.map((a, i) => (
          <div
            key={a.id}
            id={`cf-item-${a.id}`}
            className="cf-item"
            data-cf-item
            data-index={i}
            role="option"
            aria-selected={i === center}
            aria-label={`${a.title}, ${a.year}`}
          >
            <img className="cf-cover" src={a.cover} alt="" draggable={false} />
            <img
              className="cf-reflection"
              src={a.cover}
              alt=""
              draggable={false}
              aria-hidden="true"
            />
            <span className="cf-shade" data-cf-shade aria-hidden="true" />
          </div>
        ))}
      </div>

      <div className="cf-caption">
        <h2 className="cf-title text-title-lg" aria-live="polite">
          {album.title}
        </h2>
        <p className="cf-meta text-ui-lg">
          <span>{album.artist}</span>
          <span aria-hidden="true">·</span>
          <span className="tabular-nums">{album.year}</span>
        </p>
      </div>

      <div className="cf-controls">
        <button
          type="button"
          className="cf-step"
          aria-label="Previous album"
          disabled={center === 0}
          onClick={() => flowRef.current?.step(-1)}
        >
          <Chevron dir={-1} />
        </button>
        <div className="cf-scrub" data-cf-scrub>
          <span className="cf-scrub-track" aria-hidden="true" />
          <span className="cf-thumb" data-cf-thumb aria-hidden="true" />
        </div>
        <button
          type="button"
          className="cf-step"
          aria-label="Next album"
          disabled={center === ALBUMS.length - 1}
          onClick={() => flowRef.current?.step(1)}
        >
          <Chevron dir={1} />
        </button>
        <span className="cf-count text-ui font-mono tabular-nums">
          {String(center + 1).padStart(2, "0")} / {ALBUMS.length}
        </span>
      </div>
    </div>
  );
}
