"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { createFoley } from "./foley";
import { TRACKS, clock } from "./queueData";
import "./queue-drag.css";

const ROW = 72;
const EDGE = 72;
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
      <rect x="2.5" y="4.2" width="11" height="1.5" rx="0.75" />
      <rect x="2.5" y="7.25" width="11" height="1.5" rx="0.75" />
      <rect x="2.5" y="10.3" width="11" height="1.5" rx="0.75" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.8 4.2h10.4M6.2 4.2V2.8h3.6v1.4M4.2 4.2l.6 8.6c0 .5.4.9.9.9h4.6c.5 0 .9-.4.9-.9l.6-8.6" />
    </svg>
  );
}

function PlayPauseIcon({ paused, size = 20 }) {
  return paused ? (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true">
      <path d="M4.5 2.8v10.4a.6.6 0 0 0 .9.5l8.3-5.2a.6.6 0 0 0 0-1L5.4 2.3a.6.6 0 0 0-.9.5Z" fill="currentColor" />
    </svg>
  ) : (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true" fill="currentColor">
      <rect x="3.5" y="2.5" width="3.2" height="11" rx="1" />
      <rect x="9.3" y="2.5" width="3.2" height="11" rx="1" />
    </svg>
  );
}

function SkipIcon({ back }) {
  return (
    <svg viewBox="0 0 16 16" width="20" height="20" aria-hidden="true" fill="currentColor" style={back ? { transform: "scaleX(-1)" } : undefined}>
      <path d="M2.5 3.6v8.8a.5.5 0 0 0 .8.4L9 8.4a.5.5 0 0 0 0-.8L3.3 3.2a.5.5 0 0 0-.8.4Z" />
      <rect x="10.6" y="3" width="2.4" height="10" rx="0.8" />
    </svg>
  );
}

export default function Piece({ embedded = false }) {
  const listRef = useRef(null);
  const nowCoverRef = useRef(null);
  const gestureRef = useRef(null);
  const orderRef = useRef([]);
  const flipRef = useRef(null);
  const foleyRef = useRef(null);
  const rafRef = useRef(0);
  const clockRef = useRef({ start: 0, offset: 42 });
  const undoTimer = useRef(0);
  const removeTimers = useRef([]);
  const [nowId, setNowId] = useState(TRACKS[0].id);
  const [order, setOrder] = useState(() => TRACKS.slice(1).map((t) => t.id));
  const [drag, setDrag] = useState(null);
  const [swipe, setSwipe] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [undo, setUndo] = useState(null);
  const [lastRemoved, setLastRemoved] = useState("");
  const [fresh, setFresh] = useState(null);
  const [elapsed, setElapsed] = useState(42);
  const [paused, setPaused] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const [live, setLive] = useState("");

  const now = byId[nowId];
  const remaining = order.reduce((s, id) => s + byId[id].seconds, 0);

  useLayoutEffect(() => {
    orderRef.current = order;
  }, [order]);

  useEffect(() => {
    const foley = createFoley();
    foleyRef.current = foley;
    const timers = removeTimers.current;
    return () => {
      foley.destroy();
      clearTimeout(undoTimer.current);
      cancelAnimationFrame(rafRef.current);
      timers.forEach(clearTimeout);
    };
  }, []);

  useLayoutEffect(() => {
    const from = flipRef.current;
    const el = nowCoverRef.current;
    flipRef.current = null;
    if (!from || !el) return;
    const to = el.getBoundingClientRect();
    const s = from.width / to.width;
    el.getAnimations().forEach((a) => a.cancel());
    el.animate(
      [
        { transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${s})`, borderRadius: `${8 / s}px` },
        { transform: "translate(0, 0) scale(1)", borderRadius: "12px" },
      ],
      { duration: 480, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
    );
  }, [nowId]);

  const play = (id, coverEl) => {
    if (!byId[id]) return;
    if (coverEl) flipRef.current = coverEl.getBoundingClientRect();
    clockRef.current = { start: nowMs(), offset: 0, live: 0 };
    setElapsed(0);
    setPaused(false);
    setNowId(id);
    setOrder((o) => o.filter((x) => x !== id));
    setLive(`Now playing ${byId[id].title}`);
  };

  const playNext = () => {
    const next = order[0];
    if (!next) return;
    play(next, listRef.current?.querySelector(`[data-row="${next}"] img`));
  };

  const restart = () => {
    clockRef.current = { start: nowMs(), offset: 0, live: 0 };
    setElapsed(0);
    setEpoch((n) => n + 1);
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
        const next = orderRef.current[0];
        if (next) {
          clockRef.current = { start: performance.now(), offset: 0, live: 0 };
          setElapsed(0);
          setNowId(next);
          setOrder((o) => o.filter((x) => x !== next));
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
  }, [nowId, paused, epoch]);

  const remove = (id) => {
    const index = orderRef.current.indexOf(id);
    if (index < 0) return;
    foleyRef.current?.swish();
    setRemoving(id);
    setSwipe(null);
    const t = setTimeout(() => {
      setOrder((o) => o.filter((x) => x !== id));
      setRemoving((r) => (r === id ? null : r));
      setUndo({ id, index });
      setLastRemoved(byId[id].title);
      setLive(`Removed ${byId[id].title}`);
      clearTimeout(undoTimer.current);
      undoTimer.current = setTimeout(() => setUndo(null), 5000);
    }, 300);
    removeTimers.current.push(t);
  };

  const restore = () => {
    if (!undo) return;
    clearTimeout(undoTimer.current);
    setOrder((o) => {
      const next = o.filter((x) => x !== undo.id);
      next.splice(Math.min(undo.index, next.length), 0, undo.id);
      return next;
    });
    setFresh(undo.id);
    setLive(`Restored ${byId[undo.id].title}`);
    setUndo(null);
  };

  const move = (id, to) => {
    setOrder((o) => {
      const from = o.indexOf(id);
      const target = clamp(to, 0, o.length - 1);
      if (from < 0 || from === target) return o;
      const next = o.slice();
      next.splice(from, 1);
      next.splice(target, 0, id);
      return next;
    });
  };

  const place = (g) => {
    const list = listRef.current;
    const n = orderRef.current.length;
    const scroll = (list?.scrollTop ?? 0) - g.scroll0;
    const y = g.index * ROW + (g.lastY - g.y0) + scroll;
    const slot = clamp(Math.round(y / ROW), 0, n - 1);
    if (slot !== g.slot) {
      g.slot = slot;
      move(g.id, slot);
      foleyRef.current?.tick();
    }
    const lo = -ROW * 0.3;
    const hi = (n - 1) * ROW + ROW * 0.3;
    const shown = y < lo ? lo - rubber(lo - y, ROW * 0.4) : y > hi ? hi + rubber(y - hi, ROW * 0.4) : y;
    setDrag({ id: g.id, y: shown, tilt: clamp(g.vy * 1.6, -2, 2) });
  };

  const autoScroll = () => {
    rafRef.current = 0;
    const g = gestureRef.current;
    const list = listRef.current;
    if (!g || g.mode !== "drag" || !list) return;
    const r = list.getBoundingClientRect();
    const top = g.lastY - r.top;
    const bottom = r.bottom - g.lastY;
    let speed = 0;
    if (top < EDGE) speed = -((Math.min(EDGE, EDGE - top) / EDGE) ** 2) * 16;
    else if (bottom < EDGE) speed = (Math.min(EDGE, EDGE - bottom) / EDGE) ** 2 * 16;
    if (speed) {
      const before = list.scrollTop;
      list.scrollTop = before + speed;
      if (list.scrollTop !== before) place(g);
    }
    g.vy *= 0.85;
    rafRef.current = requestAnimationFrame(autoScroll);
  };

  const startDrag = (g) => {
    g.mode = "drag";
    g.slot = g.index;
    foleyRef.current?.lift();
    setSwipe(null);
    setDrag({ id: g.id, y: g.index * ROW, tilt: 0 });
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(autoScroll);
  };

  const onDown = (e, id, handle, body) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    if (removing || gestureRef.current) return;
    foleyRef.current?.wake();
    const index = orderRef.current.indexOf(id);
    const g = {
      id,
      pid: e.pointerId,
      type: e.pointerType,
      x0: e.clientX,
      y0: e.clientY,
      index,
      slot: index,
      scroll0: listRef.current?.scrollTop ?? 0,
      mode: null,
      lastX: e.clientX,
      lastY: e.clientY,
      lastT: nowMs(),
      vx: 0,
      vy: 0,
      swipeX: 0,
      width: body.offsetWidth,
      cover: body.querySelector("img"),
      el: body,
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
      place(g);
    } else if (g.mode === "swipe") {
      const free = g.width * 0.6;
      const x = dx > 0 ? rubber(dx, 40) : dx > -free ? dx : -free - rubber(-dx - free, g.width * 0.3);
      g.swipeX = x;
      setSwipe({ id: g.id, x, armed: x < -g.width * 0.36 });
    }
  };

  const onUp = (e) => {
    const g = gestureRef.current;
    if (!g || g.pid !== e.pointerId) return;
    gestureRef.current = null;
    cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    if (g.mode === "drag") {
      setDrag(null);
      setLive(`${byId[g.id].title} moved to position ${orderRef.current.indexOf(g.id) + 1}`);
    } else if (g.mode === "swipe") {
      const x = g.swipeX;
      if (e.type === "pointerup" && (x < -g.width * 0.36 || (g.vx < -0.8 && x < -32))) remove(g.id);
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
      if (next) setTimeout(() => listRef.current?.querySelector(`[data-row="${next}"]`)?.focus(), 320);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      play(id, e.currentTarget.querySelector("img"));
    }
  };

  const progress = clamp(elapsed / now.seconds, 0, 1);

  return (
    <div className="qd" data-embedded={embedded ? "true" : "false"} data-dragging={drag ? "true" : "false"}>
      <div className="qd-layout">
        <section className="qd-now" aria-label="Now playing">
          <img ref={nowCoverRef} className="qd-now-cover" src={now.cover} alt={`${now.album} cover`} draggable={false} />
          <div className="qd-now-text">
            <p className="qd-now-eyebrow text-ui-lg">
              <Bars paused={paused} />
              {paused ? "Paused" : "Now playing"}
            </p>
            <p key={now.id} className="qd-now-title text-title">
              {now.title}
            </p>
            <p className="qd-now-sub text-body">
              {now.artist} · {now.album}
            </p>
          </div>
          <div className="qd-scrub">
            <div className="qd-progress" aria-hidden="true">
              <span style={{ transform: `scaleX(${progress})` }} />
            </div>
            <p className="qd-times text-ui-lg tabular-nums">
              <span>{clock(elapsed)}</span>
              <span>−{clock(Math.max(0, now.seconds - elapsed))}</span>
            </p>
          </div>
          <div className="qd-controls">
            <button type="button" className="qd-ctl" aria-label="Restart song" onClick={restart}>
              <SkipIcon back />
            </button>
            <button type="button" className="qd-ctl qd-ctl--main" aria-label={paused ? "Play" : "Pause"} onClick={() => setPaused((p) => !p)}>
              <PlayPauseIcon paused={paused} size={22} />
            </button>
            <button type="button" className="qd-ctl" aria-label="Next song" disabled={!order.length} onClick={playNext}>
              <SkipIcon />
            </button>
          </div>
        </section>

        <section className="qd-queue" aria-label="Queue">
          <div className="qd-queue-head">
            <h1 className="qd-queue-title text-title-sm">Up next</h1>
            <div className="qd-queue-side">
              <p className="qd-queue-meta text-ui-lg tabular-nums" data-on={undo ? "false" : "true"} aria-hidden={undo ? "true" : "false"}>
                {order.length} songs · {Math.round(remaining / 60)} min
              </p>
              <div className="qd-undo" data-on={undo ? "true" : "false"} role="status">
                <span className="qd-undo-label text-ui-lg">Removed {lastRemoved}</span>
                <button type="button" className="qd-undo-btn text-ui-lg" onClick={restore} tabIndex={undo ? 0 : -1}>
                  Undo
                </button>
              </div>
            </div>
          </div>

          <div ref={listRef} className="qd-list" data-scroll-contain>
            <ol className="qd-rows" style={{ height: order.length * ROW }}>
              {TRACKS.filter((t) => order.includes(t.id)).map((t) => {
                const id = t.id;
                const i = order.indexOf(id);
                const dragging = drag?.id === id;
                const swiping = swipe?.id === id;
                const gone = removing === id;
                const inset = gone ? "100%" : swiping ? `${Math.max(0, -swipe.x)}px` : "0px";
                const nudge = swiping && swipe.x > 0 ? swipe.x : 0;
                const y = dragging ? drag.y : i * ROW;
                const reveal = swiping ? clamp(-swipe.x / 120, 0, 1) : gone ? 1 : 0;
                return (
                  <li
                    key={id}
                    data-row={id}
                    className="qd-row"
                    data-dragging={dragging ? "true" : "false"}
                    data-swiping={swiping ? "true" : "false"}
                    data-gone={gone ? "true" : "false"}
                    data-armed={(swiping && swipe.armed) || gone ? "true" : "false"}
                    data-fresh={fresh === id ? "true" : "false"}
                    tabIndex={0}
                    aria-label={`${i + 1}. ${t.title}, ${t.artist}, ${t.length}`}
                    style={{ "--y": `${y}px`, "--tilt": `${dragging ? drag.tilt : 0}deg`, "--reveal": reveal.toFixed(3) }}
                    onKeyDown={(e) => onKey(e, id)}
                    onAnimationEnd={() => fresh === id && setFresh(null)}
                  >
                    <div className="qd-card">
                      <span className="qd-remove" aria-hidden="true">
                        <TrashIcon />
                        <span className="text-ui-lg">Remove</span>
                      </span>
                      <div
                        className="qd-row-body"
                        style={{ right: inset, transform: nudge ? `translateX(${nudge}px)` : undefined }}
                        onPointerDown={(e) => onDown(e, id, false, e.currentTarget)}
                        onPointerMove={onMove}
                        onPointerUp={onUp}
                        onPointerCancel={onUp}
                        onLostPointerCapture={onUp}
                      >
                        <img className="qd-cover" src={t.cover} alt="" draggable={false} />
                        <span className="qd-row-text">
                          <span className="qd-row-title text-body">{t.title}</span>
                          <span className="qd-row-sub text-ui-lg">{t.album}</span>
                        </span>
                        <span className="qd-len text-ui-lg tabular-nums">{t.length}</span>
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
                    </div>
                  </li>
                );
              })}
            </ol>
            {order.length === 0 && <p className="qd-empty text-body">Nothing queued. The music stops after this song.</p>}
          </div>
        </section>
      </div>

      <p className="qd-sr" aria-live="polite">
        {live}
      </p>
    </div>
  );
}
