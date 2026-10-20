"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { useTopSongs } from "@/app/lab/_music/useTopSongs";
import { toSleeves } from "./crateSleeves";
import { createFoley } from "./crateSound";
import "./crate.css";

const LABEL =
  "A crate of records. Drag down or scroll to flip sleeves forward, drag up to flip back. Tap the front sleeve to pull its record out. Arrow keys flip, Enter pulls the record, Escape puts it back.";

const pad = (n) => String(n).padStart(2, "0");
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const ease = (t) => 1 - Math.pow(1 - t, 3);
const mix = (a, b, t) => a + (b - a) * t;

const STIFF = 210;
const DAMP = 2 * Math.sqrt(STIFF) * 0.94;
const LIFT_STIFF = 160;
const LIFT_DAMP = 2 * Math.sqrt(LIFT_STIFF) * 0.96;
const LEAN = 7;
const GAP = 0.055;
const WALL_Z = 0.8 - 0.035;
const WALL_H = 0.26 + 0.01;
const REST_STEP = 0.02;
const PIVOT = 0.05;
const PIVOT_STEP = 0.014;
const LIFT_Y = 0.34;
const DEG = 180 / Math.PI;

const jitter = (i, k) => {
  const v = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
  return (v - Math.floor(v)) * 2 - 1;
};

function place(d, i) {
  const lean = LEAN + jitter(i, 1) * 0.7;
  const x = jitter(i, 2) * 0.012;
  const twist = jitter(i, 3) * 0.6;
  if (d >= 0) return { angle: -lean, z: -d * GAP, x, twist: twist * 0.4, shade: 0 };
  const t = -d;
  const a = Math.min(1, t);
  const e = a * a * (3 - 2 * a);
  const over = Math.max(0, t - 1);
  const z = PIVOT * e + PIVOT_STEP * over;
  const rest = Math.atan2(WALL_Z - z, WALL_H + i * REST_STEP) * DEG;
  return { angle: mix(-lean, rest, e), z, x: x * (1 + e), twist: twist * (0.4 + 0.6 * e), shade: e };
}

function woodTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  const base = ctx.createLinearGradient(0, 0, 0, 256);
  base.addColorStop(0, "#caa577");
  base.addColorStop(0.5, "#c19b6b");
  base.addColorStop(1, "#c6a172");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 512, 256);
  let seed = 7;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let k = 0; k < 9; k += 1) {
    const y0 = rand() * 256;
    ctx.fillStyle = `rgba(${128 + rand() * 30}, ${86 + rand() * 20}, ${44 + rand() * 18}, ${0.1 + rand() * 0.12})`;
    ctx.beginPath();
    ctx.moveTo(0, y0);
    const amp = 4 + rand() * 10;
    const f = 0.004 + rand() * 0.008;
    const ph = rand() * 6.28;
    const h = 6 + rand() * 18;
    for (let x = 0; x <= 512; x += 8) ctx.lineTo(x, y0 + Math.sin(x * f + ph) * amp);
    for (let x = 512; x >= 0; x -= 8) ctx.lineTo(x, y0 + h + Math.sin(x * f + ph + 0.4) * amp);
    ctx.closePath();
    ctx.fill();
  }
  for (let k = 0; k < 150; k += 1) {
    const y0 = rand() * 256;
    const amp = 1 + rand() * 5;
    const f = 0.006 + rand() * 0.012;
    const ph = rand() * 6.28;
    ctx.strokeStyle = `rgba(92, 58, 26, ${0.08 + rand() * 0.2})`;
    ctx.lineWidth = 0.5 + rand() * 1.1;
    ctx.beginPath();
    const x0 = rand() * 200 - 100;
    const len = 200 + rand() * 500;
    for (let x = x0; x <= x0 + len; x += 6) {
      const y = y0 + Math.sin(x * f + ph) * amp + Math.sin(x * f * 3.1 + ph) * amp * 0.25;
      if (x === x0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  return canvas.toDataURL("image/jpeg", 0.86);
}

function Vinyl({ sleeve }) {
  return (
    <div className="crate__vinyl" aria-hidden="true">
      <div
        className="crate__label"
        style={{ "--crate-label-paper": sleeve.label.paper, "--crate-label-ink": sleeve.label.ink }}
      >
        <span className="crate__label-title">{sleeve.song}</span>
        <span className="crate__label-meta">{sleeve.artist}</span>
        <span className="crate__label-hole" />
      </div>
    </div>
  );
}

function Back({ sleeve }) {
  const tracks = sleeve.tracks?.length ? sleeve.tracks : sleeve.songs;
  const half = tracks.length > 3 ? Math.ceil(tracks.length / 2) : tracks.length;
  const sides = [tracks.slice(0, half), tracks.slice(half)].filter((side) => side.length);
  return (
    <div className="crate__back" aria-hidden="true" style={{ "--crate-back-paper": sleeve.back }}>
      <div className="crate__back-head">
        <span className="crate__back-title">{sleeve.title}</span>
        <span className="crate__back-artist">{sleeve.artist}</span>
      </div>
      <div className="crate__back-sides" data-count={sides.length}>
        {sides.map((side, k) => (
          <div key={k} className="crate__back-col">
            <span className="crate__back-side">{k ? "Side two" : "Side one"}</span>
            <ol className="crate__back-list" start={k ? half + 1 : 1}>
              {side.map((song) => (
                <li key={song}>{song}</li>
              ))}
            </ol>
          </div>
        ))}
      </div>
      <div className="crate__back-notes" />
      <div className="crate__back-foot">
        <span>{sleeve.year ? `${sleeve.year} · Stereo` : "Stereo"}</span>
        <span>33⅓</span>
      </div>
    </div>
  );
}

function Edges() {
  return (
    <>
      <div className="crate__edge crate__edge--top" aria-hidden="true" />
      <div className="crate__edge crate__edge--left" aria-hidden="true" />
      <div className="crate__edge crate__edge--right" aria-hidden="true" />
    </>
  );
}

const BOX = ["shadow", "floor", "back", "back-lip", "left", "right", "right-out", "left-lip", "right-lip", "left-end", "right-end", "front", "front-lip"];

const START = 2;

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const binRef = useRef(null);
  const sleeveRefs = useRef([]);
  const apiRef = useRef(null);
  const placeRef = useRef(START);
  const { tracks } = useTopSongs(50);
  const sleeves = useMemo(() => toSleeves(tracks), [tracks]);
  const N = sleeves.length;
  const [index, setIndex] = useState(START);
  const [lifted, setLifted] = useState(false);

  useEffect(() => {
    const root = rootRef.current;
    const bin = binRef.current;
    if (!root || !bin || !N) return undefined;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const foley = createFoley();
    const start = clamp(placeRef.current, 0, N - 1);
    const s = {
      pos: start,
      vel: 0,
      target: start,
      lift: 0,
      liftVel: 0,
      liftTarget: 0,
      liftIndex: start,
      drag: null,
      raf: 0,
      last: 0,
      shownIndex: placeRef.current,
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
        const p = place(d, i);
        let angle = p.angle;
        let z = p.z;
        let ly = 0;
        let vinyl = 0;
        let sx = p.x;
        let tw = p.twist;
        if (i === s.liftIndex && lift > 0.001) {
          const l = lift * clamp(1 - Math.abs(d) * 2, 0, 1);
          ly = LIFT_Y * l;
          sx = mix(sx, 0, l);
          tw = mix(tw, 0, l);
          angle = mix(angle, 0, l);
          z += 0.02 * l;
          vinyl = clamp((l - 0.55) / 0.45, 0, 1);
        }
        el.style.transform = `translate3d(calc(${sx.toFixed(4)} * var(--crate-size)), calc(${(-ly).toFixed(4)} * var(--crate-size)), calc(${z.toFixed(4)} * var(--crate-size))) rotateX(${(-angle).toFixed(3)}deg) rotateZ(${tw.toFixed(3)}deg)`;
        el.style.setProperty("--crate-shade", p.shade.toFixed(3));
        el.style.setProperty("--crate-out", vinyl.toFixed(4));
        if (d < -0.5) {
          if (el.dataset.flipped === undefined) el.dataset.flipped = "";
        } else if (el.dataset.flipped !== undefined) delete el.dataset.flipped;
      }
      const current = clamp(Math.round(s.pos), 0, N - 1);
      placeRef.current = current;
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
    try {
      root.style.setProperty("--crate-wood", `url(${woodTexture()})`);
    } catch {
      root.style.removeProperty("--crate-wood");
    }
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
  }, [embedded, N]);

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

  const shown = clamp(index, 0, Math.max(0, N - 1));
  const sleeve = sleeves[shown];

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
        <div className="crate__scene">
          <div className="crate__world" style={{ "--crate-back": ((Math.max(1, N) - 1) * GAP + 0.16).toFixed(3) }}>
          {BOX.map((part) => (
            <div key={part} className={`crate__box crate__box--${part}`} aria-hidden="true" />
          ))}
          {sleeves.map((s, i) => (
            <div
              key={s.id}
              ref={(el) => {
                sleeveRefs.current[i] = el;
              }}
              className="crate__sleeve"
              data-sleeve={i}
            >
              <Vinyl sleeve={s} />
              <div className="crate__front">
                <img src={s.src} alt="" draggable="false" decoding="async" />
              </div>
              <Edges />
              <Back sleeve={s} />
            </div>
          ))}
          </div>
        </div>
      </div>
      <div className="crate__now" aria-live="polite">
        <p className="crate__now-title">{sleeve?.title}</p>
        <p className="crate__now-meta">
          <span className="crate__now-artist">{sleeve?.artist}</span>
          <span className="crate__now-count">
            {pad(shown + 1)} / {pad(N)}
          </span>
        </p>
      </div>
    </div>
  );
}
