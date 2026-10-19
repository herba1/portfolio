"use client";

import { useEffect, useRef, useState } from "react";

import { albumById } from "@/app/lab/_music/catalog";

import { BANDS, MAX_DB, PRESETS, bandLabel } from "./eqPresets";
import { createEqEngine } from "./eqEngine";
import "./eq-curve.css";

const START = PRESETS[2];
const BAND_X = BANDS.map((f) => Math.log2(f / 20) / Math.log2(1000));
const formatDb = (g) => (g > 0 ? `+${g}` : g < 0 ? `−${Math.abs(g)}` : "0");

export default function Piece({ embedded = false }) {
  const canvasRef = useRef(null);
  const stageRef = useRef(null);
  const handleRefs = useRef([]);
  const engineRef = useRef(null);
  const [presetId, setPresetId] = useState(START.id);
  const [playing, setPlaying] = useState(START.album);
  const [gains, setGains] = useState(START.gains);
  const [grab, setGrab] = useState(-1);

  useEffect(() => {
    const engine = createEqEngine({
      canvas: canvasRef.current,
      stage: stageRef.current,
      handles: handleRefs.current,
      initial: START.gains,
      accent: START.accent,
      onRounded: setGains,
      onCustom: () => setPresetId(null),
      onGrab: setGrab,
    });
    engineRef.current = engine;
    return () => {
      engine.destroy();
      engineRef.current = null;
    };
  }, []);

  const choose = (preset) => {
    setPresetId(preset.id);
    if (preset.album) setPlaying(preset.album);
    engineRef.current?.setPreset(preset.gains, preset.accent);
  };

  const onPresetKey = (e, index) => {
    const dir = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const next = PRESETS[(index + dir + PRESETS.length) % PRESETS.length];
    choose(next);
    e.currentTarget.parentElement.querySelector(`[data-preset="${next.id}"]`)?.focus();
  };

  const onHandleKey = (e, i) => {
    const engine = engineRef.current;
    if (!engine) return;
    const big = e.shiftKey ? 3 : 1;
    if (e.key === "ArrowUp") engine.nudge(i, big);
    else if (e.key === "ArrowDown") engine.nudge(i, -big);
    else if (e.key === "PageUp") engine.nudge(i, 3);
    else if (e.key === "PageDown") engine.nudge(i, -3);
    else if (e.key === "Home" || e.key === "0") engine.reset(i);
    else if (e.key === "ArrowRight") handleRefs.current[Math.min(BANDS.length - 1, i + 1)]?.focus();
    else if (e.key === "ArrowLeft") handleRefs.current[Math.max(0, i - 1)]?.focus();
    else return;
    e.preventDefault();
  };

  const Root = embedded ? "div" : "main";
  const track = playing ?? albumById("revolver");

  return (
    <Root
      className="eq-curve"
      data-embedded={embedded ? "" : undefined}
      onKeyDownCapture={(e) => (e.currentTarget.dataset.kbd = "")}
      onPointerDownCapture={(e) => delete e.currentTarget.dataset.kbd}
    >
      {embedded ? null : (
        <header className="eq-curve-head">
          <h1 className="eq-curve-title">EQ Curve</h1>
        </header>
      )}

      <section className="eq-curve-panel">
        <div className="eq-curve-now">
          <div className="eq-curve-cover">
            {PRESETS.filter((p) => p.album).map((p) => (
              <img key={p.id} src={p.album.cover} alt="" data-on={p.album.id === track.id ? "" : undefined} draggable={false} />
            ))}
          </div>
          <div className="eq-curve-now-text">
            <p className="eq-curve-song">{track.tracks[0]}</p>
            <p className="eq-curve-meta">
              {track.artist} · {track.title}
            </p>
          </div>
          <p className="eq-curve-preset-name" aria-live="polite" data-custom={presetId ? undefined : ""}>
            {presetId ? "" : "Custom"}
          </p>
        </div>

        <div ref={stageRef} className="eq-curve-stage" data-grab={grab >= 0 ? "" : undefined}>
          <canvas ref={canvasRef} className="eq-curve-canvas" aria-hidden="true" />
          <div className="eq-curve-scale" aria-hidden="true">
            <span style={{ top: "52px" }}>+12</span>
            <span style={{ top: "calc(52px + (100% - 80px) / 2)" }}>0</span>
            <span style={{ top: "calc(100% - 28px)" }}>−12</span>
          </div>
          {BANDS.map((f, i) => (
            <button
              key={f}
              ref={(el) => (handleRefs.current[i] = el)}
              type="button"
              data-band={i}
              data-active={grab === i ? "" : undefined}
              data-align={i < 2 ? "start" : i > BANDS.length - 3 ? "end" : undefined}
              className="eq-curve-handle"
              role="slider"
              aria-label={`${bandLabel(f)}Hz`}
              aria-valuemin={-MAX_DB}
              aria-valuemax={MAX_DB}
              aria-valuenow={gains[i]}
              aria-valuetext={`${formatDb(gains[i])} dB`}
              onKeyDown={(e) => onHandleKey(e, i)}
              onDoubleClick={() => engineRef.current?.reset(i)}
            >
              <span className="eq-curve-knob" />
              <span className="eq-curve-tip" aria-hidden="true">
                {formatDb(gains[i])}
                <span className="eq-curve-tip-unit">dB</span>
              </span>
            </button>
          ))}
        </div>

        <div className="eq-curve-bands" aria-hidden="true">
          {BANDS.map((f, i) => (
            <div key={f} className="eq-curve-band" style={{ left: `${(BAND_X[i] * 100).toFixed(2)}%` }} data-active={grab === i ? "" : undefined}>
              <span className="eq-curve-band-db">{formatDb(gains[i])}</span>
              <span className="eq-curve-band-hz">{bandLabel(f)}</span>
            </div>
          ))}
        </div>

        <div className="eq-curve-presets" role="radiogroup" aria-label="Presets">
          {PRESETS.map((p, index) => (
            <button
              key={p.id}
              type="button"
              role="radio"
              data-preset={p.id}
              aria-checked={presetId === p.id}
              tabIndex={presetId === p.id || (!presetId && index === 0) ? 0 : -1}
              className="eq-curve-chip"
              style={{ "--chip": `rgb(${p.accent.join(",")})` }}
              onClick={() => choose(p)}
              onKeyDown={(e) => onPresetKey(e, index)}
            >
              {p.album ? (
                <img src={p.album.cover} alt="" draggable={false} />
              ) : (
                <svg viewBox="0 0 20 20" aria-hidden="true">
                  <path d="M2 10h16" />
                </svg>
              )}
              <span>{p.name}</span>
            </button>
          ))}
        </div>
      </section>
    </Root>
  );
}
