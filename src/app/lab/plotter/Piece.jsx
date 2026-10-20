"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ImagePlus } from "lucide-react";

import useNearViewport from "@/app/experiments/useNearViewport";

import PlotterEngine, { PENS } from "./plotterEngine";
import basket from "./basket-of-fruit.webp";
import basketDots from "./basket-stipple.webp";
import { bakedStipple, solveStipple } from "./plotterStipple";
import "./plotter.css";

const STIPPLE = 3;

const ARTWORK = "Basket of Fruit, Caravaggio, c. 1599";

function PenGlyph({ pen }) {
  return (
    <svg viewBox="0 0 24 16" width="24" height="16" aria-hidden="true" className="plotter__pen-glyph">
      <circle cx="8" cy="8" r="5.5" fill={pen.ink} />
      <circle cx="16" cy="8" r="5.5" fill={pen.accent} stroke="var(--plotter-tray)" strokeWidth="1.5" />
    </svg>
  );
}

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const gantryRef = useRef(null);
  const engineRef = useRef(null);
  const statusRef = useRef(null);
  const fileRef = useRef(null);
  const solveRef = useRef(null);
  const near = useNearViewport(rootRef);
  const [pen, setPen] = useState(0);
  const [phase, setPhase] = useState("loading");
  const [artwork, setArtwork] = useState(ARTWORK);
  const [dropping, setDropping] = useState(false);
  const penRef = useRef(0);

  const choosePen = useCallback((index) => {
    if (index === penRef.current) return;
    penRef.current = index;
    setPen(index);
    engineRef.current?.unlockSound();
    engineRef.current?.retarget(STIPPLE, index);
  }, []);

  useEffect(() => {
    if (!near) return undefined;
    let engine = null;
    let cancelled = false;
    const load = (src) =>
      new Promise((resolve, reject) => {
        const image = new Image();
        image.decoding = "async";
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = src;
      });
    Promise.all([load(basket.src), load(basketDots.src)])
      .then(([source, dots]) => {
        if (cancelled) return;
        const stipple = bakedStipple(dots, source);
        engine = new PlotterEngine({
          root: rootRef.current,
          stage: stageRef.current,
          canvas: canvasRef.current,
          gantry: gantryRef.current,
          mode: STIPPLE,
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
        engine.start(stipple);
      })
      .catch(() => {
        if (!cancelled) setPhase("error");
      });
    return () => {
      cancelled = true;
      solveRef.current?.abort();
      engine?.destroy();
      engineRef.current = null;
    };
  }, [near]);

  const loadFile = useCallback((file) => {
    if (!file || !file.type.startsWith("image/")) return;
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      engineRef.current?.unlockSound();
      solveRef.current?.abort();
      const controller = new AbortController();
      solveRef.current = controller;
      const root = rootRef.current;
      root?.setAttribute("data-busy", "");
      if (statusRef.current) statusRef.current.textContent = "Placing dots";
      solveStipple(image, { signal: controller.signal })
        .then((stipple) => {
          if (controller.signal.aborted) return;
          engineRef.current?.setStipple(stipple);
          setArtwork("Your photo");
        })
        .catch(() => {});
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
        aria-label={`${artwork}, stippled dot by dot by a pen plotter on cream paper.`}
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
            A still life stippled by a pen plotter, one dot at a time. Change the pens and the sheet is <em>re-plotted</em>, row by row.
          </p>
        </header>
      )}

      <div className="plotter__bar">
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
