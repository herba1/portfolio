"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { ALBUMS } from "@/app/lab/_music/catalog";
import { clack, toss, wakeAudio } from "./foley";

import "./cover-fly.css";

const BASE = 160;
const START = ["abbey-road", "revolver", "rubber-soul"];
const byId = Object.fromEntries(ALBUMS.map((a) => [a.id, a]));

const ease = (u) => {
  const s = u * u * (3 - 2 * u);
  const o = 1 - Math.pow(1 - u, 3);
  return s * 0.45 + o * 0.55;
};

function rectIn(el, origin) {
  const r = el.getBoundingClientRect();
  return { x: r.left - origin.left + r.width / 2, y: r.top - origin.top + r.height / 2, w: r.width };
}

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const scrollRef = useRef(null);
  const gridEls = useRef(new Map());
  const slotEls = useRef(new Map());
  const flyerEls = useRef(new Map());
  const flights = useRef(new Map());
  const raf = useRef(0);
  const [dock, setDock] = useState(() => START.map((id) => ({ id, leaving: false })));
  const queue = dock.filter((d) => !d.leaving).map((d) => d.id);
  const [flying, setFlying] = useState({});

  const targetOf = useCallback((rec) => (rec.dir === "dock" ? slotEls.current.get(rec.id) : gridEls.current.get(rec.id)), []);

  const settle = (el, from = 0.94) => {
    el?.animate([{ transform: `scale(${from})` }, { transform: "scale(1)" }], { duration: 260, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
  };

  const step = useCallback(
    (now) => {
      const root = rootRef.current;
      if (!root) return;
      const origin = root.getBoundingClientRect();
      const landed = [];
      for (const rec of flights.current.values()) {
        const el = flyerEls.current.get(rec.id);
        if (!el) continue;
        if (rec.t0 == null) rec.t0 = now;
        const target = targetOf(rec);
        if (target) rec.to = rectIn(target, origin);
        if (!rec.to) continue;
        const u = Math.min(1, (now - rec.t0) / rec.dur);
        const e = ease(u);
        const { from, to } = rec;
        const dist = Math.hypot(to.x - from.x, to.y - from.y);
        const lift = Math.min(140, dist * 0.22);
        const cx = from.x + (to.x - from.x) * 0.5;
        const cy = Math.min(from.y, to.y) - lift;
        const k = 1 - e;
        const x = k * k * from.x + 2 * k * e * cx + e * e * to.x;
        const y = k * k * from.y + 2 * k * e * cy + e * e * to.y;
        const w = from.w + (to.w - from.w) * e;
        const arc = Math.sin(Math.PI * e);
        const r = arc * (to.x >= from.x ? 5 : -5) + rec.spin * (1 - e);
        const s = (w / BASE) * (1 + arc * 0.06);
        rec.cur = { x, y, w };
        rec.r = r;
        el.style.transform = `translate3d(${(x - BASE / 2).toFixed(2)}px, ${(y - BASE / 2).toFixed(2)}px, 0) rotate(${r.toFixed(2)}deg) scale(${s.toFixed(4)})`;
        el.style.setProperty("--cf-lift", arc.toFixed(3));
        if (u >= 1) landed.push(rec);
      }
      for (const rec of landed) {
        flights.current.delete(rec.id);
        settle(targetOf(rec), rec.dir === "dock" ? 0.92 : 0.97);
        clack();
      }
      if (landed.length) {
        setFlying((f) => {
          const next = { ...f };
          landed.forEach((rec) => delete next[rec.id]);
          return next;
        });
      }
    },
    [targetOf],
  );

  const stepRef = useRef(step);
  useEffect(() => {
    stepRef.current = step;
  }, [step]);

  const loop = useCallback(() => {
    if (raf.current) return;
    const tick = (now) => {
      stepRef.current(now);
      raf.current = flights.current.size ? requestAnimationFrame(tick) : 0;
    };
    raf.current = requestAnimationFrame(tick);
  }, []);

  useEffect(
    () => () => {
      cancelAnimationFrame(raf.current);
      raf.current = 0;
    },
    [],
  );

  useLayoutEffect(() => {
    if (flights.current.size) step(performance.now());
  }, [flying, step]);

  const queueRef = useRef(queue);
  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

  const send = useCallback(
    (id) => {
      const root = rootRef.current;
      if (!root) return;
      wakeAudio();
      const origin = root.getBoundingClientRect();
      const prev = flights.current.get(id);
      const inQueue = queueRef.current.includes(id);
      const dir = inQueue ? "grid" : "dock";
      const sourceEl = dir === "dock" ? gridEls.current.get(id) : slotEls.current.get(id);
      const from = prev?.cur || (sourceEl ? rectIn(sourceEl, origin) : null);
      if (!from) return;
      const toEl = dir === "dock" ? null : gridEls.current.get(id);
      const guess = toEl ? rectIn(toEl, origin) : null;
      const dist = guess ? Math.hypot(guess.x - from.x, guess.y - from.y) : 600;
      flights.current.set(id, {
        id,
        dir,
        from,
        to: null,
        cur: from,
        t0: null,
        dur: prev ? 440 : Math.min(720, 440 + dist * 0.35),
        spin: prev?.r || 0,
      });
      queueRef.current = inQueue ? queueRef.current.filter((x) => x !== id) : [...queueRef.current, id];
      setDock((list) => {
        if (inQueue) return list.map((d) => (d.id === id ? { ...d, leaving: true } : d));
        if (list.some((d) => d.id === id)) return list.map((d) => (d.id === id ? { ...d, leaving: false } : d));
        return [...list, { id, leaving: false }];
      });
      if (inQueue) {
        setTimeout(() => setDock((list) => list.filter((d) => !(d.id === id && d.leaving))), 460);
      }
      setFlying((f) => ({ ...f, [id]: dir }));
      toss();
      loop();
    },
    [loop],
  );

  const clearAll = () => {
    [...queueRef.current].reverse().forEach((id, i) => setTimeout(() => send(id), i * 70));
  };

  const prevCount = useRef(queue.length);
  useEffect(() => {
    const scroller = scrollRef.current;
    if (scroller && queue.length > prevCount.current) scroller.scrollTo({ left: scroller.scrollWidth, behavior: "smooth" });
    prevCount.current = queue.length;
  }, [queue.length]);

  const Root = embedded ? "div" : "main";
  const count = queue.length;

  return (
    <Root ref={rootRef} className="cf-root" data-embedded={embedded ? "" : undefined}>
      {embedded ? null : (
        <header className="cf-head">
          <h1 className="text-title-sm">Cover Fly</h1>
        </header>
      )}
      <div className="cf-body">
        <ul className="cf-grid">
          {ALBUMS.map((a) => {
            const pos = queue.indexOf(a.id);
            const queued = pos >= 0;
            return (
              <li key={a.id} className="cf-cell">
                <button
                  type="button"
                  className="cf-cover"
                  data-queued={queued ? "" : undefined}
                  aria-pressed={queued}
                  aria-label={queued ? `${a.title}, number ${pos + 1} up next. Remove from queue` : `Add ${a.title} to up next`}
                  onClick={() => send(a.id)}
                  ref={(el) => {
                    if (el) gridEls.current.set(a.id, el);
                    else gridEls.current.delete(a.id);
                  }}
                >
                  <img src={a.cover} alt="" draggable={false} />
                  <span className="cf-badge" aria-hidden="true">
                    <span key={pos} className="cf-badge-n">
                      {queued ? pos + 1 : ""}
                    </span>
                  </span>
                </button>
                <span className="cf-title">{a.title}</span>
                <span className="cf-year">{a.year}</span>
              </li>
            );
          })}
        </ul>
      </div>
      <section className="cf-dock" aria-label="Up next">
        <div className="cf-dock-label">
          <span className="cf-dock-name">Up next</span>
          <span className="cf-dock-count">{count === 0 ? "Nothing queued" : `${count} ${count === 1 ? "record" : "records"}`}</span>
        </div>
        <div ref={scrollRef} className="cf-scroll" data-scroll-contain="">
          <ol className="cf-queue">
            {dock.map(({ id, leaving }) => {
              const a = byId[id];
              return (
                <li key={id} className="cf-slot" data-leaving={leaving ? "" : undefined}>
                  <button
                    type="button"
                    className="cf-slot-cover"
                    data-pending={flying[id] === "dock" || leaving ? "" : undefined}
                    tabIndex={leaving ? -1 : undefined}
                    aria-label={`Remove ${a.title} from up next`}
                    title={a.title}
                    onClick={() => send(id)}
                    ref={(el) => {
                      if (el) slotEls.current.set(id, el);
                      else slotEls.current.delete(id);
                    }}
                  >
                    <img src={a.cover} alt="" draggable={false} />
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
        <button type="button" className="cf-clear" onClick={clearAll} disabled={!count}>
          Clear
        </button>
      </section>
      <div className="cf-sky" aria-hidden="true">
        {Object.keys(flying).map((id) => (
          <img
            key={id}
            className="cf-flyer"
            src={byId[id].cover}
            alt=""
            draggable={false}
            onPointerDown={(e) => {
              e.preventDefault();
              send(id);
            }}
            ref={(el) => {
              if (el) flyerEls.current.set(id, el);
              else flyerEls.current.delete(id);
            }}
          />
        ))}
      </div>
    </Root>
  );
}
