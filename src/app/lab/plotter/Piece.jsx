"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ImagePlus } from "lucide-react";

import useNearViewport from "@/app/experiments/useNearViewport";

import PlotterEngine, { PENS } from "./plotterEngine";
import basket from "./basket-of-fruit.webp";
import "./plotter.css";

const MODES = [
  { id: 4, name: "Spiral", word: "drawn as one long spiral" },
  { id: 0, name: "Hatch", word: "hatched in crossing pen lines" },
  { id: 1, name: "Wave", word: "drawn in rows of waves" },
  { id: 2, name: "Contour", word: "drawn in contour lines" },
  { id: 3, name: "Stipple", word: "stippled in dots" },
];

const ARTWORK = "Basket of Fruit, Caravaggio, c. 1599";

function ModeGlyph({ index }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round" };
  return (
    <svg className="plotter__glyph" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      {index === 0 ? (
        <g {...common}>
          <path d="M2 6 6 2M2 10l8-8M2 14 14 2M6 14l8-8M10 14l4-4" />
        </g>
      ) : null}
      {index === 1 ? (
        <g {...common}>
          <path d="M1.5 5c1.6-2 3.2-2 4.8 0s3.2 2 4.8 0 2.4-1.6 3.4-.6" />
          <path d="M1.5 11c1.6-2 3.2-2 4.8 0s3.2 2 4.8 0 2.4-1.6 3.4-.6" />
        </g>
      ) : null}
      {index === 2 ? (
        <g {...common}>
          <path d="M8 2.2c3.6 0 5.8 2.6 5.8 5.6 0 3.3-2.6 6-5.9 6-3.4 0-5.7-2.4-5.7-5.6S4.4 2.2 8 2.2Z" />
          <path d="M8.2 5.4c1.7 0 2.8 1.2 2.8 2.6 0 1.6-1.2 2.7-2.9 2.7-1.6 0-2.8-1-2.8-2.6s1.2-2.7 2.9-2.7Z" />
        </g>
      ) : null}
      {index === 3 ? (
        <g fill="currentColor">
          <circle cx="3.5" cy="4" r="1.1" />
          <circle cx="8.5" cy="3" r="1.1" />
          <circle cx="12.5" cy="5.5" r="1.1" />
          <circle cx="5.5" cy="8.5" r="1.1" />
          <circle cx="10" cy="9" r="1.1" />
          <circle cx="3" cy="12.5" r="1.1" />
          <circle cx="8" cy="13" r="1.1" />
          <circle cx="13" cy="12" r="1.1" />
        </g>
      ) : null}
      {index === 4 ? (
        <g {...common}>
          <path d="M8 8.2c0-.8.9-1.2 1.6-.8.9.5.9 1.9.1 2.6-1.1 1-2.9.7-3.7-.4-1.1-1.4-.6-3.5.9-4.4 1.9-1.2 4.4-.4 5.4 1.5 1.2 2.3.2 5.2-2.1 6.2-2.7 1.2-5.9-.1-7-2.8" />
        </g>
      ) : null}
    </svg>
  );
}

function PenGlyph({ pen }) {
  return (
    <svg viewBox="0 0 24 16" width="24" height="16" aria-hidden="true" className="plotter__pen-glyph">
      <circle cx="8" cy="8" r="5.5" fill={pen.ink} />
      <circle cx="16" cy="8" r="5.5" fill={pen.accent} stroke="var(--plotter-tray)" strokeWidth="1.5" />
    </svg>
  );
}

const damp = (a, b, lambda, dt) => a + (b - a) * (1 - Math.exp(-lambda * dt));

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const gantryRef = useRef(null);
  const engineRef = useRef(null);
  const statusRef = useRef(null);
  const railRef = useRef(null);
  const thumbRef = useRef(null);
  const thumbTrackRef = useRef(null);
  const needleRef = useRef(null);
  const stopRefs = useRef([]);
  const railState = useRef({ pos: 0, goal: 0, raf: 0, last: 0, drag: null });
  const fileRef = useRef(null);
  const near = useNearViewport(rootRef);
  const [mode, setMode] = useState(0);
  const [pen, setPen] = useState(0);
  const [phase, setPhase] = useState("loading");
  const [artwork, setArtwork] = useState(ARTWORK);
  const [dropping, setDropping] = useState(false);
  const modeRef = useRef(0);
  const penRef = useRef(0);

  const placeThumb = useCallback(() => {
    const stops = stopRefs.current;
    const thumb = thumbRef.current;
    if (!thumb || !stops.length || !stops[0]) return;
    const { pos } = railState.current;
    const i = Math.max(0, Math.min(stops.length - 1, Math.floor(pos)));
    const j = Math.min(stops.length - 1, i + 1);
    const t = Math.max(0, Math.min(1, pos - i));
    const a = stops[i];
    const b = stops[j];
    const left = a.offsetLeft + (b.offsetLeft - a.offsetLeft) * t;
    const width = a.offsetWidth + (b.offsetWidth - a.offsetWidth) * t;
    thumb.style.transform = `translate3d(${left}px, 0, 0)`;
    thumb.style.width = `${width}px`;
    if (thumbTrackRef.current) thumbTrackRef.current.style.transform = `translate3d(${-left}px, 0, 0)`;
    if (needleRef.current) needleRef.current.style.transform = `rotate(${-120 + pos * 60}deg)`;
  }, []);

  const animateRail = useCallback(() => {
    const state = railState.current;
    if (state.raf) return;
    state.last = performance.now();
    const tick = (now) => {
      const dt = Math.min(0.05, (now - state.last) / 1000);
      state.last = now;
      const lambda = state.drag ? 22 : 11;
      state.pos = damp(state.pos, state.goal, lambda, dt);
      if (Math.abs(state.pos - state.goal) < 0.002) state.pos = state.goal;
      placeThumb();
      if (state.pos !== state.goal || state.drag) state.raf = requestAnimationFrame(tick);
      else state.raf = 0;
    };
    state.raf = requestAnimationFrame(tick);
  }, [placeThumb]);

  const choose = useCallback(
    (index, { glide = true } = {}) => {
      const state = railState.current;
      if (glide) {
        state.goal = index;
        animateRail();
      }
      if (index === modeRef.current) return;
      modeRef.current = index;
      setMode(index);
      engineRef.current?.unlockSound();
      engineRef.current?.retarget(MODES[index].id, penRef.current);
    },
    [animateRail],
  );

  const choosePen = useCallback((index) => {
    if (index === penRef.current) return;
    penRef.current = index;
    setPen(index);
    engineRef.current?.unlockSound();
    engineRef.current?.retarget(MODES[modeRef.current].id, index);
  }, []);

  useEffect(() => {
    if (!near) return undefined;
    const image = new Image();
    let engine = null;
    let cancelled = false;
    image.decoding = "async";
    image.onload = () => {
      if (cancelled) return;
      engine = new PlotterEngine({
        root: rootRef.current,
        stage: stageRef.current,
        canvas: canvasRef.current,
        gantry: gantryRef.current,
        mode: MODES[modeRef.current].id,
        pen: penRef.current,
        onReady: () => setPhase("ready"),
        onError: () => setPhase("error"),
        onProgress: ({ progress, busy }) => {
          const root = rootRef.current;
          if (!root) return;
          if (busy) root.setAttribute("data-busy", "");
          else root.removeAttribute("data-busy");
          if (statusRef.current) statusRef.current.textContent = busy ? `Plotting ${progress}%` : "Plotted";
        },
      });
      engineRef.current = engine;
      engine.start(image);
    };
    image.onerror = () => setPhase("error");
    image.src = basket.src;
    return () => {
      cancelled = true;
      engine?.destroy();
      engineRef.current = null;
    };
  }, [near]);

  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return undefined;
    placeThumb();
    const observer = new ResizeObserver(() => placeThumb());
    observer.observe(rail);
    const state = railState.current;
    return () => {
      observer.disconnect();
      cancelAnimationFrame(state.raf);
      state.raf = 0;
    };
  }, [placeThumb]);

  const posFromX = (clientX) => {
    const stops = stopRefs.current;
    const centers = stops.map((el) => {
      const r = el.getBoundingClientRect();
      return r.left + r.width / 2;
    });
    if (clientX <= centers[0]) return 0;
    for (let i = 0; i < centers.length - 1; i += 1) {
      if (clientX <= centers[i + 1]) return i + (clientX - centers[i]) / (centers[i + 1] - centers[i]);
    }
    return centers.length - 1;
  };

  const onRailDown = (event) => {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    const state = railState.current;
    if (state.drag) return;
    state.drag = { id: event.pointerId, x: event.clientX, moved: false };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const onRailMove = (event) => {
    const state = railState.current;
    if (!state.drag || state.drag.id !== event.pointerId) return;
    if (!state.drag.moved && Math.abs(event.clientX - state.drag.x) < 4) return;
    state.drag.moved = true;
    const pos = posFromX(event.clientX);
    state.goal = pos;
    animateRail();
    choose(Math.round(pos), { glide: false });
  };

  const onRailUp = (event) => {
    const state = railState.current;
    if (!state.drag || state.drag.id !== event.pointerId) return;
    const { moved } = state.drag;
    state.drag = null;
    if (moved) {
      const index = Math.round(posFromX(event.clientX));
      choose(index);
    } else {
      const index = Math.round(posFromX(event.clientX));
      choose(index);
    }
  };

  const onRailKey = (event) => {
    let next = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = Math.min(MODES.length - 1, modeRef.current + 1);
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = Math.max(0, modeRef.current - 1);
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = MODES.length - 1;
    if (next == null) return;
    event.preventDefault();
    choose(next);
    stopRefs.current[next]?.focus();
  };

  const loadFile = useCallback((file) => {
    if (!file || !file.type.startsWith("image/")) return;
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      engineRef.current?.unlockSound();
      engineRef.current?.setImage(image);
      URL.revokeObjectURL(url);
      setArtwork("Your photo");
    };
    image.onerror = () => URL.revokeObjectURL(url);
    image.src = url;
  }, []);

  const onDragOver = (event) => {
    if (!Array.from(event.dataTransfer?.types || []).includes("Files")) return;
    event.preventDefault();
    if (!dropping) setDropping(true);
  };

  const onDrop = (event) => {
    event.preventDefault();
    setDropping(false);
    loadFile(event.dataTransfer?.files?.[0]);
  };

  const current = MODES[mode];

  return (
    <div
      ref={rootRef}
      className="plotter"
      data-phase={phase}
      data-ready={phase === "ready" ? "" : undefined}
      data-embedded={embedded ? "" : undefined}
      data-dropping={dropping ? "" : undefined}
      onDragOver={onDragOver}
      onDragLeave={() => setDropping(false)}
      onDrop={onDrop}
    >
      <canvas
        ref={canvasRef}
        className="plotter__canvas"
        role="img"
        aria-label={`${artwork}, ${current.word} by a pen plotter on cream paper.`}
      />
      <div ref={stageRef} className="plotter__stage" aria-hidden="true" />
      <div ref={gantryRef} className="plotter__gantry" aria-hidden="true">
        <span className="plotter__carriage" />
      </div>

      <p className="plotter__caption">
        <span className="plotter__work">{artwork}</span>
        <span className="plotter__status">
          <span className="plotter__dot" aria-hidden="true" />
          <span ref={statusRef} aria-live="polite">
            Plotted
          </span>
        </span>
      </p>

      {embedded ? null : (
        <header className="plotter__head">
          <h1 className="plotter__title">Plotter</h1>
          <p className="plotter__lede">
            A still life redrawn by a pen plotter. Turn the dial and the sheet is <em>re-plotted</em>, row by row, in a new hand.
          </p>
        </header>
      )}

      <div className="plotter__bar">
        <div className="plotter__dial">
          <span className="plotter__knob" aria-hidden="true">
            <span ref={needleRef} className="plotter__needle" />
          </span>
          <div
            ref={railRef}
            className="plotter__rail"
            role="radiogroup"
            aria-label="Drawing method"
            onPointerDown={onRailDown}
            onPointerMove={onRailMove}
            onPointerUp={onRailUp}
            onPointerCancel={onRailUp}
            onKeyDown={onRailKey}
          >
            <span ref={thumbRef} className="plotter__thumb" aria-hidden="true">
              <span ref={thumbTrackRef} className="plotter__thumb-track">
                {MODES.map((option) => (
                  <span key={option.name} className="plotter__stop plotter__stop--ghost">
                    <ModeGlyph index={option.id} />
                    <span className="plotter__stop-name">{option.name}</span>
                  </span>
                ))}
              </span>
            </span>
            {MODES.map((option, index) => (
              <button
                key={option.name}
                ref={(el) => {
                  stopRefs.current[index] = el;
                }}
                type="button"
                role="radio"
                aria-checked={index === mode}
                aria-label={option.name}
                tabIndex={index === mode ? 0 : -1}
                className="plotter__stop"
                onClick={(event) => {
                  if (event.detail === 0) choose(index);
                }}
              >
                <ModeGlyph index={option.id} />
                <span className="plotter__stop-name">{option.name}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="plotter__pens" role="radiogroup" aria-label="Pens">
          {PENS.map((option, index) => (
            <button
              key={option.name}
              type="button"
              role="radio"
              aria-checked={index === pen}
              aria-label={option.name}
              className="plotter__pen"
              onClick={() => choosePen(index)}
            >
              <PenGlyph pen={option} />
            </button>
          ))}
          {embedded ? null : (
            <>
              <span className="plotter__rule" aria-hidden="true" />
              <button type="button" className="plotter__pen plotter__upload" aria-label="Plot your own photo" onClick={() => fileRef.current?.click()}>
                <ImagePlus size={16} strokeWidth={1.75} aria-hidden="true" />
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(event) => {
                  loadFile(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
            </>
          )}
        </div>
      </div>

      {phase === "error" ? <p className="plotter__error">This piece needs WebGL2 to plot.</p> : null}
    </div>
  );
}
