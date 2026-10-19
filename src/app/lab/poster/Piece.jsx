"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import useNearViewport from "@/app/experiments/useNearViewport";

import PosterEngine, { PALETTES } from "./posterEngine";
import portrait from "./charge-portrait.webp";
import "./poster.css";

const DEFAULT_WORD = "charge";
const DEFAULT_EXPOSURE = 0.32;

function PaletteGlyph({ inks }) {
  return (
    <svg viewBox="0 0 28 16" width="28" height="16" aria-hidden="true" className="poster__palette-glyph">
      <rect x="1" y="2" width="12" height="12" rx="2" fill={inks[3]} />
      <rect x="1" y="2" width="12" height="6" rx="2" fill={inks[2]} />
      <rect x="10" y="2" width="9" height="12" rx="2" fill={inks[1]} />
      <rect x="16" y="2" width="11" height="12" rx="2" fill={inks[0]} />
    </svg>
  );
}

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const squeegeeRef = useRef(null);
  const engineRef = useRef(null);
  const wordTimer = useRef(0);
  const near = useNearViewport(rootRef);
  const [phase, setPhase] = useState("loading");
  const [exposure, setExposure] = useState(DEFAULT_EXPOSURE);
  const [palette, setPalette] = useState(0);
  const [word, setWord] = useState(DEFAULT_WORD);
  const [prints, setPrints] = useState(1);
  const [pulling, setPulling] = useState(false);

  useEffect(() => {
    if (!near) return undefined;
    const image = new Image();
    let engine = null;
    let cancelled = false;
    image.decoding = "async";
    image.onload = async () => {
      if (cancelled) return;
      const fontFamily = getComputedStyle(rootRef.current).fontFamily;
      await document.fonts?.load(`800 64px ${fontFamily}`, DEFAULT_WORD).catch(() => null);
      if (cancelled) return;
      engine = new PosterEngine({
        root: rootRef.current,
        stage: stageRef.current,
        canvas: canvasRef.current,
        squeegee: squeegeeRef.current,
        exposure: DEFAULT_EXPOSURE,
        palette: 0,
        word: DEFAULT_WORD,
        fontFamily,
        onReady: () => setPhase("ready"),
        onError: () => setPhase("error"),
        onPulling: (on) => {
          setPulling(on);
          if (on) setPrints((n) => n + 1);
        },
      });
      engineRef.current = engine;
      engine.start(image);
    };
    image.onerror = () => setPhase("error");
    image.src = portrait.src;
    return () => {
      cancelled = true;
      clearTimeout(wordTimer.current);
      engine?.destroy();
      engineRef.current = null;
    };
  }, [near]);

  const changeExposure = useCallback((value) => {
    setExposure(value);
    engineRef.current?.unlockSound();
    engineRef.current?.setExposure(value);
  }, []);

  const changePalette = useCallback((index) => {
    setPalette(index);
    engineRef.current?.unlockSound();
    engineRef.current?.setPalette(index);
  }, []);

  const changeWord = useCallback((value) => {
    setWord(value);
    clearTimeout(wordTimer.current);
    wordTimer.current = setTimeout(() => {
      engineRef.current?.unlockSound();
      engineRef.current?.setWord(value.trim() || DEFAULT_WORD);
    }, 420);
  }, []);

  return (
    <div
      ref={rootRef}
      className="poster"
      data-phase={phase}
      data-ready={phase === "ready" ? "" : undefined}
      data-embedded={embedded ? "" : undefined}
      data-pulling={pulling ? "" : undefined}
    >
      <canvas
        ref={canvasRef}
        className="poster__canvas"
        role="img"
        aria-label={`A screen-printed campaign poster: an old man in a knitted hat, in four flat inks with striped mid-tones, above the word ${word.trim() || DEFAULT_WORD}.`}
      />
      <div ref={stageRef} className="poster__stage" aria-hidden="true" />
      <div ref={squeegeeRef} className="poster__squeegee" aria-hidden="true">
        <span className="poster__blade" />
      </div>

      <p className="poster__caption">
        <span className="poster__credit">
          Still from <em>Charge</em>, Blender Studio, CC BY 4.0
        </span>
        <span className="poster__count">Print {String(prints).padStart(2, "0")}</span>
      </p>

      {embedded ? null : (
        <header className="poster__head">
          <h1 className="poster__title">Poster</h1>
          <p className="poster__lede">
            A film still screen-printed in four flat inks. Move the exposure and the squeegee <em>pulls</em> a fresh print over the old one.
          </p>
        </header>
      )}

      <div className="poster__bar">
        <label className="poster__exposure">
          <span className="poster__exposure-label">Exposure</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={exposure}
            onChange={(event) => changeExposure(Number(event.target.value))}
            className="poster__range"
            aria-valuetext={exposure < 0.34 ? "Light" : exposure > 0.66 ? "Heavy" : "Even"}
            style={{ "--poster-fill": `${exposure * 100}%` }}
          />
        </label>

        <div className="poster__palettes" role="radiogroup" aria-label="Inks">
          {PALETTES.map((option, index) => (
            <button
              key={option.name}
              type="button"
              role="radio"
              aria-checked={index === palette}
              aria-label={option.name}
              className="poster__palette"
              onClick={() => changePalette(index)}
            >
              <PaletteGlyph inks={option.inks} />
            </button>
          ))}
        </div>

        {embedded ? null : (
          <label className="poster__word">
            <span className="poster__word-label">Word</span>
            <input
              type="text"
              value={word}
              maxLength={14}
              spellCheck={false}
              autoComplete="off"
              onChange={(event) => changeWord(event.target.value)}
              className="poster__word-input"
            />
          </label>
        )}
      </div>

      {phase === "error" ? <p className="poster__error">This piece needs WebGL2 to print.</p> : null}
    </div>
  );
}
