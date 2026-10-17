"use client";

import { useEffect, useRef, useState } from "react";

import useNearViewport from "@/app/experiments/useNearViewport";

import { PRESETS } from "./sandtableGarden";
import "./sandtable.css";

const BED_LABEL =
  "A zen garden tray of fine sand with a record cover buried on a tile beneath it. Drag to rake grooves; the sand piles into ridges on both sides, and raking the same place again digs deeper until the cover shows through. Press R for the rake, F for a fingertip, Enter to smooth the bed with a board, and 1 to 3 to change the sand and record.";

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const headRef = useRef(null);
  const footRef = useRef(null);
  const statusRef = useRef(null);
  const engineRef = useRef(null);
  const activeRef = useRef(0);
  const near = useNearViewport(rootRef);
  const [active, setActive] = useState(0);
  const [tool, setToolState] = useState("rake");

  useEffect(() => {
    if (!near) return undefined;
    const root = rootRef.current;
    let cancelled = false;
    let engine = null;
    const insets = (width) => {
      if (embedded) return { top: 12, bottom: 12, left: 12, right: 12 };
      if (width >= 900) return { top: 96, bottom: 40, left: 336, right: 48 };
      const boxRect = root.getBoundingClientRect();
      const head = headRef.current?.getBoundingClientRect();
      const foot = footRef.current?.getBoundingClientRect();
      const top = head ? head.bottom - boxRect.top + 16 : 148;
      const bottom = foot ? boxRect.bottom - foot.top + 16 : 120;
      return { top, bottom, left: 16, right: 16 };
    };
    const writeStatus = (percent) => {
      const el = statusRef.current;
      if (!el) return;
      const preset = PRESETS[activeRef.current];
      el.textContent = `${preset.artist}, ${percent}% unearthed`;
    };
    import("./sandtableEngine")
      .then(({ default: SandtableEngine }) => {
        if (cancelled) return;
        engine = new SandtableEngine({
          box: root,
          host: stageRef.current,
          canvas: canvasRef.current,
          insets,
          embedded,
          onReady: () => root.setAttribute("data-ready", ""),
          onFail: () => root.setAttribute("data-failed", ""),
          onStatus: writeStatus,
        });
        engineRef.current = engine;
        engine.start();
      })
      .catch((error) => {
        console.error(error);
        root.setAttribute("data-failed", "");
      });
    return () => {
      cancelled = true;
      engine?.destroy();
      engineRef.current = null;
    };
  }, [near, embedded]);

  const choose = (index) => {
    if (index === activeRef.current) {
      engineRef.current?.select(index);
      return;
    }
    activeRef.current = index;
    setActive(index);
    engineRef.current?.select(index);
  };

  const pickTool = (name) => {
    setToolState(name);
    engineRef.current?.setTool(name);
  };

  const onKey = (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      engineRef.current?.smooth();
      return;
    }
    if (e.key === "r" || e.key === "R") {
      pickTool("rake");
      return;
    }
    if (e.key === "f" || e.key === "F") {
      pickTool("finger");
      return;
    }
    const index = Number(e.key) - 1;
    if (index >= 0 && index < PRESETS.length) {
      e.preventDefault();
      choose(index);
    }
  };

  const Root = embedded ? "div" : "main";

  return (
    <Root ref={rootRef} className="sandtable" data-embedded={embedded ? "" : undefined}>
      <div ref={stageRef} className="sandtable-stage" tabIndex={0} role="application" aria-label={BED_LABEL} onKeyDown={onKey}>
        <canvas ref={canvasRef} className="sandtable-canvas" />
      </div>

      {embedded ? null : (
        <header ref={headRef} className="sandtable-head">
          <h1 className="sandtable-title">Sand Table</h1>
          <p className="sandtable-lede">
            Drag to rake. Go over the same ground and you dig, until a <em>record</em> surfaces.
          </p>
        </header>
      )}

      {embedded ? null : (
        <div ref={footRef} className="sandtable-panel">
          <div className="sandtable-presets" role="radiogroup" aria-label="Sand and record">
            {PRESETS.map((preset, i) => (
              <button
                key={preset.key}
                type="button"
                role="radio"
                aria-checked={active === i}
                aria-label={`${preset.label} sand over ${preset.artist}`}
                className="sandtable-preset"
                onClick={() => choose(i)}
              >
                <span className="sandtable-swatch" style={{ "--sandtable-swatch": preset.swatch }} aria-hidden="true" />
                <span className="sandtable-preset-label">{preset.label}</span>
                <span className="sandtable-preset-artist">{preset.artist}</span>
              </button>
            ))}
          </div>
          <div className="sandtable-tools">
            <div className="sandtable-segment" role="radiogroup" aria-label="Tool">
              {[
                ["rake", "Rake"],
                ["finger", "Finger"],
              ].map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={tool === key}
                  className="sandtable-seg"
                  onClick={() => pickTool(key)}
                >
                  {label}
                </button>
              ))}
            </div>
            <button type="button" className="sandtable-smooth" onClick={() => engineRef.current?.smooth()}>
              Smooth
            </button>
          </div>
          <p className="sandtable-status" aria-live="polite">
            <span ref={statusRef}>{PRESETS[active].artist}, buried</span>
          </p>
        </div>
      )}

      <p className="sandtable-fallback">This piece needs WebGL 2 with float render targets.</p>
    </Root>
  );
}
