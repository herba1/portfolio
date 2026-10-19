"use client";

import { useEffect, useRef, useState } from "react";

import { SLEEVES } from "./peelArt";
import "./sticker-peel.css";

const STEP = 0.03;

const MOVES = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

export default function Piece({ embedded = false }) {
  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const engineRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [status, setStatus] = useState("");
  const [sleeve, setSleeve] = useState(SLEEVES[0].id);

  useEffect(() => {
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    if (!stage || !canvas) return undefined;
    let cancelled = false;
    let engine = null;
    const onChange = (change) => {
      if (change.held) setStatus(`Holding the ${change.held.toLowerCase()}. Move it, then press Enter to stick it down.`);
      else if (change.focus) setStatus(`${change.focus}. Press Enter to peel it off.`);
      else if (change.held === null) setStatus("");
    };
    const start = async () => {
      try {
        const { createPeel } = await import("./peelEngine");
        if (cancelled) return;
        engine = await createPeel(stage, canvas, { embedded, onChange });
        if (cancelled) {
          engine.destroy();
          return;
        }
        engineRef.current = engine;
        setReady(true);
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
    io.observe(stage);
    return () => {
      cancelled = true;
      io.disconnect();
      engine?.destroy();
      engineRef.current = null;
    };
  }, [embedded]);

  const onKeyDown = (event) => {
    const engine = engineRef.current;
    if (!engine) return;
    const move = MOVES[event.key];
    if (move) {
      event.preventDefault();
      const scale = event.shiftKey ? 3 : 1;
      if (!engine.keyMove(move[0] * STEP * scale, move[1] * STEP * scale)) engine.focusSticker(move[0] + move[1] > 0 ? 1 : -1);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      engine.keyPeel();
      return;
    }
    if (event.key === "Escape") {
      if (engine.keyCancel()) event.preventDefault();
      return;
    }
    if ((event.key === "r" || event.key === "R") && !event.metaKey && !event.ctrlKey) {
      engine.reset();
      setStatus("Fresh sleeve.");
    }
  };

  const Root = embedded ? "div" : "main";

  return (
    <Root className="sticker-peel-root bg-surface text-ink" data-embedded={embedded ? "" : undefined}>
      <div ref={stageRef} className="sticker-peel-stage" data-ready={ready ? "" : undefined}>
        <canvas
          ref={canvasRef}
          className="sticker-peel-canvas"
          tabIndex={0}
          role="application"
          aria-label={`A used copy of ${SLEEVES.find((a) => a.id === sleeve).title} with a price sticker on the sleeve, one corner already lifting. Drag the sticker by its edge to peel it. With the keyboard, Enter peels it off, arrows move it and Enter sticks it down. R gives a fresh sleeve.`}
          onKeyDown={onKeyDown}
          onBlur={() => engineRef.current?.blur()}
        />
        {failed ? <p className="sticker-peel-fallback text-ui-lg">This piece needs WebGL 2.</p> : null}
      </div>
      {embedded ? null : (
        <header className="sticker-peel-head">
          <h1 className="text-title-sm">Sticker Peel</h1>
          <p className="sticker-peel-hint text-ui-lg">
            Peel the price sticker from its lifted corner. Let go halfway and it lays back down; pull it free and drop it anywhere.
          </p>
          <div className="sticker-peel-sleeves" role="radiogroup" aria-label="Sleeve">
            {SLEEVES.map((album) => (
              <button
                key={album.id}
                type="button"
                role="radio"
                aria-checked={sleeve === album.id}
                aria-label={album.title}
                title={album.title}
                className="sticker-peel-sleeve"
                onClick={() => {
                  setSleeve(album.id);
                  engineRef.current?.setSleeve(album.id);
                  setStatus(`${album.title}, fresh sleeve.`);
                }}
              >
                <img src={album.cover} alt="" width={32} height={32} draggable={false} />
              </button>
            ))}
          </div>
          <button
            type="button"
            className="sticker-peel-button"
            onClick={() => {
              engineRef.current?.reset();
              setStatus("Fresh sleeve.");
            }}
          >
            Fresh sleeve
          </button>
        </header>
      )}
      <p className="sticker-peel-live" aria-live="polite">
        {status}
      </p>
    </Root>
  );
}
