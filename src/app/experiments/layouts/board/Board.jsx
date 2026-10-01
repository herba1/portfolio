"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { shortDate } from "../pieces";

// The hang, in wall units. Every frame lays out at 1280px wide and takes its
// rect's aspect; `w` sets how big it hangs. A wall label sits under each one,
// set in ordinary UI type and enlarged with the wall so it reads at a fit.
const VIRTUAL = 1280;
const HANG = [
  { x: 0, y: 0, w: 1280, h: 800 },
  { x: 1440, y: 0, w: 760, h: 760 },
  { x: 2360, y: 0, w: 900, h: 560 },
  { x: 2360, y: 920, w: 640, h: 400 },
  { x: 0, y: 1160, w: 760, h: 900 },
  { x: 920, y: 1160, w: 1280, h: 720 },
  { x: 2360, y: 1680, w: 900, h: 580 },
  { x: 920, y: 2240, w: 520, h: 360 },
];
const LABEL_GAP = 24;
const LABEL_H = 140;
const LABEL_SCALE = 3.5;
const PAD = 96;
const MIN_Z = 0.08;
const MAX_Z = 1.5;

function bounds(n) {
  const rects = HANG.slice(0, n);
  const x1 = Math.min(...rects.map((r) => r.x));
  const y1 = Math.min(...rects.map((r) => r.y));
  const x2 = Math.max(...rects.map((r) => r.x + r.w));
  const y2 = Math.max(...rects.map((r) => r.y + r.h + LABEL_GAP + LABEL_H));
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

export default function Board({ pieces }) {
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

  const fitAll = useCallback((smooth) => fitTo(bounds(pieces.length), smooth), [fitTo, pieces.length]);

  useLayoutEffect(() => {
    fitAll(false);
    const onResize = () => fitAll(false);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [fitAll]);

  // Wheel pans; ⌘/Ctrl-wheel (and trackpad pinch, which arrives as ctrl) zooms
  // toward the pointer. Only over the wall — a frame keeps its own wheel.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      setAnimate(false);
      setView((v) => {
        if (!v) return v;
        if (e.ctrlKey || e.metaKey) {
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
    if (e.button !== 0 || e.target.closest("a, button")) return;
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
          {pieces.map((piece, i) => {
            const r = HANG[i % HANG.length];
            const s = r.w / VIRTUAL;
            return (
              <div key={piece.slug}>
                <div className="xl-board__frame" style={{ left: r.x, top: r.y, width: r.w, height: r.h }}>
                  <iframe
                    src={piece.slug}
                    title={piece.title}
                    allow="microphone; autoplay; clipboard-write"
                    style={{ width: VIRTUAL, height: r.h / s, transform: `scale(${s})` }}
                  />
                </div>
                <div
                  className="xl-board__label"
                  style={{
                    left: r.x,
                    top: r.y + r.h + LABEL_GAP,
                    width: r.w / LABEL_SCALE,
                    transform: `scale(${LABEL_SCALE})`,
                  }}
                >
                  <button
                    type="button"
                    className="xl-board__title text-heading-sm"
                    onClick={() => fitTo({ x: r.x, y: r.y, w: r.w, h: r.h + LABEL_GAP + LABEL_H }, true)}
                  >
                    <span className="text-ink-secondary tabular-nums">{piece.index}</span>
                    <span className="text-ink">{piece.title}</span>
                  </button>
                  <p className="text-ink-secondary text-ui truncate">
                    {shortDate(piece.date)} · {piece.tags.join(", ")} ·{" "}
                    <Link href={piece.slug} className="text-accent">Open</Link>
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
      <button type="button" className="xl-board__fit text-ui-lg" onClick={() => fitAll(true)}>
        Whole wall <kbd className="tabular-nums">0</kbd>
      </button>
    </main>
  );
}
