"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { createFoley } from "./foley";
import { TRACKS, clock } from "./queueData";
import "./queue-drag.css";

const ROW = 64;
const byId = Object.fromEntries(TRACKS.map((t) => [t.id, t]));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const nowMs = () => performance.now();
const rubber = (x, d) => (1 - 1 / ((x * 0.55) / d + 1)) * d;

function Bars({ paused }) {
  return (
    <span className="qd-bars" data-paused={paused ? "true" : "false"} aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}

function GripIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="currentColor">
      <circle cx="6" cy="4" r="1.2" />
      <circle cx="10" cy="4" r="1.2" />
      <circle cx="6" cy="8" r="1.2" />
      <circle cx="10" cy="8" r="1.2" />
      <circle cx="6" cy="12" r="1.2" />
      <circle cx="10" cy="12" r="1.2" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.8 4.2h10.4M6.2 4.2V2.8h3.6v1.4M4.2 4.2l.6 8.6c0 .5.4.9.9.9h4.6c.5 0 .9-.4.9-.9l.6-8.6" />
    </svg>
  );
}

function PauseIcon({ paused }) {
  return paused ? (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M4.5 2.8v10.4a.6.6 0 0 0 .9.5l8.3-5.2a.6.6 0 0 0 0-1L5.4 2.3a.6.6 0 0 0-.9.5Z" fill="currentColor" />
    </svg>
  ) : (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="currentColor">
      <rect x="3.5" y="2.5" width="3.2" height="11" rx="1" />
      <rect x="9.3" y="2.5" width="3.2" height="11" rx="1" />
    </svg>
  );
}

export default function Piece({ embedded = false }) {
  const listRef = useRef(null);
  const nowCoverRef = useRef(null);
  const gestureRef = useRef(null);
  const flipRef = useRef(null);
  const foleyRef = useRef(null);
  const clockRef = useRef({ start: 0, offset: 42 });
  const undoTimer = useRef(0);
  const [nowId, setNowId] = useState(TRACKS[0].id);
  const [order, setOrder] = useState(() => TRACKS.slice(1).map((t) => t.id));
  const [drag, setDrag] = useState(null);
  const [swipe, setSwipe] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [undo, setUndo] = useState(null);
  const [elapsed, setElapsed] = useState(42);
  const [paused, setPaused] = useState(false);
  const [live, setLive] = useState("");

  const now = byId[nowId];
  const remaining = order.reduce((s, id) => s + byId[id].seconds, 0);

  useEffect(() => {
    const foley = createFoley();
    foleyRef.current = foley;
    return () => {
      foley.destroy();
      clearTimeout(undoTimer.current);
    };
  }, []);

  useLayoutEffect(() => {
    const from = flipRef.current;
    const el = nowCoverRef.current;
    flipRef.current = null;
    if (!from || !el) return;
    const to = el.getBoundingClientRect();
    const dx = from.left - to.left;
    const dy = from.top - to.top;
    const s = from.width / to.width;
    el.animate(
      [
        { transform: `translate(${dx}px, ${dy}px) scale(${s})`, borderRadius: "6px" },
        { transform: "translate(0, 0) scale(1)", borderRadius: "10px" },
      ],
      { duration: 520, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
    );
  }, [nowId]);

  const play = (id, coverEl) => {
    if (coverEl) flipRef.current = coverEl.getBoundingClientRect();
    clockRef.current = { start: nowMs(), offset: 0 };
    setElapsed(0);
    setPaused(false);
    setNowId(id);
    setOrder((o) => o.filter((x) => x !== id));
    setLive(`Now playing ${byId[id].title}`);
  };

  useEffect(() => {
    if (paused) return undefined;
    clockRef.current.start = performance.now();
    const base = clockRef.current.offset;
    const length = byId[nowId].seconds;
    const timer = setInterval(() => {
      const t = base + (performance.now() - clockRef.current.start) / 1000;
      clockRef.current.live = t;
      if (t >= length) {
        clearInterval(timer);
        const next = order[0];
        if (next) {
          clockRef.current = { start: performance.now(), offset: 0 };
          setElapsed(0);
          setNowId(next);
          setOrder((o) => o.slice(1));
        } else {
          setElapsed(length);
          setPaused(true);
        }
        return;
      }
      setElapsed(t);
    }, 250);
    return () => {
      clearInterval(timer);
      clockRef.current.offset = clockRef.current.live ?? base;
    };
  }, [nowId, paused, order]);

  const remove = (id) => {
    const index = order.indexOf(id);
    foleyRef.current?.swish();
    setRemoving(id);
    setSwipe(null);
    setTimeout(() => {
      setOrder((o) => o.filter((x) => x !== id));
      setRemoving((r) => (r === id ? null : r));
      setUndo({ id, index });
      setLive(`Removed ${byId[id].title}`);
      clearTimeout(undoTimer.current);
      undoTimer.current = setTimeout(() => setUndo(null), 4800);
    }, 240);
  };

  const restore = () => {
    if (!undo) return;
    setOrder((o) => {
      const next = o.filter((x) => x !== undo.id);
      next.splice(Math.min(undo.index, next.length), 0, undo.id);
      return next;
    });
    setLive(`Restored ${byId[undo.id].title}`);
    setUndo(null);
  };

  const move = (id, to) => {
    setOrder((o) => {
      const from = o.indexOf(id);
      const target = clamp(to, 0, o.length - 1);
      if (from === target) return o;
      const next = o.slice();
      next.splice(from, 1);
      next.splice(target, 0, id);
      return next;
    });
  };

  const startDrag = (g) => {
    g.mode = "drag";
    foleyRef.current?.lift();
    setDrag({ id: g.id, y: g.index * ROW, tilt: 0 });
  };

  const onDown = (e, id, handle, body) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    if (removing) return;
    foleyRef.current?.wake();
    const index = order.indexOf(id);
    const g = {
      id,
      pid: e.pointerId,
      type: e.pointerType,
      x0: e.clientX,
      y0: e.clientY,
      index,
      scroll0: listRef.current?.scrollTop ?? 0,
      mode: null,
      lastX: e.clientX,
      lastY: e.clientY,
      lastT: nowMs(),
      vx: 0,
      vy: 0,
      width: body.offsetWidth,
      cover: body.querySelector("img"),
    };
    gestureRef.current = g;
    body.setPointerCapture(e.pointerId);
    if (handle) {
      e.preventDefault();
      startDrag(g);
    }
  };

  const onMove = (e) => {
    const g = gestureRef.current;
    if (!g || g.pid !== e.pointerId) return;
    const t = nowMs();
    const dt = Math.max(1, t - g.lastT);
    g.vx = g.vx * 0.5 + ((e.clientX - g.lastX) / dt) * 0.5;
    g.vy = g.vy * 0.5 + ((e.clientY - g.lastY) / dt) * 0.5;
    g.lastX = e.clientX;
    g.lastY = e.clientY;
    g.lastT = t;
    const dx = e.clientX - g.x0;
    const dy = e.clientY - g.y0;
    if (!g.mode) {
      if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy) * 1.2) g.mode = "swipe";
      else if (Math.abs(dy) > 8 && g.type === "mouse") startDrag(g);
      else if (Math.abs(dy) > 8) {
        gestureRef.current = null;
        return;
      } else return;
    }
    if (g.mode === "drag") {
      const scroll = (listRef.current?.scrollTop ?? 0) - g.scroll0;
      const y = g.index * ROW + dy + scroll;
      const slot = clamp(Math.round(y / ROW), 0, order.length - 1);
      if (order.indexOf(g.id) !== slot) {
        move(g.id, slot);
        foleyRef.current?.tick();
      }
      setDrag({ id: g.id, y: clamp(y, -ROW * 0.4, (order.length - 0.6) * ROW), tilt: clamp(g.vy * 2.4, -3, 3) });
      const list = listRef.current;
      if (list) {
        const r = list.getBoundingClientRect();
        if (e.clientY < r.top + 48) list.scrollTop -= 8;
        else if (e.clientY > r.bottom - 48) list.scrollTop += 8;
      }
    } else if (g.mode === "swipe") {
      const free = g.width * 0.5;
      const x = dx > 0 ? rubber(dx, 48) : dx > -free ? dx : -free - rubber(-dx - free, g.width * 0.4);
      setSwipe({ id: g.id, x, armed: x < -g.width * 0.32 });
    }
  };

  const onUp = (e) => {
    const g = gestureRef.current;
    if (!g || g.pid !== e.pointerId) return;
    gestureRef.current = null;
    if (g.mode === "drag") {
      setDrag(null);
      setLive(`${byId[g.id].title} moved to position ${order.indexOf(g.id) + 1}`);
    } else if (g.mode === "swipe") {
      const x = swipe?.id === g.id ? swipe.x : 0;
      if (x < -g.width * 0.32 || (g.vx < -0.9 && x < -24)) remove(g.id);
      else setSwipe(null);
    } else if (e.type === "pointerup" && !e.target.closest("[data-qd-handle]")) {
      play(g.id, g.cover);
    }
  };

  const onKey = (e, id) => {
    const i = order.indexOf(id);
    if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      move(id, i + (e.key === "ArrowUp" ? -1 : 1));
      foleyRef.current?.tick();
      requestAnimationFrame(() => listRef.current?.querySelector(`[data-row="${id}"]`)?.focus());
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const next = order[clamp(i + (e.key === "ArrowUp" ? -1 : 1), 0, order.length - 1)];
      listRef.current?.querySelector(`[data-row="${next}"]`)?.focus();
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      const next = order[i + 1] ?? order[i - 1];
      remove(id);
      if (next) requestAnimationFrame(() => listRef.current?.querySelector(`[data-row="${next}"]`)?.focus());
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      play(id, e.currentTarget.querySelector("img"));
    }
  };

  const progress = clamp(elapsed / now.seconds, 0, 1);

  return (
    <div className="qd" data-embedded={embedded ? "true" : "false"} data-dragging={drag ? "true" : "false"}>
      <div className="qd-panel">
        {!embedded && <h1 className="qd-heading text-title-sm">Up Next</h1>}

        <section className="qd-now" aria-label="Now playing">
          <img ref={nowCoverRef} className="qd-now-cover" src={now.cover} alt="" draggable={false} />
          <div className="qd-now-text">
            <p key={now.id} className="qd-now-title text-heading">
              {now.title}
            </p>
            <p className="qd-now-sub text-ui-lg">
              {now.artist} · {now.album}
            </p>
            <div className="qd-progress" aria-hidden="true">
              <span style={{ transform: `scaleX(${progress})` }} />
            </div>
            <p className="qd-times font-mono text-ui tabular-nums">
              <span>{clock(elapsed)}</span>
              <span>−{clock(Math.max(0, now.seconds - elapsed))}</span>
            </p>
          </div>
          <div className="qd-now-side">
            <Bars paused={paused} />
            <button type="button" className="qd-pause" aria-label={paused ? "Play" : "Pause"} onClick={() => setPaused((p) => !p)}>
              <PauseIcon paused={paused} />
            </button>
          </div>
        </section>

        <div className="qd-queue-head">
          <p className="qd-queue-title text-heading-sm">Playing next</p>
          <p className="qd-queue-meta text-ui-lg tabular-nums">
            {order.length} songs · {Math.round(remaining / 60)} min
          </p>
        </div>

        <div ref={listRef} className="qd-list" data-scroll-contain>
          <ol className="qd-rows" style={{ height: order.length * ROW }} aria-label="Queue">
            {order.map((id, i) => {
              const t = byId[id];
              const dragging = drag?.id === id;
              const swiping = swipe?.id === id;
              const gone = removing === id;
              const x = gone ? "-110%" : swiping ? `${swipe.x}px` : "0px";
              const y = dragging ? drag.y : i * ROW;
              return (
                <li
                  key={id}
                  data-row={id}
                  className="qd-row"
                  data-dragging={dragging ? "true" : "false"}
                  data-swiping={swiping ? "true" : "false"}
                  data-gone={gone ? "true" : "false"}
                  data-armed={swiping && swipe.armed ? "true" : "false"}
                  tabIndex={0}
                  aria-label={`${i + 1}. ${t.title}, ${t.artist}, ${t.length}`}
                  style={{ "--y": `${y}px`, "--tilt": `${dragging ? drag.tilt : 0}deg`, "--rs": swiping ? (0.6 + Math.min(120, Math.max(0, -swipe.x)) / 300).toFixed(3) : 0.6 }}
                  onKeyDown={(e) => onKey(e, id)}
                >
                  <span className="qd-remove" aria-hidden="true">
                    <TrashIcon />
                  </span>
                  <div
                    className="qd-row-body"
                    style={{ transform: `translateX(${x})` }}
                    onPointerDown={(e) => onDown(e, id, false, e.currentTarget)}
                    onPointerMove={onMove}
                    onPointerUp={onUp}
                    onPointerCancel={onUp}
                  >
                    <img className="qd-cover" src={t.cover} alt="" draggable={false} />
                    <span className="qd-row-text">
                      <span className="qd-row-title text-ui-lg">{t.title}</span>
                      <span className="qd-row-sub text-ui">{t.album}</span>
                    </span>
                    <span className="qd-len font-mono text-ui tabular-nums">{t.length}</span>
                    <span
                      className="qd-handle"
                      data-qd-handle
                      aria-hidden="true"
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        onDown(e, id, true, e.currentTarget.parentElement);
                      }}
                    >
                      <GripIcon />
                    </span>
                  </div>
                </li>
              );
            })}
          </ol>
          {order.length === 0 && <p className="qd-empty text-ui-lg">Your queue is empty.</p>}
        </div>

        <p className="qd-hint text-ui">Drag the grip to reorder · swipe left to remove · ⌥↑↓ with the keyboard</p>
      </div>

      <div className="qd-toast" data-on={undo ? "true" : "false"} role="status">
        <span className="text-ui-lg">{undo ? `Removed “${byId[undo.id].title}”` : ""}</span>
        <button type="button" className="qd-undo text-ui-lg" onClick={restore} tabIndex={undo ? 0 : -1}>
          Undo
        </button>
      </div>

      <p className="qd-sr" aria-live="polite">
        {live}
      </p>
    </div>
  );
}
