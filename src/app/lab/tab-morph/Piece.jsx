"use client";

import { useEffect, useRef, useState } from "react";

import { albumById } from "@/app/lab/_music/catalog";

import { PAGES } from "./TabPages";
import "./tab-morph.css";

const PEPPER = albumById("sgt-pepper");
const TABS = [
  { id: "home", label: "Home", paths: ["M4 10.5 12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5H15v-6H9v6H5.5A1.5 1.5 0 0 1 4 19z"] },
  { id: "search", label: "Search", paths: ["M17.5 11a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0z", "M16 16l4.5 4.5"] },
  { id: "library", label: "Library", paths: ["M5 4v16.5", "M10 4v16.5", "M14.6 4.6l4.6 15.6"] },
  { id: "radio", label: "Radio", paths: ["M12 10.2a1.8 1.8 0 1 1 0 3.6 1.8 1.8 0 0 1 0-3.6z", "M8.1 8.1a5.5 5.5 0 0 0 0 7.8", "M15.9 8.1a5.5 5.5 0 0 1 0 7.8", "M5.2 5.2a9.6 9.6 0 0 0 0 13.6", "M18.8 5.2a9.6 9.6 0 0 1 0 13.6"] },
];
const PAD = 6;
const INSET = 0;
const RADIUS = 26;

function TabIcon({ tab, active }) {
  const ref = useRef(null);
  const was = useRef(active);
  useEffect(() => {
    const rising = active && !was.current;
    was.current = active;
    if (!rising || !ref.current) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const anims = [];
    ref.current.querySelectorAll("path").forEach((p, i) => {
      anims.push(
        p.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], {
          duration: 460,
          delay: 40 + i * 60,
          easing: "cubic-bezier(0.65, 0, 0.35, 1)",
          fill: "backwards",
        }),
      );
    });
    anims.push(ref.current.animate([{ transform: "scale(0.9)" }, { transform: "scale(1)" }], { duration: 360, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }));
    return () => anims.forEach((a) => a.cancel());
  }, [active]);
  return (
    <svg ref={ref} className="tab-morph-icon" viewBox="0 0 24 24" aria-hidden="true">
      {tab.paths.map((d) => (
        <path key={d} d={d} pathLength="1" />
      ))}
    </svg>
  );
}

export default function Piece({ embedded = false }) {
  const barRef = useRef(null);
  const pillRef = useRef(null);
  const litRef = useRef(null);
  const engineRef = useRef(null);
  const activeRef = useRef(0);
  const [active, setActive] = useState(0);
  const [pages, setPages] = useState([{ id: "home", state: "in", dir: "right", first: true }]);
  const [playing, setPlaying] = useState(true);

  useEffect(() => {
    const bar = barRef.current;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const st = { l: 0, r: 0, vl: 0, vr: 0, tl: 0, tr: 0, kl: 300, kr: 300, w: 0, W: 0, H: 0, raf: 0, last: 0, drag: null };

    const rectFor = (c) => {
      const left = PAD + c * st.w + INSET;
      return [left, left + st.w - INSET * 2];
    };

    const paint = () => {
      const l = st.l;
      const width = Math.max(0, st.r - l);
      pillRef.current.style.transform = `translate3d(${l}px, 0, 0)`;
      pillRef.current.style.width = `${width}px`;
      const right = Math.max(0, st.W - st.r);
      litRef.current.style.clipPath = `inset(${PAD}px ${right.toFixed(2)}px ${PAD}px ${l.toFixed(2)}px round ${RADIUS}px)`;
    };

    const loop = (now) => {
      const dt = Math.min(0.05, (now - st.last) / 1000);
      st.last = now;
      const n = Math.max(1, Math.ceil(dt * 240));
      const h = dt / n;
      for (let i = 0; i < n; i += 1) {
        const al = st.kl * (st.tl - st.l) - 2 * Math.sqrt(st.kl) * st.vl;
        const ar = st.kr * (st.tr - st.r) - 2 * Math.sqrt(st.kr) * st.vr;
        st.vl += al * h;
        st.vr += ar * h;
        st.l += st.vl * h;
        st.r += st.vr * h;
      }
      paint();
      const settled = Math.abs(st.tl - st.l) < 0.1 && Math.abs(st.tr - st.r) < 0.1 && Math.abs(st.vl) < 0.5 && Math.abs(st.vr) < 0.5;
      if (settled && !st.drag) {
        st.l = st.tl;
        st.r = st.tr;
        paint();
        st.raf = 0;
        return;
      }
      st.raf = requestAnimationFrame(loop);
    };
    const kick = () => {
      if (reduce) {
        st.l = st.tl;
        st.r = st.tr;
        paint();
        return;
      }
      if (st.raf) return;
      st.last = performance.now();
      st.raf = requestAnimationFrame(loop);
    };

    const aim = (c, snap) => {
      const [tl, tr] = rectFor(c);
      const movingRight = tl > st.tl + 0.5;
      const movingLeft = tl < st.tl - 0.5;
      const lead = snap ? 520 : 900;
      const trail = snap ? 150 : 520;
      st.kl = movingLeft ? lead : movingRight ? trail : 320;
      st.kr = movingRight ? lead : movingLeft ? trail : 320;
      st.tl = tl;
      st.tr = tr;
      kick();
    };

    const measure = () => {
      st.W = bar.clientWidth;
      st.w = (st.W - PAD * 2) / TABS.length;
      const [tl, tr] = rectFor(activeRef.current);
      st.tl = st.l = tl;
      st.tr = st.r = tr;
      st.vl = st.vr = 0;
      paint();
    };

    const indexAt = (clientX) => {
      const r = bar.getBoundingClientRect();
      return Math.max(0, Math.min(TABS.length - 1, (clientX - r.left - PAD - st.w / 2) / st.w));
    };

    const onDown = (e) => {
      if (e.button !== 0 || st.drag) return;
      st.drag = { id: e.pointerId, x: e.clientX, moved: false };
    };
    const onMove = (e) => {
      if (!st.drag || e.pointerId !== st.drag.id) return;
      if (!st.drag.moved && Math.abs(e.clientX - st.drag.x) < 6) return;
      if (!st.drag.moved) {
        st.drag.moved = true;
        try {
          bar.setPointerCapture(e.pointerId);
        } catch {}
        bar.dataset.dragging = "";
      }
      aim(indexAt(e.clientX), false);
      const nearest = Math.round(indexAt(e.clientX));
      if (nearest !== activeRef.current) engineRef.current.select(nearest, false);
    };
    const onUp = (e) => {
      if (!st.drag || e.pointerId !== st.drag.id) return;
      const moved = st.drag.moved;
      st.drag = null;
      delete bar.dataset.dragging;
      if (moved) {
        st.suppressClick = true;
        window.setTimeout(() => {
          st.suppressClick = false;
        }, 0);
        aim(activeRef.current, true);
      }
    };

    engineRef.current = {
      click(i) {
        if (st.suppressClick) return;
        engineRef.current.select(i);
      },
      select(i, move = true) {
        if (move) aim(i, true);
        if (i === activeRef.current) return;
        const dir = i > activeRef.current ? "right" : "left";
        activeRef.current = i;
        setActive(i);
        const id = TABS[i].id;
        setPages((prev) => {
          const has = prev.some((p) => p.id === id);
          let next = prev.map((p) => (p.id === id ? { id, state: "in", dir } : p.state === "in" ? { ...p, state: "out", dir } : p));
          if (!has) next = [...next, { id, state: "in", dir }];
          const outs = next.filter((p) => p.state === "out");
          if (outs.length > 2) next = next.filter((p) => p.state === "in" || outs.slice(-2).includes(p));
          return next;
        });
      },
    };

    const ro = new ResizeObserver(measure);
    ro.observe(bar);
    measure();
    bar.addEventListener("pointerdown", onDown);
    bar.addEventListener("pointermove", onMove);
    bar.addEventListener("pointerup", onUp);
    bar.addEventListener("pointercancel", onUp);
    bar.addEventListener("lostpointercapture", onUp);
    return () => {
      cancelAnimationFrame(st.raf);
      ro.disconnect();
      bar.removeEventListener("pointerdown", onDown);
      bar.removeEventListener("pointermove", onMove);
      bar.removeEventListener("pointerup", onUp);
      bar.removeEventListener("pointercancel", onUp);
      bar.removeEventListener("lostpointercapture", onUp);
    };
  }, []);

  const onKey = (e) => {
    const n = TABS.length;
    let next = null;
    if (e.key === "ArrowRight") next = (active + 1) % n;
    if (e.key === "ArrowLeft") next = (active - 1 + n) % n;
    if (e.key === "Home") next = 0;
    if (e.key === "End") next = n - 1;
    if (next == null) return;
    e.preventDefault();
    engineRef.current?.select(next);
    barRef.current?.querySelectorAll("[role=tab]")[next]?.focus();
  };

  const settle = (id) => (e) => {
    if (e.target !== e.currentTarget || e.propertyName !== "opacity") return;
    setPages((prev) => prev.filter((p) => !(p.id === id && p.state === "out")));
  };

  const Root = embedded ? "div" : "main";

  return (
    <Root className="tab-morph" data-embedded={embedded ? "" : undefined}>
      {embedded ? null : (
        <header className="tab-morph-head">
          <h1 className="tab-morph-title">Tab Morph</h1>
        </header>
      )}

      <section className="tab-morph-screen">
        <div className="tab-morph-pages">
          {pages.map((p) => {
            const Page = PAGES[p.id];
            const live = p.state === "in";
            return (
              <div
                key={p.id}
                className="tab-morph-page"
                data-state={p.state}
                data-dir={p.dir}
                data-first={p.first ? "" : undefined}
                data-scroll-contain=""
                role={live ? "tabpanel" : undefined}
                id={live ? `tab-morph-panel-${p.id}` : undefined}
                aria-hidden={live ? undefined : true}
                inert={!live}
                onTransitionEnd={live ? undefined : settle(p.id)}
              >
                <Page />
              </div>
            );
          })}
        </div>

        <div className="tab-morph-dock">
          <div className="tab-morph-player">
            <img src={PEPPER.cover} alt="" draggable={false} />
            <span className="tab-morph-player-text">
              <span className="tab-morph-player-title">Lucy in the Sky with Diamonds</span>
              <span className="tab-morph-player-meta">The Beatles</span>
            </span>
            <button type="button" className="tab-morph-play" aria-label={playing ? "Pause" : "Play"} onClick={() => setPlaying((p) => !p)}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                {playing ? <path d="M7 5h3.4v14H7zM13.6 5H17v14h-3.4z" /> : <path d="M8 5.2v13.6L19 12z" />}
              </svg>
            </button>
            <span className="tab-morph-progress" aria-hidden="true" data-playing={playing ? "" : undefined} />
          </div>

          <div ref={barRef} className="tab-morph-bar" role="tablist" aria-label="Sections" onKeyDown={onKey}>
            <div className="tab-morph-tabrow">
              {TABS.map((tab, i) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  className="tab-morph-tab"
                  aria-selected={i === active}
                  aria-controls={`tab-morph-panel-${tab.id}`}
                  tabIndex={i === active ? 0 : -1}
                  onClick={() => engineRef.current?.click(i)}
                >
                  <TabIcon tab={tab} active={i === active} />
                  <span className="tab-morph-label">{tab.label}</span>
                </button>
              ))}
            </div>
            <div ref={pillRef} className="tab-morph-pill" aria-hidden="true" />
            <div ref={litRef} className="tab-morph-tabrow tab-morph-tabrow--lit" aria-hidden="true">
              {TABS.map((tab, i) => (
                <span key={tab.id} className="tab-morph-tab">
                  <TabIcon tab={tab} active={i === active} />
                  <span className="tab-morph-label">{tab.label}</span>
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>
    </Root>
  );
}
