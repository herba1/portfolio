"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import MorphToolbar, { COLORS, TOOLS } from "./MorphToolbar";
import { createSketch, seedSketch } from "./sketchEngine";
import "./morph-toolbar.css";

const DEFAULTS = {
  pen: { size: 4, opacity: 100 },
  marker: { size: 10, opacity: 100 },
  highlighter: { size: 22, opacity: 40 },
  eraser: { size: 28, opacity: 100 },
};

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const stageRef = useRef(null);
  const baseRef = useRef(null);
  const liveRef = useRef(null);
  const scratchRef = useRef(null);
  const toolbarRef = useRef(null);
  const sketch = useRef(null);
  const drawing = useRef(null);
  const tuck = useRef({ from: null, timer: 0 });

  const [mode, setMode] = useState("tools");
  const [tool, setTool] = useState("pen");
  const [color, setColor] = useState(COLORS[0].value);
  const [settings, setSettings] = useState(DEFAULTS);
  const [canUndo, setCanUndo] = useState(true);

  const latest = useRef({ mode, tool, color, settings });
  useEffect(() => {
    latest.current = { mode, tool, color, settings };
  });

  useEffect(() => {
    const stage = stageRef.current;
    const engine = createSketch(baseRef.current, liveRef.current, scratchRef.current);
    sketch.current = engine;
    let seeded = false;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width < 1 || height < 1) return;
      engine.resize(Math.round(width), Math.round(height));
      if (!seeded) {
        seeded = true;
        engine.seed(seedSketch(width, height, COLORS[0].value));
      }
    });
    ro.observe(stage);
    const t = tuck.current;
    return () => {
      ro.disconnect();
      cancelAnimationFrame(drawing.current?.raf || 0);
      clearTimeout(t.timer);
    };
  }, []);

  const changeMode = useCallback((m) => {
    clearTimeout(tuck.current.timer);
    tuck.current.from = null;
    setMode(m);
  }, []);

  const pickColor = useCallback((value, close) => {
    setColor(value);
    setTool((t) => (t === "eraser" ? "pen" : t));
    if (close) {
      clearTimeout(tuck.current.timer);
      tuck.current.timer = setTimeout(() => setMode((m) => (m === "palette" ? "tools" : m)), 180);
    }
  }, []);

  const setSetting = useCallback((t, key, v) => {
    setSettings((s) => (s[t][key] === v ? s : { ...s, [t]: { ...s[t], [key]: v } }));
  }, []);

  const undo = useCallback(() => {
    const engine = sketch.current;
    if (!engine) return;
    engine.undo();
    setCanUndo(engine.state.strokes.length > 0);
  }, []);

  const toLocal = (e) => {
    const r = drawing.current.rect;
    const [cx, cy] = sketch.current.center();
    return [e.clientX - r.left - cx, e.clientY - r.top - cy];
  };

  const frame = () => {
    const d = drawing.current;
    if (!d) return;
    d.raf = 0;
    sketch.current.flush();
  };

  const schedule = () => {
    const d = drawing.current;
    if (d && !d.raf) d.raf = requestAnimationFrame(frame);
  };

  const addPoint = (e) => {
    const d = drawing.current;
    const [x, y] = toLocal(e);
    const last = d.stroke.pts[d.stroke.pts.length - 1];
    const dist = Math.hypot(x - last[0], y - last[1]);
    if (dist < 1.2) return;
    const dt = Math.max(1, e.timeStamp - d.lastT);
    d.lastT = e.timeStamp;
    const speed = dist / dt;
    let w = d.base;
    if (d.stroke.tool === "pen") {
      const target = d.base * Math.min(1.3, Math.max(0.42, 1.3 - speed * 0.42));
      w = last[2] + (target - last[2]) * 0.32;
    }
    d.stroke.pts.push([x, y, w]);
  };

  const nearToolbar = (e) => {
    const r = drawing.current.toolbarRect;
    if (!r) return false;
    const pad = 56;
    return e.clientX > r.left - pad && e.clientX < r.right + pad && e.clientY > r.top - pad && e.clientY < r.bottom + pad;
  };

  const onPointerDown = (e) => {
    if (e.button !== 0 || !sketch.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    stageRef.current.focus({ preventScroll: true });
    clearTimeout(tuck.current.timer);
    const { tool: t, color: c, settings: s } = latest.current;
    const cfg = s[t];
    const base = cfg.size;
    drawing.current = {
      id: e.pointerId,
      rect: stageRef.current.getBoundingClientRect(),
      toolbarRect: toolbarRef.current?.rect(),
      lastT: e.timeStamp,
      base,
      raf: 0,
      stroke: { tool: t, color: c, size: cfg.size, opacity: t === "eraser" ? 1 : cfg.opacity / 100, pts: [] },
    };
    const [x, y] = toLocal(e);
    drawing.current.stroke.pts.push([x, y, t === "pen" ? base * 0.8 : base]);
    liveRef.current.dataset.tool = t;
    liveRef.current.style.opacity = String(drawing.current.stroke.opacity);
    sketch.current.begin(drawing.current.stroke);
    schedule();
  };

  const onPointerMove = (e) => {
    const d = drawing.current;
    if (!d || d.id !== e.pointerId) return;
    const events = e.nativeEvent.getCoalescedEvents?.() || [];
    if (events.length) for (const ev of events) addPoint(ev);
    else addPoint(e.nativeEvent);
    if (!tuck.current.from && latest.current.mode !== "disc" && nearToolbar(e)) {
      tuck.current.from = latest.current.mode;
      setMode("disc");
    }
    schedule();
  };

  const onPointerUp = (e) => {
    const d = drawing.current;
    if (!d || d.id !== e.pointerId) return;
    cancelAnimationFrame(d.raf);
    sketch.current.end();
    drawing.current = null;
    setCanUndo(true);
    const from = tuck.current.from;
    if (from) {
      clearTimeout(tuck.current.timer);
      tuck.current.timer = setTimeout(() => {
        tuck.current.from = null;
        setMode((m) => (m === "disc" ? from : m));
      }, 420);
    }
  };

  const onKeyDown = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      undo();
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.closest?.("[role='slider']")) return;
    const hit = TOOLS.find((t) => t.key === e.key.toLowerCase());
    if (hit) {
      setTool(hit.id);
      return;
    }
    if (e.key === "Escape" && latest.current.mode !== "disc") changeMode("disc");
  };

  return (
    <div ref={rootRef} className="mt-root" data-embedded={embedded || undefined} onKeyDown={onKeyDown}>
      {!embedded && <h1 className="mt-title text-title-sm">Morph toolbar</h1>}
      <div
        ref={stageRef}
        className="mt-stage"
        tabIndex={-1}
        aria-label="Sketch canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <canvas ref={baseRef} className="mt-canvas" aria-hidden />
        <canvas ref={liveRef} className="mt-canvas mt-canvas--live" aria-hidden />
        <canvas ref={scratchRef} className="mt-canvas mt-canvas--scratch" aria-hidden />
      </div>
      <MorphToolbar
        ref={toolbarRef}
        mode={mode}
        onMode={changeMode}
        tool={tool}
        onTool={setTool}
        color={color}
        onColor={pickColor}
        settings={settings}
        onSetting={setSetting}
        canUndo={canUndo}
        onUndo={undo}
      />
    </div>
  );
}
