"use client";

import { useEffect, useRef, useState } from "react";

import { albumById } from "@/app/lab/_music/catalog";

import "./art-type.css";

const SET = ["abbey-road", "revolver", "rubber-soul", "let-it-be", "help", "magical-mystery-tour"].map(albumById);
const IDLE = 4200;

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const canvasRef = useRef(null);
  const engineRef = useRef(null);
  const rangeRef = useRef(null);
  const lastInput = useRef(0);
  const [index, setIndex] = useState(0);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const root = rootRef.current;
    if (!canvas || !root) return undefined;
    let cancelled = false;
    let engine = null;
    const start = async () => {
      const { createArt } = await import("./artEngine");
      if (document.fonts) await document.fonts.ready;
      if (cancelled) return;
      engine = createArt(canvas, {
        onProgress: (p) => {
          const r = rangeRef.current;
          if (r && document.activeElement !== r) r.value = String(Math.round(p * 1000));
          root.style.setProperty("--at-p", p.toFixed(3));
        },
      });
      engine.setFamily(getComputedStyle(root).fontFamily || "sans-serif");
      engineRef.current = engine;
      lastInput.current = Math.max(lastInput.current, performance.now() - IDLE + 1400);
      setReady(true);
    };
    start();
    const timer = setInterval(() => {
      const e = engineRef.current;
      if (!e || document.hidden) return;
      if (performance.now() - lastInput.current < IDLE) return;
      lastInput.current = performance.now() - IDLE + 2800;
      e.setTarget(e.target > 0.5 ? 0 : 1);
    }, 300);
    return () => {
      cancelled = true;
      clearInterval(timer);
      engine?.destroy();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    engineRef.current?.setAlbum(SET[index]);
  }, [ready, index]);

  const scrubFrom = (event) => {
    const engine = engineRef.current;
    const canvas = canvasRef.current;
    if (!engine || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    const sq = engine.square();
    const x = event.clientX - rect.left - sq.x;
    const y = event.clientY - rect.top - sq.y;
    if (y < -48 || y > sq.S + 48 || x < -96 || x > sq.S + 96) return;
    lastInput.current = performance.now();
    engine.setTarget((x + 24) / (sq.S + 48));
  };

  const onPointerMove = (event) => {
    if (event.pointerType === "mouse" || event.buttons) scrubFrom(event);
  };

  const onPointerDown = (event) => {
    if (event.pointerType !== "mouse") scrubFrom(event);
  };

  const onRange = (event) => {
    lastInput.current = performance.now();
    engineRef.current?.setTarget(Number(event.target.value) / 1000);
  };

  const onKeyDown = (event) => {
    const engine = engineRef.current;
    if (!engine) return;
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      lastInput.current = performance.now();
      engine.setTarget(engine.target > 0.5 ? 0 : 1);
    }
  };

  const album = SET[index];
  const Root = embedded ? "div" : "main";

  return (
    <Root ref={rootRef} className="at-root" data-embedded={embedded ? "" : undefined}>
      <canvas
        ref={canvasRef}
        className="at-canvas"
        data-ready={ready ? "" : undefined}
        tabIndex={0}
        role="img"
        aria-label={`The ${album.title} cover, made of its own pixels, which rearrange into the words ${album.title}. Move across it to scrub; Space flips it.`}
        onPointerMove={onPointerMove}
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
      />
      {embedded ? null : (
        <header className="at-head">
          <h1 className="text-title-sm">Art Type</h1>
          <p className="at-hint text-ui-lg">Every pixel of the cover is a letter waiting to happen. Move across the record to scrub it into its title and back.</p>
        </header>
      )}
      <div className="at-dock">
        <label className="at-scrub">
          <span className="at-end">Cover</span>
          <input
            ref={rangeRef}
            type="range"
            min="0"
            max="1000"
            defaultValue="0"
            aria-label="Cover to title"
            onInput={onRange}
          />
          <span className="at-end">Title</span>
        </label>
        <nav className="at-picker" aria-label="Albums">
          {SET.map((a, i) => (
            <button key={a.id} type="button" className="at-pick" aria-pressed={i === index} onClick={() => setIndex(i)}>
              <img src={a.cover} alt="" width={32} height={32} draggable={false} />
              <span>{a.title}</span>
            </button>
          ))}
        </nav>
      </div>
    </Root>
  );
}
