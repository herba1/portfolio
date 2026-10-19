"use client";

import { useEffect, useRef, useState } from "react";

import { SLEEVES, START_INDEX } from "./crateSleeves";
import { createFoley } from "./crateSound";
import "./crate.css";

const N = SLEEVES.length;
const LABEL =
  "A crate of Beatles records. Drag down or scroll to flip sleeves forward, drag up to flip back. Tap the front sleeve to pull its record out. Arrow keys flip, Enter pulls the record, Escape puts it back.";

const pad = (n) => String(n).padStart(2, "0");
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const ease = (t) => 1 - Math.pow(1 - t, 3);
const mix = (a, b, t) => a + (b - a) * t;

const STIFF = 210;
const DAMP = 2 * Math.sqrt(STIFF) * 0.94;
const LIFT_STIFF = 160;
const LIFT_DAMP = 2 * Math.sqrt(LIFT_STIFF) * 0.96;
const LEAN = 7;
const FALL = 74;
const BEHIND = 7;
const FRONT = 1.05;

function Vinyl({ sleeve }) {
  return (
    <div className="crate__vinyl" aria-hidden="true">
      <div
        className="crate__label"
        style={{ "--crate-label-paper": sleeve.label.paper, "--crate-label-ink": sleeve.label.ink }}
      >
        <span className="crate__label-title">{sleeve.short}</span>
        <span className="crate__label-meta">{sleeve.artist}</span>
        <span className="crate__label-hole" />
      </div>
    </div>
  );
}

function Back() {
  return <div className="crate__back" aria-hidden="true" />;
}

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const binRef = useRef(null);
  const sleeveRefs = useRef([]);
  const apiRef = useRef(null);
  const [index, setIndex] = useState(START_INDEX);
  const [lifted, setLifted] = useState(false);

  useEffect(() => {
    const root = rootRef.current;
    const bin = binRef.current;
    if (!root || !bin) return undefined;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const foley = createFoley();
    const s = {
      pos: START_INDEX,
      vel: 0,
      target: START_INDEX,
      lift: 0,
      liftVel: 0,
      liftTarget: 0,
      liftIndex: START_INDEX,
      drag: null,
      raf: 0,
      last: 0,
      shownIndex: START_INDEX,
      shownLift: false,
      wheel: 0,
      wheelAt: 0,
      visible: true,
    };

    const render = () => {
      const lift = ease(clamp(s.lift, 0, 1.1));
      for (let i = 0; i < N; i += 1) {
        const el = sleeveRefs.current[i];
        if (!el) continue;
        const d = i - s.pos;
        if (d > BEHIND || d < -FRONT) {
          if (el.dataset.hidden === undefined) el.dataset.hidden = "";
          continue;
        }
        if (el.dataset.hidden !== undefined) delete el.dataset.hidden;
        let angle;
        let z;
        let y;
        let ly = 0;
        let fade = 1;
        if (d >= 0) {
          angle = -LEAN;
          z = -d * 26;
          y = -d * 9;
          fade = clamp(BEHIND - d, 0, 1);
        } else {
          const t = Math.min(1, -d);
          const e = t * t * (3 - 2 * t);
          angle = mix(-LEAN, FALL, e) + Math.max(0, -d - 1) * 4;
          z = -d * 8;
          y = 0;
          ly = -e * 0.05;
          fade = clamp((1 + d) / 0.45, 0, 1);
        }
        let x = 0;
        let vinyl = 0;
        if (i === s.liftIndex && lift > 0.001) {
          const l = lift * clamp(1 - Math.abs(d) * 2, 0, 1);
          ly = l * 0.1;
          x = -l;
          angle = mix(angle, 0, l);
          z += l * 24;
          vinyl = l;
        }
        el.style.transform = `translate3d(calc(${x.toFixed(4)} * var(--crate-shift)), calc(${y.toFixed(2)}px - ${ly.toFixed(4)} * var(--crate-size)), ${z.toFixed(2)}px) rotateX(${(-angle).toFixed(3)}deg)`;
        el.style.setProperty("--crate-fade", fade.toFixed(3));
        el.style.setProperty("--crate-out", vinyl.toFixed(4));
      }
      const current = clamp(Math.round(s.pos), 0, N - 1);
      if (current !== s.shownIndex) {
        s.shownIndex = current;
        setIndex(current);
      }
      const isLifted = s.liftTarget > 0.5;
      if (isLifted !== s.shownLift) {
        s.shownLift = isLifted;
        setLifted(isLifted);
      }
    };

    const frame = (now) => {
      s.raf = 0;
      const dt = s.last ? Math.min(1 / 30, (now - s.last) / 1000) : 1 / 60;
      s.last = now;
      const before = Math.round(s.pos);
      if (!s.drag) {
        if (reduced) {
          s.pos = s.target;
          s.vel = 0;
        } else {
          const steps = 4;
          for (let k = 0; k < steps; k += 1) {
            const h = dt / steps;
            s.vel += (STIFF * (s.target - s.pos) - DAMP * s.vel) * h;
            s.pos += s.vel * h;
          }
        }
      }
      if (reduced) {
        s.lift = s.liftTarget;
        s.liftVel = 0;
      } else {
        const steps = 4;
        for (let k = 0; k < steps; k += 1) {
          const h = dt / steps;
          s.liftVel += (LIFT_STIFF * (s.liftTarget - s.lift) - LIFT_DAMP * s.liftVel) * h;
          s.lift += s.liftVel * h;
        }
      }
      const after = Math.round(s.pos);
      if (after !== before) foley.flick(Math.abs(s.vel) / 8);
      const settled =
        !s.drag &&
        Math.abs(s.target - s.pos) < 0.0005 &&
        Math.abs(s.vel) < 0.002 &&
        Math.abs(s.liftTarget - s.lift) < 0.0005 &&
        Math.abs(s.liftVel) < 0.002;
      if (settled) {
        s.pos = s.target;
        s.vel = 0;
        s.lift = s.liftTarget;
        s.liftVel = 0;
      }
      render();
      if (!settled && s.visible) s.raf = requestAnimationFrame(frame);
    };

    const wake = () => {
      if (s.raf || !s.visible) return;
      s.last = 0;
      s.raf = requestAnimationFrame(frame);
    };

    const drop = () => {
      if (s.liftTarget === 0) return false;
      s.liftTarget = 0;
      foley.slide(false);
      wake();
      return true;
    };

    const go = (i) => {
      const next = clamp(i, 0, N - 1);
      if (s.liftTarget > 0 && next !== s.liftIndex) drop();
      s.target = next;
      wake();
    };

    const toggleLift = () => {
      const current = clamp(Math.round(s.target), 0, N - 1);
      if (s.liftTarget > 0 && s.liftIndex === current) {
        drop();
        return;
      }
      s.target = current;
      s.liftIndex = current;
      s.liftTarget = 1;
      foley.slide(true);
      wake();
    };

    const stepPx = () => Math.max(56, Math.min(110, bin.clientHeight * 0.14));

    const onDown = (e) => {
      if (e.button > 0 || s.drag) return;
      foley.unlock();
      bin.setPointerCapture?.(e.pointerId);
      const hit = e.target.closest?.("[data-sleeve]");
      s.drag = {
        id: e.pointerId,
        y0: e.clientY,
        x0: e.clientX,
        pos0: s.pos,
        moved: 0,
        t0: performance.now(),
        lastY: e.clientY,
        lastT: performance.now(),
        v: 0,
        hit: hit ? Number(hit.dataset.sleeve) : -1,
        engaged: false,
      };
      s.vel = 0;
      root.setAttribute("data-grabbing", "");
    };

    const onMove = (e) => {
      const g = s.drag;
      if (!g || g.id !== e.pointerId) return;
      const dy = e.clientY - g.y0;
      g.moved = Math.max(g.moved, Math.hypot(e.clientX - g.x0, dy));
      const now = performance.now();
      const dtm = Math.max(1, now - g.lastT);
      const inst = ((e.clientY - g.lastY) / dtm) * 1000;
      g.v = g.v * 0.6 + inst * 0.4;
      g.lastY = e.clientY;
      g.lastT = now;
      if (!g.engaged && g.moved > 6) {
        g.engaged = true;
        if (s.liftTarget > 0) drop();
        g.y0 = e.clientY;
        g.pos0 = s.pos;
        return;
      }
      if (!g.engaged) return;
      let p = g.pos0 + (e.clientY - g.y0) / stepPx();
      if (p < 0) p = -0.35 * (1 - Math.exp(p / 0.35));
      if (p > N - 1) p = N - 1 + 0.35 * (1 - Math.exp(-(p - (N - 1)) / 0.35));
      s.pos = p;
      s.target = p;
      wake();
    };

    const onUp = (e) => {
      const g = s.drag;
      if (!g || g.id !== e.pointerId) return;
      s.drag = null;
      root.removeAttribute("data-grabbing");
      const quick = performance.now() - g.t0 < 400;
      if (!g.engaged && e.type === "pointerup") {
        if (g.hit >= 0) {
          const current = clamp(Math.round(s.target), 0, N - 1);
          if (g.hit === current && quick) toggleLift();
          else if (g.hit !== current) go(g.hit);
        } else drop();
        wake();
        return;
      }
      const fresh = performance.now() - g.lastT < 80;
      const v = fresh ? g.v / stepPx() : 0;
      s.vel = clamp(v, -14, 14);
      const projected = s.pos + clamp(s.vel * 0.12, -3, 3);
      s.target = clamp(Math.round(projected), 0, N - 1);
      wake();
    };

    const onWheel = (e) => {
      if (embedded) return;
      e.preventDefault();
      const now = performance.now();
      if (now - s.wheelAt > 220) s.wheel = 0;
      s.wheelAt = now;
      s.wheel += e.deltaY;
      if (Math.abs(s.wheel) >= 40) {
        const dir = Math.sign(s.wheel);
        s.wheel = 0;
        foley.unlock();
        go(Math.round(s.target) + dir);
      }
    };

    const io = new IntersectionObserver(([entry]) => {
      s.visible = entry.isIntersecting;
      if (s.visible) wake();
    });
    io.observe(root);

    bin.addEventListener("pointerdown", onDown);
    bin.addEventListener("pointermove", onMove);
    bin.addEventListener("pointerup", onUp);
    bin.addEventListener("pointercancel", onUp);
    bin.addEventListener("lostpointercapture", onUp);
    bin.addEventListener("wheel", onWheel, { passive: false });

    apiRef.current = {
      step: (dir) => go(Math.round(s.target) + dir),
      go,
      toggleLift: () => {
        foley.unlock();
        toggleLift();
      },
      drop,
    };
    render();
    root.setAttribute("data-ready", "");

    return () => {
      if (s.raf) cancelAnimationFrame(s.raf);
      io.disconnect();
      bin.removeEventListener("pointerdown", onDown);
      bin.removeEventListener("pointermove", onMove);
      bin.removeEventListener("pointerup", onUp);
      bin.removeEventListener("pointercancel", onUp);
      bin.removeEventListener("lostpointercapture", onUp);
      bin.removeEventListener("wheel", onWheel);
      foley.destroy();
      apiRef.current = null;
    };
  }, [embedded]);

  const onKeyDown = (e) => {
    const api = apiRef.current;
    if (!api) return;
    if (e.key === "ArrowDown" || e.key === "ArrowRight") api.step(1);
    else if (e.key === "ArrowUp" || e.key === "ArrowLeft") api.step(-1);
    else if (e.key === "Home") api.go(0);
    else if (e.key === "End") api.go(N - 1);
    else if (e.key === "Enter" || e.key === " ") api.toggleLift();
    else if (e.key === "Escape") api.drop();
    else return;
    e.preventDefault();
  };

  const sleeve = SLEEVES[index];

  return (
    <div
      ref={rootRef}
      className="crate"
      data-embedded={embedded || undefined}
      data-lifted={lifted ? "" : undefined}
    >
      {!embedded && (
        <header className="crate__head">
          <h1 className="crate__title">Crate</h1>
          <p className="crate__hint">Drag to dig. Tap a sleeve to pull the record.</p>
        </header>
      )}
      <div
        ref={binRef}
        className="crate__bin"
        tabIndex={0}
        role="application"
        aria-label={LABEL}
        onKeyDown={onKeyDown}
      >
        <div className="crate__floor" aria-hidden="true" />
        <div className="crate__scene">
          {SLEEVES.map((s, i) => (
            <div
              key={s.id}
              ref={(el) => {
                sleeveRefs.current[i] = el;
              }}
              className="crate__sleeve"
              data-sleeve={i}
              data-hidden=""
            >
              <Vinyl sleeve={s} />
              <div className="crate__front">
                <img src={s.src} alt="" draggable="false" decoding="async" />
              </div>
              <Back />
            </div>
          ))}
        </div>
      </div>
      <div className="crate__now" aria-live="polite">
        <p className="crate__now-title">{sleeve.title}</p>
        <p className="crate__now-meta">
          <span>
            {sleeve.artist}, {sleeve.year}
          </span>
          <span className="crate__now-count">
            {pad(index + 1)} / {pad(N)}
          </span>
        </p>
      </div>
    </div>
  );
}
