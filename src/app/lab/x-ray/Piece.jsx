"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import useNearViewport from "@/app/experiments/useNearViewport";

import { ITEMS, stageLayout } from "./xrayArt";
import "./x-ray.css";

const DWELL = 260;

function useBoxSize(ref) {
  const [size, setSize] = useState(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const box = el.closest(".piece-box") ?? el;
    const ro = new ResizeObserver(() => {
      const rect = box.getBoundingClientRect();
      setSize({ width: Math.round(rect.width), height: Math.round(rect.height) });
    });
    ro.observe(box);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const canvasRef = useRef(null);
  const engineRef = useRef(null);
  const dwellRef = useRef(0);
  const hoverRef = useRef(null);
  const ghostRef = useRef({ raf: 0, timer: 0, touched: false });
  const pointerRef = useRef(null);
  const near = useNearViewport(rootRef);
  const size = useBoxSize(rootRef);
  const [phase, setPhase] = useState("loading");
  const [label, setLabel] = useState(null);

  const layout = size ? stageLayout(size.width, size.height) : null;

  const toScreen = useCallback(
    (bx, by) => (layout ? [layout.x + bx * layout.scale, layout.y + by * layout.scale] : [0, 0]),
    [layout],
  );

  const stopGhost = useCallback(() => {
    const ghost = ghostRef.current;
    cancelAnimationFrame(ghost.raf);
    clearTimeout(ghost.timer);
    ghost.raf = 0;
    ghost.timer = 0;
  }, []);

  const runGhost = useCallback(() => {
    const engine = engineRef.current;
    const root = rootRef.current;
    if (!engine || !root || ghostRef.current.touched) return;
    const rect = root.getBoundingClientRect();
    const l = stageLayout(rect.width, rect.height);
    const path = [
      [120, 300],
      [330, 250],
      [500, 380],
      [640, 300],
      [780, 420],
      [900, 330],
    ].map(([bx, by]) => [l.x + bx * l.scale, l.y + by * l.scale]);
    const duration = 3600;
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, Math.max(0, (now - start) / duration));
      const eased = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
      const f = eased * (path.length - 1);
      const i = Math.max(0, Math.min(path.length - 2, Math.floor(f)));
      const k = f - i;
      const s = k * k * (3 - 2 * k);
      const x = path[i][0] + (path[i + 1][0] - path[i][0]) * s;
      const y = path[i][1] + (path[i + 1][1] - path[i][1]) * s;
      if (t === 0) engineRef.current?.jump(x, y);
      engineRef.current?.move(x, y, false);
      if (t < 1) {
        ghostRef.current.raf = requestAnimationFrame(tick);
      } else {
        ghostRef.current.raf = 0;
        engineRef.current?.release();
        ghostRef.current.again?.();
      }
    };
    ghostRef.current.raf = requestAnimationFrame(tick);
  }, []);

  useEffect(() => {
    if (!near) return undefined;
    let cancelled = false;
    let engine = null;
    const ghost = ghostRef.current;
    ghost.again = embedded
      ? () => {
          ghost.timer = setTimeout(runGhost, 8000);
        }
      : null;
    import("./xrayEngine").then(({ createXray }) => {
      if (cancelled) return;
      const root = rootRef.current;
      engine = createXray({
        canvas: canvasRef.current,
        box: root.closest(".piece-box") ?? root,
        onReady: () => {
          setPhase("ready");
          ghost.timer = setTimeout(runGhost, embedded ? 1200 : 1800);
        },
        onFail: () => setPhase("failed"),
      });
      if (!engine) return;
      engineRef.current = engine;
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(ghost.raf);
      clearTimeout(ghost.timer);
      clearTimeout(dwellRef.current);
      engine?.destroy();
      engineRef.current = null;
    };
  }, [near, embedded, runGhost]);

  const itemAt = useCallback(
    (x, y) => {
      if (!layout) return null;
      const bx = (x - layout.x) / layout.scale;
      const by = (y - layout.y) / layout.scale;
      return ITEMS.find(({ box }) => bx >= box[0] && bx <= box[0] + box[2] && by >= box[1] && by <= box[1] + box[3]) ?? null;
    },
    [layout],
  );

  const hover = useCallback(
    (item, immediate = false) => {
      if (hoverRef.current === item?.id) return;
      hoverRef.current = item?.id ?? null;
      clearTimeout(dwellRef.current);
      if (!item) {
        setLabel((current) => (current ? { ...current, shown: false } : current));
        return;
      }
      setLabel((current) => (current ? { ...current, shown: false } : current));
      dwellRef.current = setTimeout(
        () => {
          const [ax, y] = toScreen(item.anchor[0], item.anchor[1]);
          const half = item.label.length * 3.6 + 16;
          const limit = rootRef.current?.clientWidth ?? ax * 2;
          const x = Math.min(limit - 16 - half, Math.max(16 + half, ax));
          setLabel({ id: item.id, text: item.label, x, y, lead: ax - x, shown: true });
        },
        immediate ? 0 : DWELL,
      );
    },
    [toScreen],
  );

  const local = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top];
  };

  const takeOver = () => {
    ghostRef.current.touched = true;
    stopGhost();
  };

  const onPointerMove = (event) => {
    if (event.pointerType !== "mouse" && pointerRef.current !== event.pointerId) return;
    takeOver();
    const [x, y] = local(event);
    engineRef.current?.move(x, y, true);
    hover(itemAt(x, y));
  };

  const onPointerDown = (event) => {
    if (event.pointerType === "mouse") return;
    pointerRef.current = event.pointerId;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    takeOver();
    const [x, y] = local(event);
    engineRef.current?.jump(x, y);
    hover(itemAt(x, y));
  };

  const onPointerEnd = (event) => {
    if (event.pointerType !== "mouse") {
      if (pointerRef.current !== event.pointerId) return;
      pointerRef.current = null;
    }
    engineRef.current?.release();
    hover(null);
  };

  const onPointerLeave = (event) => {
    if (event.pointerType === "mouse") onPointerEnd(event);
  };

  const focusItem = (event, item) => {
    if (!event.currentTarget.matches(":focus-visible")) return;
    takeOver();
    const [x, y] = toScreen(item.box[0] + item.box[2] / 2, item.box[1] + item.box[3] / 2);
    engineRef.current?.jump(x, y);
    hover(item, true);
  };

  const blurItem = () => {
    engineRef.current?.release();
    hover(null);
  };

  return (
    <div ref={rootRef} className="x-ray" data-phase={phase} data-embedded={embedded ? "" : undefined}>
      <div
        className="x-ray__stage"
        onPointerMove={onPointerMove}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onPointerLeave={onPointerLeave}
      >
        <canvas ref={canvasRef} className="x-ray__canvas" aria-hidden="true" />
        {layout
          ? ITEMS.map((item) => {
              const [x, y] = toScreen(item.box[0], item.box[1]);
              return (
                <button
                  key={item.id}
                  type="button"
                  className="x-ray__item"
                  aria-label={item.label}
                  style={{ left: x, top: y, width: item.box[2] * layout.scale, height: item.box[3] * layout.scale }}
                  onFocus={(event) => focusItem(event, item)}
                  onBlur={blurItem}
                  tabIndex={0}
                />
              );
            })
          : null}
        {label ? (
          <div className="x-ray__label" data-shown={label.shown ? "" : undefined} style={{ left: label.x, top: label.y }} aria-hidden="true">
            <span className="x-ray__tag">{label.text}</span>
            <span className="x-ray__leader" style={{ transform: `translateX(${label.lead}px)` }} />
          </div>
        ) : null}
      </div>

      {embedded ? null : (
        <header className="x-ray__head">
          <h1 className="x-ray__title">Carry-On</h1>
          <p className="x-ray__lede">
            Run your pointer over the bag and the scanner sees <em>through</em> it. Hold still on something to read what it is.
          </p>
        </header>
      )}
      <p className="x-ray__live" aria-live="polite">
        {label?.shown ? label.text : ""}
      </p>
    </div>
  );
}
