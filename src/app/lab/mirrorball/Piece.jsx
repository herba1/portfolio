"use client";

import { useEffect, useRef, useState } from "react";

import { ALBUM_CHOICES } from "./mirrorballAlbums";
import "./mirrorball.css";

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const canvasRef = useRef(null);
  const headRef = useRef(null);
  const engineRef = useRef(null);
  const albumRef = useRef(0);
  const [album, setAlbum] = useState(0);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!root || !canvas) return undefined;
    let cancelled = false;
    let engine = null;
    const start = async () => {
      try {
        const { createMirrorball } = await import("./mirrorballEngine");
        if (cancelled) return;
        engine = await createMirrorball({
          box: root,
          canvas,
          header: embedded ? null : headRef.current,
          embedded,
          album: albumRef.current,
          onReady: () => {
            if (!cancelled) setReady(true);
          },
        });
        if (cancelled) {
          engine.destroy();
          return;
        }
        engineRef.current = engine;
      } catch (error) {
        console.error(error);
        if (!cancelled) setFailed(true);
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
    io.observe(root);
    return () => {
      cancelled = true;
      io.disconnect();
      engine?.destroy();
      engineRef.current = null;
    };
  }, [embedded]);

  const choose = (idx) => {
    albumRef.current = idx;
    setAlbum(idx);
    engineRef.current?.setAlbum(idx);
  };

  const Root = embedded ? "div" : "main";

  return (
    <Root
      ref={rootRef}
      className="mirrorball-root"
      data-embedded={embedded ? "" : undefined}
      data-ready={ready ? "" : undefined}
      data-failed={failed ? "" : undefined}
    >
      <canvas
        ref={canvasRef}
        className="mirrorball-canvas"
        tabIndex={0}
        role="application"
        aria-label={`A mirrorball hanging in a dark room, throwing the colours of ${ALBUM_CHOICES[album].title} across the walls, floor and ceiling. Drag sideways to spin it; it keeps the speed of your throw and slows on its own. Left and right arrows push it, Space stops it.`}
      />
      {embedded ? null : (
        <header ref={headRef} className="mirrorball-head">
          <h1 className="mirrorball-title">Mirrorball</h1>
          <p className="mirrorball-lede">
            One spotlight through a record sleeve. Every mirror carries <em>a piece of the cover</em> around the room.
          </p>
        </header>
      )}
      {embedded ? null : (
        <div className="mirrorball-gels" role="radiogroup" aria-label="Album">
          {ALBUM_CHOICES.map((a, i) => (
            <button
              key={a.id}
              type="button"
              role="radio"
              aria-checked={album === i}
              aria-label={`${a.title}, ${a.year}`}
              className="mirrorball-gel"
              onClick={() => choose(i)}
            >
              <img className="mirrorball-swatch" src={a.cover} alt="" width={24} height={24} draggable={false} />
              <span className="mirrorball-gel-label">{a.short}</span>
            </button>
          ))}
        </div>
      )}
      {failed ? <p className="mirrorball-fallback">This piece needs WebGL 2.</p> : null}
    </Root>
  );
}
