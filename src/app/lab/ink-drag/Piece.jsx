"use client";

import { useEffect, useRef, useState } from "react";

import useNearViewport from "@/app/experiments/useNearViewport";

import InkDragEngine from "./inkDragEngine";
import { DEFAULT_WORD, INKS, MAX_WORD } from "./inkDragParams";
import "./ink-drag.css";

const STATUS_TEXT = {
  wet: "Wet ink",
  tacky: "Drying",
  dry: "Dry, set for good",
  static: "Proof",
};

const SHEET_LABEL =
  "A word printed in wet ink. Drag through it with a mouse, finger or pen to smear the ink along your path. Slow strokes push thick soft smears, fast strokes pull thin streaks. The ink dries a few seconds after you stop. Press Enter for a fresh sheet.";

function FreshIcon() {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
      <path d="M4.5 10a5.5 5.5 0 1 0 1.7-3.98" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M5.6 3.4v3.1h3.1" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const sheetRef = useRef(null);
  const canvasRef = useRef(null);
  const cursorRef = useRef(null);
  const statusRef = useRef(null);
  const engineRef = useRef(null);
  const near = useNearViewport(rootRef);
  const [draft, setDraft] = useState(DEFAULT_WORD);
  const [inkId, setInkId] = useState(INKS[0].id);

  useEffect(() => {
    if (!near) return undefined;
    const root = rootRef.current;
    const engine = new InkDragEngine({
      host: sheetRef.current,
      canvas: canvasRef.current,
      cursor: cursorRef.current,
      onStatus: (status) => {
        root.setAttribute("data-status", status);
        if (statusRef.current) statusRef.current.textContent = STATUS_TEXT[status] || "";
      },
      onReady: () => root.setAttribute("data-ready", ""),
    });
    engineRef.current = engine;
    engine.start();
    return () => {
      engine.destroy();
      engineRef.current = null;
    };
  }, [near]);

  const commitWord = () => {
    const word = draft.trim() || DEFAULT_WORD;
    if (word !== draft) setDraft(word);
    engineRef.current?.setWord(word);
  };

  const chooseInk = (id) => {
    setInkId(id);
    engineRef.current?.setInk(id);
  };

  const cycleInk = () => {
    const index = INKS.findIndex((ink) => ink.id === inkId);
    chooseInk(INKS[(index + 1) % INKS.length].id);
  };

  const fresh = () => engineRef.current?.fresh();

  const onSheetKey = (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fresh();
    }
  };

  const currentInk = INKS.find((ink) => ink.id === inkId) || INKS[0];

  return (
    <div ref={rootRef} className="ink-drag" data-embedded={embedded ? "" : undefined} data-status="wet">
      <div ref={sheetRef} className="ink-drag__sheet" tabIndex={0} role="img" aria-label={SHEET_LABEL} onKeyDown={onSheetKey}>
        <canvas ref={canvasRef} className="ink-drag__canvas" />
        <span className="ink-drag__mark ink-drag__mark--tl" aria-hidden="true" />
        <span className="ink-drag__mark ink-drag__mark--tr" aria-hidden="true" />
        <span className="ink-drag__mark ink-drag__mark--bl" aria-hidden="true" />
        <span className="ink-drag__mark ink-drag__mark--br" aria-hidden="true" />
        <span ref={cursorRef} className="ink-drag__cursor" aria-hidden="true" />
      </div>

      {!embedded && (
        <header className="ink-drag__head">
          <h1 className="ink-drag__title">Ink Drag</h1>
          <p className="ink-drag__status" aria-live="polite">
            <span className="ink-drag__dot" aria-hidden="true" />
            <span ref={statusRef}>Wet ink</span>
          </p>
        </header>
      )}

      {embedded ? (
        <button type="button" className="ink-drag__fresh ink-drag__fresh--round" onClick={fresh} aria-label="Fresh sheet">
          <FreshIcon />
        </button>
      ) : (
        <div className="ink-drag__bar">
          <form
            className="ink-drag__word"
            onSubmit={(e) => {
              e.preventDefault();
              commitWord();
              e.currentTarget.querySelector("input")?.blur();
            }}
          >
            <label className="ink-drag__label" htmlFor="ink-drag-word">
              Set
            </label>
            <input
              id="ink-drag-word"
              className="ink-drag__input"
              value={draft}
              maxLength={MAX_WORD}
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitWord}
            />
            <button type="submit" className="ink-drag__print">
              Print
            </button>
          </form>

          <div className="ink-drag__inks" role="radiogroup" aria-label="Ink">
            {INKS.map((ink) => (
              <button
                key={ink.id}
                type="button"
                role="radio"
                aria-checked={ink.id === inkId}
                className="ink-drag__ink"
                onClick={() => chooseInk(ink.id)}
                title={ink.note}
              >
                {ink.label}
              </button>
            ))}
          </div>

          <button type="button" className="ink-drag__ink-cycle" onClick={cycleInk} aria-label={`Ink: ${currentInk.label}. Change ink`}>
            {currentInk.label}
          </button>

          <button type="button" className="ink-drag__fresh" onClick={fresh}>
            <FreshIcon />
            <span>Fresh sheet</span>
          </button>
        </div>
      )}
    </div>
  );
}
