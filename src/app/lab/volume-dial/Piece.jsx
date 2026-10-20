"use client";

import { useEffect, useRef, useState } from "react";

import { albumById } from "@/app/lab/_music/catalog";

import Roll from "./Roll";
import { createClicker } from "./dialAudio";
import "./volume-dial.css";

const ALBUM = albumById("abbey-road");
const TRACK = "Here Comes the Sun";
const START = 64;
const SWEEP = 270;
const TICKS = Array.from({ length: 51 }, (_, i) => i * 2);
const C = 200;
const R_IN = 166;
const R_OUT = 178;
const R_MAJOR = 186;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const toAngle = (v) => -SWEEP / 2 + (v / 100) * SWEEP;
const polar = (deg, r) => {
  const a = ((deg - 90) * Math.PI) / 180;
  return [C + Math.cos(a) * r, C + Math.sin(a) * r];
};

function detent(raw) {
  const m = Math.round(raw / 10) * 10;
  if (Math.abs(raw - m) < 1.4) return m;
  return Math.round(raw);
}

function rubber(raw) {
  if (raw > 100) return 100 + Math.tanh((raw - 100) / 10) * 3;
  if (raw < 0) return Math.tanh(raw / 10) * 3;
  return raw;
}

const LIT = [244, 244, 242];
const DIM = [58, 58, 60];
const mix = (a, b, t) => `rgb(${a.map((x, i) => Math.round(x + (b[i] - x) * t)).join(",")})`;

export default function Piece({ embedded = false }) {
  const dialRef = useRef(null);
  const knobRef = useRef(null);
  const coverRef = useRef(null);
  const needleRef = useRef(null);
  const bloomRef = useRef(null);
  const tickRefs = useRef([]);
  const rootRef = useRef(null);
  const [shown, setShown] = useState(START);

  useEffect(() => {
    const dial = dialRef.current;
    const root = rootRef.current;
    if (!dial || !root) return undefined;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const clicker = createClicker();
    const st = {
      raw: START,
      target: START,
      value: START,
      vel: 0,
      shown: START,
      detentAt: START,
      drag: null,
      pointer: null,
      prox: TICKS.map(() => 0),
      lit: TICKS.map(() => -1),
      raf: 0,
      last: performance.now(),
      visible: true,
    };

    const setTarget = (raw, fromDrag) => {
      st.raw = raw;
      const next = fromDrag ? rubber(detentFree(raw)) : clamp(detent(raw), 0, 100);
      st.target = next;
      const step = clamp(Math.round(next), 0, 100);
      if (step !== st.detentAt) {
        const major = step % 10 === 0;
        clicker.tick(major ? 0.9 : 0.3, step === 100 ? 1.4 : 1);
        if (major && navigator.vibrate && fromDrag) navigator.vibrate(4);
        st.detentAt = step;
      }
      kick();
    };

    function detentFree(raw) {
      if (raw > 100 || raw < 0) return raw;
      return detent(raw);
    }

    const local = (e) => {
      const r = dial.getBoundingClientRect();
      const s = 400 / r.width;
      return [(e.clientX - r.left) * s, (e.clientY - r.top) * s];
    };
    const angleOf = (x, y) => (Math.atan2(x - C, -(y - C)) * 180) / Math.PI;

    const onDown = (e) => {
      if (e.button !== 0) return;
      clicker.wake();
      const [x, y] = local(e);
      dial.setPointerCapture(e.pointerId);
      st.drag = { id: e.pointerId, angle: angleOf(x, y), x, y, moved: 0 };
      dial.dataset.dragging = "";
      st.raw = clamp(st.raw, 0, 100);
      kick();
    };
    const onMove = (e) => {
      const [x, y] = local(e);
      st.pointer = [x, y];
      if (st.drag && e.pointerId === st.drag.id) {
        const a = angleOf(x, y);
        let d = a - st.drag.angle;
        if (d > 180) d -= 360;
        if (d < -180) d += 360;
        st.drag.angle = a;
        st.drag.moved += Math.hypot(x - st.drag.x, y - st.drag.y);
        st.drag.x = x;
        st.drag.y = y;
        if (Math.hypot(x - C, y - C) > 24) setTarget(st.raw + d / (SWEEP / 100), true);
      }
      kick();
    };
    const onUp = (e) => {
      if (!st.drag || e.pointerId !== st.drag.id) return;
      const [x, y] = local(e);
      const dist = Math.hypot(x - C, y - C);
      if (st.drag.moved < 4 && dist > 140) {
        const a = angleOf(x, y);
        if (Math.abs(a) <= SWEEP / 2 + 4) setTarget(clamp(((a + SWEEP / 2) / SWEEP) * 100, 0, 100), false);
      } else {
        setTarget(clamp(st.raw, 0, 100), false);
      }
      st.drag = null;
      delete dial.dataset.dragging;
    };
    const onLeave = () => {
      st.pointer = null;
      kick();
    };
    const onWheel = (e) => {
      e.preventDefault();
      clicker.wake();
      const base = clamp(st.raw, 0, 100);
      setTarget(clamp(base - e.deltaY * 0.04, 0, 100), false);
    };
    const onKey = (e) => {
      const base = Math.round(clamp(st.target, 0, 100));
      const big = e.shiftKey ? 10 : 1;
      let next = null;
      if (e.key === "ArrowUp" || e.key === "ArrowRight") next = base + big;
      if (e.key === "ArrowDown" || e.key === "ArrowLeft") next = base - big;
      if (e.key === "PageUp") next = base + 10;
      if (e.key === "PageDown") next = base - 10;
      if (e.key === "Home") next = 0;
      if (e.key === "End") next = 100;
      if (next == null) return;
      e.preventDefault();
      clicker.wake();
      next = clamp(next, 0, 100);
      st.raw = next;
      st.target = next;
      if (next !== st.detentAt) {
        clicker.tick(next % 10 === 0 ? 0.9 : 0.3, next === 100 ? 1.4 : 1);
        st.detentAt = next;
      }
      kick();
    };

    const render = (dt) => {
      const k = reduce ? 900 : 320;
      const damp = reduce ? 60 : 31;
      const n = Math.max(1, Math.ceil(dt * 240));
      for (let s = 0; s < n; s += 1) {
        const a = k * (st.target - st.value) - damp * st.vel;
        st.vel += (a * dt) / n;
        st.value += (st.vel * dt) / n;
      }
      const v = st.value;
      const angle = toAngle(v);
      knobRef.current.style.transform = `rotate(${angle}deg)`;
      const level = clamp(v / 100, 0, 1);
      coverRef.current.style.filter = `saturate(${0.12 + level * 0.98}) brightness(${0.72 + level * 0.32})`;
      bloomRef.current.style.setProperty("--level", (0.08 + Math.pow(level, 2.2) * 0.72).toFixed(3));
      const [nx1, ny1] = polar(angle, R_IN - 10);
      const [nx2, ny2] = polar(angle, R_MAJOR + 6);
      const needle = needleRef.current;
      needle.setAttribute("x1", nx1.toFixed(2));
      needle.setAttribute("y1", ny1.toFixed(2));
      needle.setAttribute("x2", nx2.toFixed(2));
      needle.setAttribute("y2", ny2.toFixed(2));

      const p = st.pointer;
      let busy = Math.abs(st.target - st.value) > 0.01 || Math.abs(st.vel) > 0.01;
      TICKS.forEach((tv, i) => {
        let want = 0;
        if (p) {
          const [tx, ty] = polar(toAngle(tv), (R_IN + R_OUT) / 2);
          const d = Math.hypot(p[0] - tx, p[1] - ty);
          want = Math.exp(-(d * d) / (2 * 46 * 46));
        }
        const pr = st.prox[i] + (want - st.prox[i]) * Math.min(1, dt * 14);
        if (Math.abs(pr - want) > 0.002) busy = true;
        const lit = clamp((v - tv + 2) / 2, 0, 1);
        if (Math.abs(pr - st.prox[i]) < 0.0005 && Math.abs(lit - st.lit[i]) < 0.002) return;
        st.prox[i] = pr;
        st.lit[i] = lit;
        const major = tv % 10 === 0;
        const deg = toAngle(tv);
        const [x1, y1] = polar(deg, R_IN - pr * 6);
        const [x2, y2] = polar(deg, (major ? R_MAJOR : R_OUT) + pr * 16);
        const el = tickRefs.current[i];
        el.setAttribute("x1", x1.toFixed(2));
        el.setAttribute("y1", y1.toFixed(2));
        el.setAttribute("x2", x2.toFixed(2));
        el.setAttribute("y2", y2.toFixed(2));
        el.setAttribute("stroke", mix(DIM, LIT, Math.max(lit, pr * 0.55)));
        el.setAttribute("stroke-width", (major ? 3 : 2) + pr * 1.4);
      });

      const step = clamp(Math.round(v), 0, 100);
      if (step !== st.shown) {
        st.shown = step;
        setShown(step);
      }
      return busy;
    };

    const loop = (now) => {
      const dt = Math.min(0.033, (now - st.last) / 1000);
      st.last = now;
      const busy = render(dt);
      st.raf = busy && st.visible ? requestAnimationFrame(loop) : 0;
    };
    function kick() {
      if (st.raf || !st.visible) return;
      st.last = performance.now();
      st.raf = requestAnimationFrame(loop);
    }

    const onVis = () => {
      st.visible = !document.hidden;
      if (st.visible) kick();
    };

    render(0);
    kick();
    dial.addEventListener("pointerdown", onDown);
    root.addEventListener("pointermove", onMove);
    dial.addEventListener("pointerup", onUp);
    dial.addEventListener("pointercancel", onUp);
    root.addEventListener("pointerleave", onLeave);
    dial.addEventListener("wheel", onWheel, { passive: false });
    dial.addEventListener("keydown", onKey);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelAnimationFrame(st.raf);
      dial.removeEventListener("pointerdown", onDown);
      root.removeEventListener("pointermove", onMove);
      dial.removeEventListener("pointerup", onUp);
      dial.removeEventListener("pointercancel", onUp);
      root.removeEventListener("pointerleave", onLeave);
      dial.removeEventListener("wheel", onWheel);
      dial.removeEventListener("keydown", onKey);
      document.removeEventListener("visibilitychange", onVis);
      clicker.destroy();
    };
  }, []);

  const Root = embedded ? "div" : "main";
  const max = shown === 100;

  return (
    <Root
      ref={rootRef}
      className="volume-dial"
      data-embedded={embedded ? "" : undefined}
      data-max={max ? "" : undefined}
      data-muted={shown === 0 ? "" : undefined}
    >
      {embedded ? null : (
        <header className="volume-dial-head">
          <h1 className="volume-dial-title">Volume Dial</h1>
          <p className="volume-dial-hint">Turn the record. It clicks at every ten, and something happens at the top.</p>
        </header>
      )}

      <section className="volume-dial-stage">
        <div className="volume-dial-track">
          <p className="volume-dial-song">{TRACK}</p>
          <p className="volume-dial-meta">
            {ALBUM.artist} · {ALBUM.title}
          </p>
        </div>

        <div
          ref={dialRef}
          className="volume-dial-dial"
          role="slider"
          tabIndex={0}
          aria-label="Volume"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={shown}
          aria-valuetext={`${shown}%`}
        >
          <div ref={bloomRef} className="volume-dial-bloom" aria-hidden="true">
            <img src={ALBUM.cover} alt="" draggable={false} />
          </div>
          <svg className="volume-dial-ring" viewBox="0 0 400 400" aria-hidden="true">
            {TICKS.map((tv, i) => (
              <line key={tv} ref={(el) => (tickRefs.current[i] = el)} strokeLinecap="round" />
            ))}
            <line ref={needleRef} className="volume-dial-needle" strokeLinecap="round" />
          </svg>
          <div className="volume-dial-waves" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div ref={knobRef} className="volume-dial-knob">
            <img ref={coverRef} src={ALBUM.cover} alt={`${ALBUM.title} cover`} draggable={false} />
            <span className="volume-dial-notch" />
          </div>
          <span className="volume-dial-spindle" aria-hidden="true" />
        </div>

        <div className="volume-dial-readout" aria-hidden="true">
          <Roll text={String(shown)} className="volume-dial-number" />
          <span className="volume-dial-unit">%</span>
        </div>
      </section>
    </Root>
  );
}
