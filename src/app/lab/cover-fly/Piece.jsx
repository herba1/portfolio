"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { ALBUMS } from "@/app/lab/_music/catalog";
import { clack, toss, wakeAudio } from "./foley";

import "./cover-fly.css";

const BASE = 160;
const GHOSTS = [3, 6, 9];
const START = ["abbey-road", "revolver"];
const byId = Object.fromEntries(ALBUMS.map((a) => [a.id, a]));

const ease = (u) => 1 - Math.pow(1 - u, 2.4);

function centerOf(el, origin) {
  const r = el.getBoundingClientRect();
  return { x: r.left - origin.left + r.width / 2, y: r.top - origin.top + r.height / 2, w: r.width };
}

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const stripRef = useRef(null);
  const scrollRef = useRef(null);
  const gridEls = useRef(new Map());
  const frameEls = useRef(new Map());
  const flyerEls = useRef(new Map());
  const flights = useRef(new Map());
  const dest = useRef(new Map(START.map((id) => [id, "strip"])));
  const raf = useRef(0);
  const tickRef = useRef(null);
  const [queue, setQueue] = useState(START);
  const [leaving, setLeaving] = useState([]);
  const [flying, setFlying] = useState({});

  const land = useCallback((rec) => {
    flights.current.delete(rec.id);
    const target = rec.dir === "strip" ? frameEls.current.get(rec.id) : gridEls.current.get(rec.id);
    target?.animate(
      [{ transform: "scale(1.1)" }, { transform: "scale(0.97)" }, { transform: "scale(1)" }],
      { duration: 460, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
    );
    if (rec.dir === "strip") {
      stripRef.current?.animate(
        [{ transform: "translateY(0)" }, { transform: "translateY(4px)" }, { transform: "translateY(0)" }],
        { duration: 300, easing: "cubic-bezier(0.3, 0.7, 0.2, 1)" },
      );
      target?.animate([{ opacity: 0.85 }, { opacity: 0 }], { duration: 560, easing: "ease-out", pseudoElement: "::after" });
    }
    clack();
    setFlying((f) => {
      const next = { ...f };
      delete next[rec.id];
      return next;
    });
    if (rec.dir === "grid") {
      setQueue((q) => q.filter((x) => x !== rec.id));
      setLeaving((l) => l.filter((x) => x !== rec.id));
    }
  }, []);

  const tick = useCallback(
    (now) => {
      const root = rootRef.current;
      if (!root) return;
      const origin = root.getBoundingClientRect();
      for (const rec of [...flights.current.values()]) {
        const el = flyerEls.current.get(rec.id);
        if (!el) continue;
        if (rec.t0 == null) rec.t0 = now;
        const u = Math.min(1, (now - rec.t0) / rec.dur);
        const e = ease(u);
        const targetEl = rec.dir === "strip" ? frameEls.current.get(rec.id) : gridEls.current.get(rec.id);
        if (targetEl) rec.to = centerOf(targetEl, origin);
        const { from, to } = rec;
        if (!to) continue;
        const dist = Math.hypot(to.x - from.x, to.y - from.y);
        const lift = Math.min(260, Math.max(64, dist * 0.38));
        const cx = (from.x + to.x) / 2 + (to.x - from.x) * 0.12;
        const cy = Math.min(from.y, to.y) - lift;
        const k = 1 - e;
        const x = k * k * from.x + 2 * k * e * cx + e * e * to.x;
        const y = k * k * from.y + 2 * k * e * cy + e * e * to.y;
        const w = from.w + (to.w - from.w) * e;
        const r = Math.sin(Math.PI * e) * (to.x >= from.x ? 10 : -10);
        rec.cur = { x, y, w };
        rec.trail.push({ x, y, w, r });
        if (rec.trail.length > 12) rec.trail.shift();
        el.style.transform = `translate3d(${(x - BASE / 2).toFixed(2)}px, ${(y - BASE / 2).toFixed(2)}px, 0) rotate(${r.toFixed(2)}deg) scale(${(w / BASE).toFixed(4)})`;
        GHOSTS.forEach((lag, gi) => {
          const ghost = flyerEls.current.get(`${rec.id}:${gi}`);
          if (!ghost) return;
          const p = rec.trail[Math.max(0, rec.trail.length - 1 - lag)];
          ghost.style.transform = `translate3d(${(p.x - BASE / 2).toFixed(2)}px, ${(p.y - BASE / 2).toFixed(2)}px, 0) rotate(${p.r.toFixed(2)}deg) scale(${(p.w / BASE).toFixed(4)})`;
          ghost.style.opacity = u < 1 ? String((0.3 - gi * 0.09) * Math.sin(Math.PI * Math.min(1, u * 1.15))) : "0";
        });
        if (u >= 1) land(rec);
      }
    },
    [land],
  );

  useEffect(() => {
    tickRef.current = tick;
  }, [tick]);

  const loop = useCallback(() => {
    cancelAnimationFrame(raf.current);
    const step = (now) => {
      tickRef.current?.(now);
      if (flights.current.size) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
  }, []);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  useLayoutEffect(() => {
    if (flights.current.size) tick(performance.now());
  }, [flying, tick]);

  const send = useCallback(
    (id) => {
      const root = rootRef.current;
      if (!root) return;
      wakeAudio();
      const origin = root.getBoundingClientRect();
      const dir = dest.current.get(id) === "strip" ? "grid" : "strip";
      dest.current.set(id, dir);
      const prev = flights.current.get(id);
      const sourceEl = dir === "strip" ? gridEls.current.get(id) : frameEls.current.get(id);
      const from = prev?.cur || (sourceEl ? centerOf(sourceEl, origin) : null);
      if (!from) return;
      flights.current.set(id, { id, dir, from, to: null, cur: from, t0: null, dur: prev ? 520 : 660, trail: prev?.trail || [] });
      setFlying((f) => ({ ...f, [id]: dir }));
      if (dir === "strip") {
        setQueue((q) => (q.includes(id) ? q : [...q, id]));
        setLeaving((l) => l.filter((x) => x !== id));
      } else {
        setLeaving((l) => (l.includes(id) ? l : [...l, id]));
      }
      toss();
      loop();
    },
    [loop],
  );

  const clearAll = () => {
    const ids = queue.filter((id) => dest.current.get(id) === "strip");
    ids.forEach((id, i) => setTimeout(() => send(id), i * 90));
  };

  const queued = queue.filter((id) => !leaving.includes(id));
  const prevCount = useRef(queue.length);
  useEffect(() => {
    const scroller = scrollRef.current;
    if (scroller && queue.length > prevCount.current) scroller.scrollTo({ left: scroller.scrollWidth, behavior: "smooth" });
    prevCount.current = queue.length;
  }, [queue.length]);

  const Root = embedded ? "div" : "main";

  return (
    <Root ref={rootRef} className="cf-root" data-embedded={embedded ? "" : undefined}>
      {embedded ? null : (
        <header className="cf-head">
          <h1 className="text-title-sm">Cover Fly</h1>
          <p className="cf-hint text-ui-lg">Tap a record to toss it onto the reel. Tap it on the reel, or mid-air, to send it home.</p>
        </header>
      )}
      <div className="cf-body">
        <ul className="cf-grid">
          {ALBUMS.map((a) => {
            const away = queue.includes(a.id) || flying[a.id];
            return (
              <li key={a.id} className="cf-cell">
                <button
                  type="button"
                  className="cf-cover"
                  data-away={away ? "" : undefined}
                  aria-label={away ? `${a.title} is on the reel. Send it back` : `Queue ${a.title}`}
                  onClick={() => send(a.id)}
                  ref={(el) => {
                    if (el) gridEls.current.set(a.id, el);
                    else gridEls.current.delete(a.id);
                  }}
                >
                  <img src={a.cover} alt="" draggable={false} />
                </button>
                <span className="cf-title">{a.title}</span>
                <span className="cf-year">{a.year}</span>
              </li>
            );
          })}
        </ul>
      </div>
      <section className="cf-dock" aria-label="Up next">
        <div className="cf-dock-head">
          <span className="cf-dock-label">Up next</span>
          <span className="cf-dock-count">
            {queued.length} {queued.length === 1 ? "record" : "records"}
          </span>
          <button type="button" className="cf-clear" onClick={clearAll} disabled={!queued.length}>
            Clear
          </button>
        </div>
        <div ref={stripRef} className="cf-strip">
          <div ref={scrollRef} className="cf-scroll" data-scroll-contain="">
            <ol className="cf-reel">
              {queue.map((id, i) => {
                const a = byId[id];
                return (
                  <li key={id} className="cf-frame" data-leaving={leaving.includes(id) ? "" : undefined}>
                    <button
                      type="button"
                      className="cf-frame-cover"
                      data-hidden={flying[id] ? "" : undefined}
                      aria-label={`Send ${a.title} back`}
                      onClick={() => send(id)}
                      ref={(el) => {
                        if (el) frameEls.current.set(id, el);
                        else frameEls.current.delete(id);
                      }}
                    >
                      <img src={a.cover} alt="" draggable={false} />
                    </button>
                    <span className="cf-edge">{String(i + 1).padStart(2, "0")}A</span>
                  </li>
                );
              })}
              {queued.length === 0 ? <li className="cf-empty">Tap a record to load the reel</li> : null}
            </ol>
          </div>
        </div>
      </section>
      <div className="cf-sky" aria-hidden="true">
        {Object.keys(flying).map((id) => (
          <div key={id}>
            {GHOSTS.map((_, gi) => (
              <img
                key={gi}
                className="cf-ghost"
                src={byId[id].cover}
                alt=""
                draggable={false}
                ref={(el) => {
                  if (el) flyerEls.current.set(`${id}:${gi}`, el);
                  else flyerEls.current.delete(`${id}:${gi}`);
                }}
              />
            ))}
            <img
              className="cf-flyer"
              src={byId[id].cover}
              alt=""
              draggable={false}
              onPointerDown={() => send(id)}
              ref={(el) => {
                if (el) flyerEls.current.set(id, el);
                else flyerEls.current.delete(id);
              }}
            />
          </div>
        ))}
      </div>
    </Root>
  );
}
