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
const INSET = 4;

function TabIcon({ tab, active }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!active || !ref.current) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const paths = ref.current.querySelectorAll("path");
    paths.forEach((p, i) => {
      p.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], {
        duration: 520,
        delay: 60 + i * 70,
        easing: "cubic-bezier(0.65, 0, 0.35, 1)",
        fill: "backwards",
      });
    });
    ref.current.animate(
      [
        { transform: "scale(0.86)", easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
        { transform: "scale(1.08)", offset: 0.5, easing: "cubic-bezier(0.45, 0, 0.55, 1)" },
        { transform: "scale(1)" },
      ],
      { duration: 520, easing: "linear" },
    );
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
  const pillImgRef = useRef(null);
  const glowRef = useRef(null);
  const glowImgRef = useRef(null);
  const engineRef = useRef(null);
  const activeRef = useRef(0);
  const [active, setActive] = useState(0);
  const [dir, setDir] = useState(1);
  const [playing, setPlaying] = useState(true);

  useEffect(() => {
    const bar = barRef.current;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const st = { l: 0, r: 0, vl: 0, vr: 0, tl: 0, tr: 0, kl: 300, kr: 300, w: 0, W: 0, raf: 0, last: 0, drag: null, base: 0 };

    const rectFor = (c) => {
      const left = PAD + c * st.w + INSET;
      return [left, left + st.w - INSET * 2];
    };

    const paint = () => {
      const width = Math.max(0, st.r - st.l);
      const stretch = st.base ? Math.max(0, width / st.base - 1) : 0;
      const sy = 1 - Math.min(0.16, stretch * 0.22);
      pillRef.current.style.transform = `translate3d(${st.l}px, 0, 0) scaleY(${sy.toFixed(4)})`;
      pillRef.current.style.width = `${width}px`;
      pillImgRef.current.style.transform = `translate3d(${-st.l}px, 0, 0)`;
      glowRef.current.style.transform = `translate3d(${st.l}px, 0, 0)`;
      glowRef.current.style.width = `${width}px`;
      glowImgRef.current.style.transform = `translate3d(${-st.l}px, 0, 0)`;
    };

    const loop = (now) => {
      const dt = Math.min(0.033, (now - st.last) / 1000);
      st.last = now;
      const n = Math.max(1, Math.ceil(dt * 240));
      const h = dt / n;
      for (let i = 0; i < n; i += 1) {
        const al = st.kl * (st.tl - st.l) - 2 * Math.sqrt(st.kl) * 0.92 * st.vl;
        const ar = st.kr * (st.tr - st.r) - 2 * Math.sqrt(st.kr) * 0.92 * st.vr;
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

    const aim = (c, stiffLead) => {
      const [tl, tr] = rectFor(c);
      const movingRight = tl > st.tl + 0.5;
      const movingLeft = tl < st.tl - 0.5;
      const lead = stiffLead ? 460 : 300;
      const trail = stiffLead ? 150 : 300;
      st.kl = movingLeft ? lead : movingRight ? trail : 300;
      st.kr = movingRight ? lead : movingLeft ? trail : 300;
      st.tl = tl;
      st.tr = tr;
      kick();
    };

    const measure = () => {
      st.W = bar.clientWidth;
      st.w = (st.W - PAD * 2) / TABS.length;
      st.base = st.w - INSET * 2;
      for (const img of [pillImgRef.current, glowImgRef.current]) {
        img.style.width = `${st.W}px`;
        img.style.top = `${26 - st.W * 0.66}px`;
      }
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
      if (e.button !== 0) return;
      st.drag = { id: e.pointerId, x: e.clientX, moved: false };
    };
    const onMove = (e) => {
      if (!st.drag || e.pointerId !== st.drag.id) return;
      if (!st.drag.moved && Math.abs(e.clientX - st.drag.x) < 6) return;
      if (!st.drag.moved) {
        st.drag.moved = true;
        bar.setPointerCapture(e.pointerId);
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
        aim(Math.round(indexAt(e.clientX)), true);
      }
    };

    engineRef.current = {
      select(i, move = true) {
        if (i === activeRef.current && move) {
          aim(i, true);
          return;
        }
        setDir(i > activeRef.current ? 1 : -1);
        activeRef.current = i;
        setActive(i);
        if (move) aim(i, true);
      },
    };

    const ro = new ResizeObserver(measure);
    ro.observe(bar);
    measure();
    bar.addEventListener("pointerdown", onDown);
    bar.addEventListener("pointermove", onMove);
    bar.addEventListener("pointerup", onUp);
    bar.addEventListener("pointercancel", onUp);
    return () => {
      cancelAnimationFrame(st.raf);
      ro.disconnect();
      bar.removeEventListener("pointerdown", onDown);
      bar.removeEventListener("pointermove", onMove);
      bar.removeEventListener("pointerup", onUp);
      bar.removeEventListener("pointercancel", onUp);
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

  const Page = PAGES[TABS[active].id];
  const Root = embedded ? "div" : "main";

  return (
    <Root className="tab-morph" data-embedded={embedded ? "" : undefined}>
      {embedded ? null : (
        <header className="tab-morph-head">
          <h1 className="tab-morph-title">Tab Morph</h1>
          <p className="tab-morph-hint">Tap a tab, or drag along the bar and let go.</p>
        </header>
      )}

      <section className="tab-morph-screen">
        <div className="tab-morph-scroll" data-scroll-contain="">
          <div key={TABS[active].id} className="tab-morph-page" data-dir={dir > 0 ? "right" : "left"} role="tabpanel" id={`tab-morph-panel-${TABS[active].id}`}>
            <Page />
          </div>
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

          <div className="tab-morph-barwrap">
            <div ref={glowRef} className="tab-morph-glow" aria-hidden="true">
              <img ref={glowImgRef} src={PEPPER.cover} alt="" draggable={false} />
            </div>
            <div ref={barRef} className="tab-morph-bar" role="tablist" aria-label="Sections" onKeyDown={onKey}>
              <div ref={pillRef} className="tab-morph-pill" aria-hidden="true">
                <img ref={pillImgRef} src={PEPPER.cover} alt="" draggable={false} />
              </div>
              {TABS.map((tab, i) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  className="tab-morph-tab"
                  aria-selected={i === active}
                  aria-controls={`tab-morph-panel-${tab.id}`}
                  tabIndex={i === active ? 0 : -1}
                  onClick={() => engineRef.current?.select(i)}
                >
                  <TabIcon tab={tab} active={i === active} />
                  <span className="tab-morph-label">{tab.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>
    </Root>
  );
}
