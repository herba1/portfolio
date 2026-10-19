"use client";

import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";

import useNearViewport from "@/app/experiments/useNearViewport";

import EraseEngine from "./eraseEngine";
import { TITLE_MAX } from "./eraseSetlist";
import "./erase.css";

const LABEL =
  "A handwritten Beatles setlist taped above a ledge, one song already half rubbed out. Click a song to rewrite it, then press and scrub across a title to erase it; the ink lifts off as dust and falls into a pile on the ledge. Arrow keys pick a line, Enter rewrites it, Delete rubs it out, Command or Control Z undoes the last rub and the dust flies back into the letters.";

function subscribeNothing() {
  return () => {};
}

function readMac() {
  return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || "");
}

function UndoIcon() {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
      <path d="M7.4 5.2 4 8.6l3.4 3.4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4.4 8.6h7.1a4.3 4.3 0 0 1 0 8.6H8.6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function EraserArt() {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  return (
    <svg viewBox="0 0 214 78" width="100%" height="100%" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}b`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fdfcf8" />
          <stop offset="0.3" stopColor="#f5f3ec" />
          <stop offset="0.7" stopColor="#e7e4db" />
          <stop offset="1" stopColor="#d6d2c7" />
        </linearGradient>
        <linearGradient id={`${id}t`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#3c3846" stopOpacity="0.46" />
          <stop offset="0.08" stopColor="#3c3846" stopOpacity="0.26" />
          <stop offset="0.2" stopColor="#3c3846" stopOpacity="0.08" />
          <stop offset="0.34" stopColor="#3c3846" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`${id}s`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3f5f9c" />
          <stop offset="0.35" stopColor="#355590" />
          <stop offset="0.75" stopColor="#2c4a81" />
          <stop offset="1" stopColor="#243f70" />
        </linearGradient>
      </defs>
      <rect x="2" y="5" width="206" height="68" rx="10" fill={`url(#${id}b)`} />
      <rect x="2" y="5" width="206" height="68" rx="10" fill={`url(#${id}t)`} />
      <rect x="8" y="8" width="84" height="3" rx="1.5" fill="#ffffff" opacity="0.8" />
      <rect x="2" y="66" width="96" height="7" rx="3.5" fill="#b9b4aa" opacity="0.35" />
      <rect x="94" y="2" width="114" height="74" rx="3" fill={`url(#${id}s)`} />
      <rect x="94" y="2" width="114" height="3" rx="1.5" fill="#ffffff" opacity="0.28" />
      <rect x="94" y="12" width="114" height="1.2" fill="#f4efe2" opacity="0.7" />
      <rect x="94" y="65" width="114" height="1.2" fill="#f4efe2" opacity="0.7" />
      <rect x="112" y="28" width="78" height="22" rx="2" fill="none" stroke="#f4efe2" strokeOpacity="0.75" strokeWidth="1.4" />
      <rect x="120" y="36" width="34" height="2.4" rx="1.2" fill="#f4efe2" opacity="0.8" />
      <rect x="120" y="41" width="22" height="2.4" rx="1.2" fill="#f4efe2" opacity="0.55" />
      <circle cx="178" cy="39" r="4.5" fill="#f4efe2" opacity="0.75" />
      <rect x="94" y="70" width="114" height="6" rx="3" fill="#0f1c33" opacity="0.28" />
    </svg>
  );
}

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const surfaceRef = useRef(null);
  const sceneRef = useRef(null);
  const inkRef = useRef(null);
  const pileRef = useRef(null);
  const dustRef = useRef(null);
  const eraserRef = useRef(null);
  const ringRef = useRef(null);
  const engineRef = useRef(null);
  const near = useNearViewport(rootRef);
  const [history, setHistory] = useState(0);
  const [edit, setEdit] = useState(null);
  const editRef = useRef(null);
  const mac = useSyncExternalStore(subscribeNothing, readMac, () => false);

  useEffect(() => {
    if (!near) return undefined;
    const engine = new EraseEngine({
      root: rootRef.current,
      surface: surfaceRef.current,
      scene: sceneRef.current,
      ink: inkRef.current,
      pile: pileRef.current,
      dust: dustRef.current,
      eraser: eraserRef.current,
      ring: ringRef.current,
      embedded,
      onHistory: (count) => setHistory(count),
      onEdit: (index, fromKey = false) => {
        const box = engine.beginEdit(index);
        if (box) setEdit({ ...box, value: box.title, fromKey });
      },
    });
    engineRef.current = engine;
    engine.start();
    return () => {
      engine.destroy();
      if (engineRef.current === engine) engineRef.current = null;
    };
  }, [near, embedded]);

  useEffect(() => {
    if (embedded) return undefined;
    const onKey = (e) => {
      if (e.defaultPrevented || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      if (e.key.toLowerCase() !== "z") return;
      if (e.target?.closest?.("input, textarea, [contenteditable='true']")) return;
      e.preventDefault();
      engineRef.current?.undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [embedded]);

  useEffect(() => {
    if (!edit) return;
    const input = editRef.current;
    if (!input || document.activeElement === input) return;
    input.focus({ preventScroll: true });
    const end = input.value.length;
    input.setSelectionRange(end, end);
  }, [edit]);

  const finishEdit = useCallback((value, next, fromKey) => {
    const engine = engineRef.current;
    setEdit(null);
    if (!engine) return;
    const index = engine.editing;
    engine.endEdit(value == null ? null : value.replace(/\s+/g, " ").trim());
    if (next != null && index >= 0) {
      const count = engine.hand?.lines.length ?? 0;
      const target = (index + next + count) % count;
      const box = engine.beginEdit(target);
      if (box) setEdit({ ...box, value: box.title, fromKey });
    } else if (fromKey) {
      surfaceRef.current?.focus({ preventScroll: true });
    }
  }, []);

  const onEditChange = useCallback((e) => {
    const value = e.target.value.slice(0, TITLE_MAX);
    setEdit((current) => (current ? { ...current, value } : current));
  }, []);

  const onEditKey = useCallback(
    (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        finishEdit(e.currentTarget.value, null, edit?.fromKey);
      } else if (e.key === "Escape") {
        e.preventDefault();
        finishEdit(null, null, edit?.fromKey);
      } else if (e.key === "Tab" || e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        finishEdit(e.currentTarget.value, e.key === "ArrowUp" || (e.key === "Tab" && e.shiftKey) ? -1 : 1, edit?.fromKey);
      }
    },
    [finishEdit, edit?.fromKey],
  );

  const onEditBlur = useCallback(
    (e) => {
      if (engineRef.current?.editing >= 0) finishEdit(e.currentTarget.value);
    },
    [finishEdit],
  );

  const undo = useCallback(() => engineRef.current?.undo(), []);
  const onKeyDown = useCallback((e) => engineRef.current?.key(e), []);
  const onBlur = useCallback(() => engineRef.current?.clearFocus(), []);
  const preventMenu = useCallback((e) => e.preventDefault(), []);

  return (
    <div ref={rootRef} className="erase" data-embedded={embedded ? "" : undefined}>
      <div
        ref={surfaceRef}
        className="erase__surface"
        tabIndex={0}
        role="application"
        aria-roledescription="setlist"
        aria-label={LABEL}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
        onContextMenu={preventMenu}
      >
        <canvas ref={sceneRef} className="erase__scene" aria-hidden="true" />
        <canvas ref={inkRef} className="erase__ink" aria-hidden="true" />
        <canvas ref={pileRef} className="erase__pile" aria-hidden="true" />
        <canvas ref={dustRef} className="erase__dust" aria-hidden="true" />
        <span ref={ringRef} className="erase__ring" aria-hidden="true" />
        <div ref={eraserRef} className="erase__eraser" aria-hidden="true">
          <EraserArt />
        </div>
      </div>

      {edit ? (
        <input
          ref={editRef}
          className="erase__edit"
          type="text"
          value={edit.value}
          maxLength={TITLE_MAX}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="words"
          enterKeyHint="done"
          aria-label={`Song ${edit.index + 1} title`}
          onChange={onEditChange}
          onKeyDown={onEditKey}
          onBlur={onEditBlur}
          style={{
            "--erase-edit-size": edit.size.toFixed(2),
            left: `${edit.left}px`,
            top: `${edit.baseline - edit.size}px`,
            width: `${edit.width}px`,
          }}
        />
      ) : null}

      {embedded ? null : (
        <header className="erase__head">
          <h1 className="erase__title">Erase</h1>
          <p className="erase__lede">
            Click a song to rewrite it, then scrub it off and the ink lifts away as dust. <em>Undo</em> calls it home.
          </p>
        </header>
      )}

      <div className="erase__bar">
        <button
          type="button"
          className="erase__undo"
          onClick={undo}
          disabled={!history}
          aria-label={embedded ? "Undo the last rub" : undefined}
        >
          <UndoIcon />
          {embedded ? null : <span>Undo</span>}
          {embedded ? null : <kbd className="erase__kbd">{mac ? "⌘Z" : "Ctrl Z"}</kbd>}
        </button>
      </div>
    </div>
  );
}
