"use client";

import { useEffect, useRef, useState } from "react";

import useNearViewport from "@/app/experiments/useNearViewport";

import { POEM } from "./ghostTypeEngine";
import "./ghost-type.css";

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const headRef = useRef(null);
  const footRef = useRef(null);
  const engineRef = useRef(null);
  const near = useNearViewport(rootRef);
  const [ready, setReady] = useState(false);
  const [active, setActive] = useState(null);
  const [placed, setPlaced] = useState(0);
  const [draft, setDraft] = useState("");
  const dropRef = useRef(null);
  const pressRef = useRef(null);

  useEffect(() => {
    if (!near) return undefined;
    let cancelled = false;
    let engine = null;
    const stage = stageRef.current;
    const insets = () => {
      const box = stage.getBoundingClientRect();
      const head = headRef.current?.getBoundingClientRect();
      const foot = footRef.current?.getBoundingClientRect();
      return {
        top: head ? head.bottom - box.top + 48 : 40,
        bottom: foot ? box.bottom - foot.top + 40 : 40,
        roof: head ? head.bottom - box.top + 16 : 16,
        floor: foot ? foot.top - box.top - 16 : box.height - 16,
      };
    };
    import("./ghostTypeEngine").then(({ createGhostType }) => {
      if (cancelled) return;
      engine = createGhostType(stage, {
        canvas: canvasRef.current,
        insets,
        onReady: () => setReady(true),
        onActive: setActive,
        onPlaced: setPlaced,
      });
      engine.setDock(() => {
        const box = stage.getBoundingClientRect();
        const r = dropRef.current?.getBoundingClientRect();
        return r ? [r.left + r.width / 2 - box.left, r.top + r.height / 2 - box.top + 12] : [box.width / 2, box.height];
      });
      engineRef.current = engine;
    });
    return () => {
      cancelled = true;
      engine?.destroy();
      engineRef.current = null;
    };
  }, [near]);

  const onKey = (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      engineRef.current?.release();
    }
  };

  const word = draft.trim();

  const dockPoint = () => {
    const box = stageRef.current?.getBoundingClientRect();
    const r = dropRef.current?.getBoundingClientRect();
    if (!box || !r) return undefined;
    return [r.left + r.width / 2 - box.left, r.top - box.top];
  };

  const dropWord = () => {
    if (!word) return;
    engineRef.current?.drop(word, dockPoint());
    setDraft("");
  };

  const onDraftKey = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      dropWord();
    }
  };

  const onDropDown = (e) => {
    if (!word || (e.button !== undefined && e.button !== 0)) return;
    pressRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY, dragged: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onDropMove = (e) => {
    const p = pressRef.current;
    if (!p || p.id !== e.pointerId || p.dragged) return;
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < 6) return;
    p.dragged = true;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    engineRef.current?.grab(word, e);
    setDraft("");
  };

  const onDropUp = (e) => {
    const p = pressRef.current;
    pressRef.current = null;
    if (!p || p.id !== e.pointerId || p.dragged) return;
    dropWord();
  };

  const onDropKey = (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      dropWord();
    }
  };

  return (
    <div ref={rootRef} className="ghost-type" data-embedded={embedded ? "" : undefined} data-ready={ready ? "" : undefined}>
      <div
        ref={stageRef}
        className="ghost-type__stage"
        tabIndex={0}
        role="img"
        aria-label={`${POEM.join(" ")} A poem by Christina Rossetti set as a justified block. Pull any word out and place it anywhere; it trails outlined ghosts as it moves. Drop it back on its gap to send it home, or type your own words below. Press Enter to send a word drifting.`}
        onKeyDown={onKey}
      >
        <canvas ref={canvasRef} className="ghost-type__canvas" />
      </div>

      {embedded ? null : (
        <header ref={headRef} className="ghost-type__head">
          <h1 className="ghost-type__title">Ghost Type</h1>
          <p className="ghost-type__hint">Pull words out and place them anywhere, or type your own.</p>
        </header>
      )}

      <footer ref={footRef} className="ghost-type__foot">
        <p className="ghost-type__credit">
          Who Has Seen the Wind? Christina Rossetti, 1872
        </p>
        <div className="ghost-type__compose">
          <input
            className="ghost-type__input"
            type="text"
            value={draft}
            maxLength={24}
            placeholder="Type a word"
            aria-label="Type a word to drop onto the page"
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onDraftKey}
          />
          <button
            ref={dropRef}
            type="button"
            className="ghost-type__drop"
            disabled={!word}
            onPointerDown={onDropDown}
            onPointerMove={onDropMove}
            onPointerUp={onDropUp}
            onPointerCancel={() => {
              pressRef.current = null;
            }}
            onKeyDown={onDropKey}
          >
            Drop
          </button>
        </div>
        <div className="ghost-type__end">
          <button type="button" className="ghost-type__back" data-shown={placed > 0 ? "" : undefined} disabled={placed === 0} onClick={() => engineRef.current?.putBack()}>
            Put it all back
          </button>
        </div>
      </footer>
      <p className="ghost-type__live" aria-live="polite">
        {active ? `Holding “${active}”` : ""}
      </p>
    </div>
  );
}
