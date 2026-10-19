"use client";

import { useEffect, useRef, useState } from "react";

import { albumById } from "@/app/lab/_music/catalog";

import "./pixel-sort.css";

const COVERS = ["abbey-road", "sgt-pepper", "magical-mystery-tour", "rubber-soul", "help", "revolver"].map(albumById);

function SpeakerIcon({ on }) {
  return (
    <svg className="pixel-sort-speaker" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M2.5 6h2.2L8 3.2v9.6L4.7 10H2.5z" fill="currentColor" />
      {on ? (
        <path d="M10.4 5.6a3.4 3.4 0 0 1 0 4.8M12.2 4a5.6 5.6 0 0 1 0 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none" />
      ) : (
        <path d="M10.6 6.1l3.8 3.8M14.4 6.1l-3.8 3.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none" />
      )}
    </svg>
  );
}

export default function Piece({ embedded = false }) {
  const surfaceRef = useRef(null);
  const canvasRef = useRef(null);
  const brushRef = useRef(null);
  const engineRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [sound, setSound] = useState(false);
  const [threshold, setThreshold] = useState(0.04);
  const [cover, setCover] = useState(COVERS[0].id);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return undefined;
    let cancelled = false;
    let engine = null;
    const start = async () => {
      const { createSorter } = await import("./sortEngine");
      if (cancelled) return;
      engine = createSorter({ surface, canvas: canvasRef.current, brush: brushRef.current, onReady: () => setReady(true) });
      engineRef.current = engine;
      engine.start(COVERS[0].cover);
    };
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        io.disconnect();
        start();
      },
      { rootMargin: "240px" },
    );
    io.observe(surface);
    return () => {
      cancelled = true;
      io.disconnect();
      engine?.destroy();
      engineRef.current = null;
    };
  }, []);

  const toggleSound = async () => {
    const engine = engineRef.current;
    if (!engine) return;
    const next = !sound;
    setSound(next);
    const result = await engine.setSound(next);
    if (result !== next) setSound(false);
  };

  const changeThreshold = (e) => {
    const v = Number(e.target.value);
    setThreshold(v);
    engineRef.current?.setThreshold(v);
  };

  const pick = (album) => {
    if (album.id === cover) return;
    setCover(album.id);
    engineRef.current?.setCover(album.cover);
  };

  const current = COVERS.find((a) => a.id === cover);
  const Root = embedded ? "div" : "main";

  return (
    <Root className="pixel-sort" data-embedded={embedded ? "" : undefined} data-ready={ready ? "" : undefined}>
      {embedded ? null : (
        <header className="pixel-sort-caption">
          <h1 className="pixel-sort-title">Sort</h1>
          <p className="pixel-sort-hint">Drag down over the cover and its pixels pull into streaks, sorted by brightness. Drag back up to put them back.</p>
        </header>
      )}
      <div className="pixel-sort-stage">
        <div
          ref={surfaceRef}
          className="pixel-sort-surface"
          tabIndex={0}
          role="img"
          aria-label={`${current.title} by ${current.artist}, pixel sorted into vertical streaks. Left and right arrows pick a column, down and up arrows sort and unsort it.`}
        >
          <canvas ref={canvasRef} className="pixel-sort-canvas" />
          <span ref={brushRef} className="pixel-sort-brush" aria-hidden="true" />
        </div>
        {embedded ? null : (
          <p className="pixel-sort-credit">
            <span className="pixel-sort-credit-title">{current.title}</span>
            <span className="pixel-sort-credit-meta">
              {current.artist}, {current.year}
            </span>
          </p>
        )}
      </div>
      {embedded ? null : (
        <div className="pixel-sort-controls">
          <div className="pixel-sort-covers" role="radiogroup" aria-label="Cover">
            {COVERS.map((album) => (
              <button
                key={album.id}
                type="button"
                role="radio"
                aria-checked={album.id === cover}
                aria-label={album.title}
                className="pixel-sort-cover"
                onClick={() => pick(album)}
                style={{ backgroundImage: `url(${album.cover})` }}
              />
            ))}
          </div>
          <label className="pixel-sort-control">
            <span className="pixel-sort-control-row">
              <span>Threshold</span>
              <output className="pixel-sort-value">{threshold.toFixed(2)}</output>
            </span>
            <input type="range" min="0" max="0.8" step="0.01" value={threshold} onChange={changeThreshold} className="pixel-sort-range" />
          </label>
          <div className="pixel-sort-buttons">
            <button type="button" className="pixel-sort-button" onClick={() => engineRef.current?.reset()}>
              Unsort
            </button>
            <button type="button" className="pixel-sort-button" aria-pressed={sound} onClick={toggleSound}>
              <SpeakerIcon on={sound} />
              <span>{sound ? "Sound on" : "Sound off"}</span>
            </button>
          </div>
        </div>
      )}
    </Root>
  );
}
