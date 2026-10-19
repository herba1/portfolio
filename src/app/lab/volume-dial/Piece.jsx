"use client";

import { useEffect, useRef, useState } from "react";
import { Volume, Volume1, Volume2, VolumeX } from "lucide-react";

import { albumById } from "@/app/lab/_music/catalog";

import { createClicker } from "./dialAudio";
import "./volume-dial.css";

const ALBUM = albumById("abbey-road");
const TRACK = "Here Comes the Sun";
const START = 64;
const SWEEP = 270;
const TICKS = Array.from({ length: 51 }, (_, i) => i * 2);
const KNURLS = Array.from({ length: 96 }, (_, i) => i * 3.75);
const C = 200;
const R_GRIP_IN = 124;
const R_GRIP_OUT = 150;
const R_IN = 164;
const R_OUT = 178;
const R_MAJOR = 186;
const OVERSHOOT = 6;

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
  if (raw > 100) return 100 + Math.tanh((raw - 100) / 6) * 2.4;
  if (raw < 0) return Math.tanh(raw / 6) * 2.4;
  return detent(raw);
}

const LIT = [20, 20, 19];
const DIM = [214, 212, 206];
const mix = (a, b, t) => `rgb(${a.map((x, i) => Math.round(x + (b[i] - x) * t)).join(",")})`;

function LevelIcon({ value }) {
  const props = { size: 24, strokeWidth: 2, "aria-hidden": true, className: "volume-dial-icon" };
  if (value === 0) return <VolumeX {...props} />;
  if (value < 34) return <Volume {...props} />;
  if (value < 67) return <Volume1 {...props} />;
  return <Volume2 {...props} />;
}

export default function Piece({ embedded = false }) {
  const dialRef = useRef(null);
  const gripRef = useRef(null);
  const coverRef = useRef(null);
  const rippleRef = useRef(null);
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
      peakAnims: [],
    };

    const peak = () => {
      if (reduce) return;
      st.peakAnims.forEach((a) => a.cancel());
      st.peakAnims = [
        coverRef.current.animate(
          [{ transform: "scale(1)" }, { transform: "scale(1.045)", offset: 0.28 }, { transform: "scale(1)" }],
          { duration: 520, easing: "cubic-bezier(.22, 1, .36, 1)" },
        ),
        rippleRef.current.animate(
          [
            { transform: "scale(0.98)", opacity: 0.6 },
            { transform: "scale(1.12)", opacity: 0.32, offset: 0.45 },
            { transform: "scale(1.22)", opacity: 0 },
          ],
          { duration: 900, easing: "cubic-bezier(.25, .46, .45, .94)" },
        ),
      ];
    };

    const clickFor = (step, fromDrag) => {
      if (step === st.detentAt) return;
      const major = step % 10 === 0;
      clicker.tick(major ? 0.9 : 0.3, step === 100 ? 1.4 : 1);
      if (major && fromDrag && navigator.vibrate) navigator.vibrate(4);
      if (step === 100 && st.detentAt !== 100) peak();
      st.detentAt = step;
    };

    const setTarget = (raw, fromDrag) => {
      st.raw = fromDrag ? clamp(raw, -OVERSHOOT, 100 + OVERSHOOT) : clamp(raw, 0, 100);
      st.target = fromDrag ? rubber(st.raw) : clamp(detent(st.raw), 0, 100);
      clickFor(clamp(Math.round(st.target), 0, 100), fromDrag);
      kick();
    };

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
      st.raw = clamp(st.target, 0, 100);
      if (e.pointerType !== "mouse") st.pointer = [x, y];
      kick();
    };
    const onMove = (e) => {
      const [x, y] = local(e);
      if (e.pointerType === "mouse" || st.drag) st.pointer = [x, y];
      if (st.drag && e.pointerId === st.drag.id) {
        const a = angleOf(x, y);
        let d = a - st.drag.angle;
        if (d > 180) d -= 360;
        if (d < -180) d += 360;
        st.drag.angle = a;
        st.drag.moved += Math.hypot(x - st.drag.x, y - st.drag.y);
        st.drag.x = x;
        st.drag.y = y;
        if (Math.hypot(x - C, y - C) > 32) setTarget(st.raw + d / (SWEEP / 100), true);
      }
      kick();
    };
    const finish = (e, commit) => {
      if (!st.drag || e.pointerId !== st.drag.id) return;
      const [x, y] = local(e);
      const dist = Math.hypot(x - C, y - C);
      const tapped = commit && st.drag.moved < 4 && dist > R_GRIP_OUT;
      const a = angleOf(x, y);
      if (tapped && Math.abs(a) <= SWEEP / 2 + 6) {
        setTarget(((a + SWEEP / 2) / SWEEP) * 100, false);
      } else {
        setTarget(st.target, false);
      }
      st.drag = null;
      if (e.pointerType !== "mouse") st.pointer = null;
      delete dial.dataset.dragging;
      kick();
    };
    const onUp = (e) => finish(e, true);
    const onCancel = (e) => finish(e, false);
    const onLeave = (e) => {
      if (st.drag) return;
      if (e.pointerType === "mouse") st.pointer = null;
      kick();
    };
    const onWheel = (e) => {
      e.preventDefault();
      clicker.wake();
      const unit = e.deltaMode === 1 ? 16 : 1;
      setTarget(clamp(st.target, 0, 100) - e.deltaY * unit * 0.04, false);
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
      clickFor(next, false);
      kick();
    };

    const render = (dt) => {
      const k = reduce ? 1400 : 420;
      const damp = reduce ? 75 : 38;
      const n = Math.max(1, Math.ceil(dt * 240));
      for (let s = 0; s < n; s += 1) {
        const a = k * (st.target - st.value) - damp * st.vel;
        st.vel += (a * dt) / n;
        st.value += (st.vel * dt) / n;
      }
      const v = st.value;
      const angle = toAngle(v);
      gripRef.current.setAttribute("transform", `rotate(${angle.toFixed(3)} ${C} ${C})`);
      const level = clamp(v / 100, 0, 1);
      coverRef.current.style.setProperty("--sat", (0.2 + level * 0.8).toFixed(3));

      const p = st.pointer;
      let busy = Math.abs(st.target - st.value) > 0.005 || Math.abs(st.vel) > 0.01;
      TICKS.forEach((tv, i) => {
        let want = 0;
        if (p) {
          const [tx, ty] = polar(toAngle(tv), (R_IN + R_OUT) / 2);
          const d = Math.hypot(p[0] - tx, p[1] - ty);
          want = Math.exp(-(d * d) / (2 * 40 * 40));
        }
        const pr = st.prox[i] + (want - st.prox[i]) * Math.min(1, dt * 16);
        if (Math.abs(pr - want) > 0.002) busy = true;
        const lit = clamp(v - tv + 1, 0, 1);
        if (Math.abs(pr - st.prox[i]) < 0.0005 && Math.abs(lit - st.lit[i]) < 0.002) return;
        st.prox[i] = pr;
        st.lit[i] = lit;
        const major = tv % 10 === 0;
        const deg = toAngle(tv);
        const [x1, y1] = polar(deg, R_IN - pr * 4);
        const [x2, y2] = polar(deg, (major ? R_MAJOR : R_OUT) + pr * 12);
        const el = tickRefs.current[i];
        el.setAttribute("x1", x1.toFixed(2));
        el.setAttribute("y1", y1.toFixed(2));
        el.setAttribute("x2", x2.toFixed(2));
        el.setAttribute("y2", y2.toFixed(2));
        el.setAttribute("stroke", mix(DIM, LIT, Math.max(lit, pr * 0.45)));
        el.setAttribute("stroke-width", ((major ? 3.5 : 2.5) + pr * 1).toFixed(2));
      });

      const step = clamp(Math.round(st.target), 0, 100);
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
    dial.addEventListener("pointercancel", onCancel);
    root.addEventListener("pointerleave", onLeave);
    dial.addEventListener("wheel", onWheel, { passive: false });
    dial.addEventListener("keydown", onKey);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelAnimationFrame(st.raf);
      st.peakAnims.forEach((a) => a.cancel());
      dial.removeEventListener("pointerdown", onDown);
      root.removeEventListener("pointermove", onMove);
      dial.removeEventListener("pointerup", onUp);
      dial.removeEventListener("pointercancel", onCancel);
      root.removeEventListener("pointerleave", onLeave);
      dial.removeEventListener("wheel", onWheel);
      dial.removeEventListener("keydown", onKey);
      document.removeEventListener("visibilitychange", onVis);
      clicker.destroy();
    };
  }, []);

  const Root = embedded ? "div" : "main";

  return (
    <Root
      ref={rootRef}
      className="volume-dial"
      data-embedded={embedded ? "" : undefined}
      data-max={shown === 100 ? "" : undefined}
      data-muted={shown === 0 ? "" : undefined}
    >
      {embedded ? null : (
        <header className="volume-dial-head">
          <h1 className="volume-dial-title">Volume Dial</h1>
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
          aria-label={`Volume, ${TRACK}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={shown}
          aria-valuetext={shown === 0 ? "Muted" : `${shown} percent`}
        >
          <svg className="volume-dial-ring" viewBox="0 0 400 400" aria-hidden="true">
            {TICKS.map((tv, i) => (
              <line key={tv} ref={(el) => (tickRefs.current[i] = el)} strokeLinecap="round" />
            ))}
            <g ref={gripRef}>
              <circle className="volume-dial-grip" cx={C} cy={C} r={(R_GRIP_IN + R_GRIP_OUT) / 2} strokeWidth={R_GRIP_OUT - R_GRIP_IN} />
              {KNURLS.map((deg) => {
                const [x1, y1] = polar(deg, R_GRIP_IN + 7);
                const [x2, y2] = polar(deg, R_GRIP_OUT - 5);
                return <line key={deg} className="volume-dial-knurl" x1={x1.toFixed(2)} y1={y1.toFixed(2)} x2={x2.toFixed(2)} y2={y2.toFixed(2)} />;
              })}
              <line className="volume-dial-notch" x1={C} y1={C - R_GRIP_OUT + 5} x2={C} y2={C - R_GRIP_IN - 4} strokeLinecap="round" />
            </g>
          </svg>
          <div className="volume-dial-cover" ref={coverRef}>
            <img src={ALBUM.cover} alt={`${ALBUM.title} cover`} draggable={false} />
          </div>
          <span ref={rippleRef} className="volume-dial-ripple" aria-hidden="true" />
          <LevelIcon value={shown} />
        </div>

        <div className="volume-dial-readout" aria-hidden="true">
          <span className="volume-dial-number">{shown}</span>
        </div>
      </section>
    </Root>
  );
}
