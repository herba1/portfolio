"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Piece from "../Piece";
import { shortDate } from "../pieces";

// The hang, in wall units: a salon wall of four columns, each dropped by a
// different amount so the tops never line up. A piece's width sets how big it
// hangs and its own aspect sets the height; the piece lays itself out at that
// size and the wall's zoom scales it. A wall label sits under each one, set in UI
// type and enlarged with the wall so it still reads at a fit.
const COLUMNS = [
  { drop: 0, items: [["/ink", 440], ["/halftone", 480]] },
  { drop: 96, items: [["/refract", 620], ["/deck", 620]] },
  { drop: 32, items: [["/psa", 340], ["/song-search", 440]] },
  { drop: 144, items: [["/backdrop", 420], ["/tuner", 520]] },
];
const COLUMN_GAP = 96;
const ROW_GAP = 72;
const LABEL_GAP = 16;
const LABEL_H = 48;
const LABEL_SCALE = 1.75;
const PAD = 96;
const MIN_Z = 0.08;
const MAX_Z = 2;

function hang(pieces) {
  const bySlug = new Map(pieces.map((p) => [p.slug, p]));
  const placed = new Set();
  const cols = COLUMNS.map((col) => ({
    drop: col.drop,
    items: col.items.filter(([slug]) => bySlug.has(slug)).map(([slug, w]) => {
      placed.add(slug);
      return { piece: bySlug.get(slug), w };
    }),
  }));
  // Anything new joins the shortest column at a middling size.
  const colHeight = (col) =>
    col.drop + col.items.reduce((sum, { piece, w }) => sum + w / piece.aspect + LABEL_GAP + LABEL_H + ROW_GAP, 0);
  for (const piece of pieces) {
    if (placed.has(piece.slug)) continue;
    cols.reduce((a, b) => (colHeight(b) < colHeight(a) ? b : a)).items.push({ piece, w: 480 });
  }
  const out = [];
  let x = 0;
  for (const col of cols) {
    let y = col.drop;
    const width = Math.max(0, ...col.items.map((it) => it.w));
    for (const { piece, w } of col.items) {
      const h = Math.round(w / piece.aspect);
      out.push({ piece, x: x + (width - w) / 2, y, w, h });
      y += h + LABEL_GAP + LABEL_H + ROW_GAP;
    }
    x += width + COLUMN_GAP;
  }
  return out;
}

function bounds(rects) {
  const x1 = Math.min(...rects.map((r) => r.x));
  const y1 = Math.min(...rects.map((r) => r.y));
  const x2 = Math.max(...rects.map((r) => r.x + r.w));
  const y2 = Math.max(...rects.map((r) => r.y + r.h + LABEL_GAP + LABEL_H));
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

export default function Board({ pieces, data }) {
  const stageRef = useRef(null);
  const [view, setView] = useState(null);
  const [animate, setAnimate] = useState(false);
  const [dragging, setDragging] = useState(false);
  const drag = useRef(null);

  const fitTo = useCallback((rect, smooth) => {
    const el = stageRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const z = Math.min((width - PAD * 2) / rect.w, (height - PAD * 2) / rect.h, MAX_Z);
    setAnimate(Boolean(smooth));
    setView({
      z,
      x: (width - rect.w * z) / 2 - rect.x * z,
      y: (height - rect.h * z) / 2 - rect.y * z,
    });
  }, []);

  const rects = useMemo(() => hang(pieces), [pieces]);
  const fitAll = useCallback((smooth) => fitTo(bounds(rects), smooth), [fitTo, rects]);

  useLayoutEffect(() => {
    fitAll(false);
    const onResize = () => fitAll(false);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [fitAll]);

  // Wheel pans; ⌘/Ctrl-wheel (and trackpad pinch, which arrives as ctrl) zooms
  // toward the pointer, anywhere. A plain wheel over a piece is left to it.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      const zoom = e.ctrlKey || e.metaKey;
      // A plain wheel over a piece belongs to the piece (Deck runs on it).
      if (!zoom && e.target.closest(".piece-box")) return;
      e.preventDefault();
      setAnimate(false);
      setView((v) => {
        if (!v) return v;
        if (zoom) {
          const rect = el.getBoundingClientRect();
          const px = e.clientX - rect.left;
          const py = e.clientY - rect.top;
          const z = Math.min(MAX_Z, Math.max(MIN_Z, v.z * Math.exp(-e.deltaY * 0.01)));
          const k = z / v.z;
          return { z, x: px - (px - v.x) * k, y: py - (py - v.y) * k };
        }
        return { ...v, x: v.x - e.deltaX, y: v.y - e.deltaY };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "0" && !e.metaKey && !e.ctrlKey) fitAll(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fitAll]);

  const onPointerDown = (e) => {
    if (e.button !== 0 || e.target.closest("a, button, .piece-box")) return;
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
    setAnimate(false);
    setDragging(true);
  };
  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    d.x = e.clientX;
    d.y = e.clientY;
    setView((v) => v && { ...v, x: v.x + dx, y: v.y + dy });
  };
  const onPointerUp = (e) => {
    if (drag.current?.id !== e.pointerId) return;
    drag.current = null;
    setDragging(false);
  };

  return (
    <main
      ref={stageRef}
      className="xl-board"
      data-dragging={dragging}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <h1 className="sr-only">Experiments</h1>
      {view ? (
        <div
          className="xl-board__wall"
          data-animate={animate}
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})` }}
        >
          {rects.map(({ piece, x, y, w, h }) => (
            <div key={piece.slug}>
              <div className="xl-board__frame" style={{ left: x, top: y, width: w, height: h }}>
                <Piece slug={piece.slug} data={data} />
              </div>
              <div
                className="xl-board__label"
                style={{ left: x, top: y + h + LABEL_GAP, width: w / LABEL_SCALE, transform: `scale(${LABEL_SCALE})` }}
              >
                <button
                  type="button"
                  className="xl-board__title text-heading-sm"
                  onClick={() => fitTo({ x, y, w, h: h + LABEL_GAP + LABEL_H }, true)}
                >
                  <span className="text-ink-secondary tabular-nums">{piece.index}</span>
                  <span className="text-ink">{piece.title}</span>
                </button>
                <p className="text-ink-secondary text-ui truncate">
                  {shortDate(piece.date)} · {piece.tags.join(", ")} ·{" "}
                  <Link href={piece.slug} className="text-accent">
                    Open
                  </Link>
                </p>
              </div>
            </div>
          ))}
        </div>
      ) : null}
      <button type="button" className="xl-board__fit text-ui-lg" onClick={() => fitAll(true)}>
        Whole wall <kbd className="tabular-nums">0</kbd>
      </button>
    </main>
  );
}
