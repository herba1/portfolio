"use client";

import { useLayoutEffect, useRef, useState } from "react";

import { SECTIONS, SONG, length } from "./chart";
import { sleep, springFor, wake } from "./loop";
import "./clip-tabs.css";

const LEAD = springFor(0.32, 0.9);
const TRAIL = springFor(0.42, 0.9);
const SQUEEZE = springFor(0.2, 1);
const SUB = 1 / 240;
const PAD = 4;
const COUNT = SECTIONS.length;

const rubber = (d, dim) => (d * dim * 0.55) / (dim + 0.55 * Math.abs(d));

function createPill() {
  const pill = {
    el: null,
    width: 0,
    l: 0,
    r: 0,
    vl: 0,
    vr: 0,
    tl: 0,
    tr: 0,
    s: 0,
    vs: 0,
    ts: 0,
    dir: 1,
    at: 1,
    held: false,
    reduced: false,
    span() {
      return (pill.width - PAD * 2) / COUNT;
    },
    edges(i) {
      const w = pill.span();
      return [PAD + i * w, PAD + (i + 1) * w];
    },
    write() {
      if (!pill.el || !pill.width) return;
      const s = pill.s;
      pill.el.style.clipPath = `inset(${(PAD + s).toFixed(2)}px ${(pill.width - pill.r + s).toFixed(2)}px ${(PAD + s).toFixed(2)}px ${(pill.l + s).toFixed(2)}px round 999px)`;
    },
    to(i, instant) {
      pill.at = i;
      const [l, r] = pill.edges(i);
      const from = (pill.l + pill.r) / 2;
      const next = (l + r) / 2;
      if (Math.abs(next - from) > 0.5) pill.dir = next > from ? 1 : -1;
      pill.tl = l;
      pill.tr = r;
      if (instant || pill.reduced) {
        pill.l = l;
        pill.r = r;
        pill.vl = 0;
        pill.vr = 0;
        pill.write();
        return;
      }
      wake(pill);
    },
    squeeze(on) {
      pill.ts = on ? 2 : 0;
      if (pill.reduced) {
        pill.s = pill.ts;
        pill.write();
        return;
      }
      wake(pill);
    },
    hold(l, r, v) {
      pill.held = true;
      pill.l = l;
      pill.r = r;
      pill.vl = v;
      pill.vr = v;
      pill.write();
      wake(pill);
    },
    release(v) {
      pill.held = false;
      pill.vl = v;
      pill.vr = v;
    },
    attach(el) {
      pill.el = el;
      pill.write();
    },
    setReduced(on) {
      pill.reduced = on;
    },
    resize(width) {
      if (!width || width === pill.width) return;
      pill.width = width;
      if (!pill.held) pill.to(pill.at, true);
    },
    step(dt) {
      const sl = pill.dir > 0 ? TRAIL : LEAD;
      const sr = pill.dir > 0 ? LEAD : TRAIL;
      let t = 0;
      while (t < dt) {
        const h = Math.min(SUB, dt - t);
        t += h;
        if (!pill.held) {
          pill.vl += (-sl.k * (pill.l - pill.tl) - sl.c * pill.vl) * h;
          pill.l += pill.vl * h;
          pill.vr += (-sr.k * (pill.r - pill.tr) - sr.c * pill.vr) * h;
          pill.r += pill.vr * h;
        }
        pill.vs += (-SQUEEZE.k * (pill.s - pill.ts) - SQUEEZE.c * pill.vs) * h;
        pill.s += pill.vs * h;
      }
      const settledEdges =
        pill.held ||
        (Math.abs(pill.l - pill.tl) < 0.05 &&
          Math.abs(pill.r - pill.tr) < 0.05 &&
          Math.abs(pill.vl) < 0.5 &&
          Math.abs(pill.vr) < 0.5);
      const settledSqueeze =
        Math.abs(pill.s - pill.ts) < 0.01 && Math.abs(pill.vs) < 0.1;
      if (settledEdges && !pill.held) {
        pill.l = pill.tl;
        pill.r = pill.tr;
        pill.vl = 0;
        pill.vr = 0;
      }
      if (settledSqueeze) {
        pill.s = pill.ts;
        pill.vs = 0;
      }
      pill.write();
      return !settledSqueeze || (!pill.held && !settledEdges);
    },
  };
  return pill;
}

function Bar({ chords, n, last, repeat }) {
  return (
    <li className="clip-tabs__bar" data-last={last || undefined}>
      <span className="clip-tabs__bar-n">{n}</span>
      <span className="clip-tabs__chords">
        {chords.map((chord, i) => (
          <span key={i} className="clip-tabs__chord">
            {chord}
          </span>
        ))}
      </span>
      {repeat > 0 && <span className="clip-tabs__repeat">×{repeat}</span>}
    </li>
  );
}

export default function Piece({ embedded = false }) {
  const [index, setIndex] = useState(1);
  const [pill] = useState(createPill);
  const railRef = useRef(null);
  const tabsRef = useRef([]);
  const drag = useRef(null);
  const swallow = useRef(0);

  useLayoutEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    pill.setReduced(query.matches);
    const onMotion = () => pill.setReduced(query.matches);
    query.addEventListener("change", onMotion);
    const measure = () => pill.resize(rail.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(rail);
    return () => {
      observer.disconnect();
      query.removeEventListener("change", onMotion);
      sleep(pill);
    };
  }, [pill]);

  const select = (i, focus) => {
    const next = Math.max(0, Math.min(COUNT - 1, i));
    pill.to(next, false);
    setIndex(next);
    if (focus) tabsRef.current[next]?.focus();
  };

  const onPointerDown = (e) => {
    if (e.button !== 0 || !pill.width) return;
    const rect = railRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    if (x < pill.l || x > pill.r) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = {
      id: e.pointerId,
      left: rect.left,
      grab: x - (pill.l + pill.r) / 2,
      startX: e.clientX,
      moved: false,
      lastX: e.clientX,
      lastT: e.timeStamp,
      v: 0,
      centre: (pill.l + pill.r) / 2,
    };
    pill.squeeze(true);
  };

  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    if (!d.moved) {
      if (Math.abs(e.clientX - d.startX) < 3) return;
      d.moved = true;
      railRef.current.dataset.dragging = "";
    }
    const dt = Math.max(1, e.timeStamp - d.lastT);
    const inst = ((e.clientX - d.lastX) / dt) * 1000;
    d.v = d.v * 0.3 + inst * 0.7;
    d.lastX = e.clientX;
    d.lastT = e.timeStamp;
    const span = pill.span();
    const min = PAD + span / 2;
    const max = pill.width - PAD - span / 2;
    const raw = e.clientX - d.left - d.grab;
    const centre = Math.max(min, Math.min(max, raw));
    const press =
      raw < min
        ? rubber(raw - min, span) * 0.36
        : raw > max
          ? rubber(raw - max, span) * 0.36
          : 0;
    d.centre = raw;
    pill.hold(
      centre - span / 2 + Math.max(0, press),
      centre + span / 2 + Math.min(0, press),
      d.v,
    );
  };

  const finish = (e) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    delete railRef.current.dataset.dragging;
    pill.squeeze(false);
    const recent = d.moved && e.timeStamp - d.lastT < 80 ? d.v : 0;
    pill.release(recent);
    if (!d.moved) return;
    swallow.current = e.timeStamp + 400;
    const projected = d.centre + (recent / 1000) * (0.99 / 0.01);
    const span = pill.span();
    select(Math.round((projected - PAD - span / 2) / span), true);
  };

  const onClick = (i) => (e) => {
    if (e.timeStamp < swallow.current) return;
    select(i, false);
  };

  const onKeyDown = (e) => {
    const map = {
      ArrowRight: index + 1,
      ArrowLeft: index - 1,
      Home: 0,
      End: COUNT - 1,
    };
    if (!(e.key in map)) return;
    e.preventDefault();
    select(map[e.key], true);
  };

  const section = SECTIONS[index];
  const bars = section.bars;

  return (
    <div className="clip-tabs" data-embedded={embedded || undefined}>
      {!embedded && <h1 className="clip-tabs__title">Chart</h1>}
      <header className="clip-tabs__song">
        <h2 className="clip-tabs__song-name">{SONG.title}</h2>
        <p className="clip-tabs__song-meta">
          {SONG.artist} · {SONG.key} ·{" "}
          <span className="clip-tabs__num">{SONG.bpm}</span> bpm · {SONG.meter}
        </p>
      </header>

      <div
        className="clip-tabs__rail"
        ref={railRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finish}
        onPointerCancel={finish}
        style={{ "--clip-tabs-at": index }}
      >
        <div
          className="clip-tabs__row"
          role="tablist"
          aria-label="Sections"
          onKeyDown={onKeyDown}
        >
          {SECTIONS.map((s, i) => (
            <button
              key={s.id}
              ref={(el) => {
                tabsRef.current[i] = el;
              }}
              id={`clip-tabs-tab-${s.id}`}
              type="button"
              role="tab"
              aria-selected={i === index}
              aria-controls="clip-tabs-panel"
              tabIndex={i === index ? 0 : -1}
              className="clip-tabs__tab"
              onClick={onClick(i)}
            >
              {s.name}
            </button>
          ))}
        </div>
        <div
          className="clip-tabs__row clip-tabs__row--ink"
          ref={(el) => pill.attach(el)}
          aria-hidden="true"
        >
          {SECTIONS.map((s) => (
            <span key={s.id} className="clip-tabs__tab">
              {s.name}
            </span>
          ))}
        </div>
      </div>

      <section
        id="clip-tabs-panel"
        className="clip-tabs__panel"
        role="tabpanel"
        aria-labelledby={`clip-tabs-tab-${section.id}`}
        data-scroll-contain
      >
        <div key={section.id} className="clip-tabs__chart">
          <div className="clip-tabs__section">
            <h3 className="clip-tabs__section-name">{section.name}</h3>
            <p className="clip-tabs__section-meta">
              <span className="clip-tabs__num">{bars.length}</span> bars ·{" "}
              <span className="clip-tabs__num">{length(section)}</span>
              {section.plays > 1 ? " · plays twice" : ""}
            </p>
          </div>
          <ol className="clip-tabs__bars">
            {bars.map((chords, i) => (
              <Bar
                key={i}
                chords={chords}
                n={i + 1}
                last={i === bars.length - 1}
                repeat={
                  i === bars.length - 1 && section.plays > 1 ? section.plays : 0
                }
              />
            ))}
          </ol>
        </div>
      </section>
    </div>
  );
}
