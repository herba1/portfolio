"use client";

import { useLayoutEffect, useRef, useState } from "react";

import { albumById } from "@/app/lab/_music/catalog";
import { closeAudio, wakeAudio, whoosh } from "./whoosh";

import "./type-fly.css";

const SET = [
  ["abbey-road", "#3b78c2"],
  ["revolver", "#2b2b2e"],
  ["rubber-soul", "#a8541f"],
  ["let-it-be", "#c4302b"],
  ["help", "#2b3a78"],
  ["magical-mystery-tour", "#d39a12"],
].map(([id, color]) => ({ ...albumById(id), color }));

const LAYERS = 14;
const STAGGER = 0.026;
const STIFF = 150;
const DAMP = 19;
const TAU = Math.PI * 2;

const clamp01 = (v) => Math.min(1, Math.max(0, v));

function ringPoint(d, R) {
  let u = ((((d + 4 * R) % (8 * R)) + 8 * R) % (8 * R)) - 4 * R;
  if (u >= -R && u <= R) return [u, R, 0];
  if (u > R && u <= 3 * R) return [R, R - (u - R), Math.PI / 2];
  if (u > 3 * R) return [R - (u - 3 * R), -R, Math.PI];
  if (u < -R && u >= -3 * R) return [-R, R + (u + R), -Math.PI / 2];
  return [-R - (u + 3 * R), -R, -Math.PI];
}

function wrapAngle(a) {
  return a - TAU * Math.round(a / TAU);
}

export default function Piece({ embedded = false }) {
  const stageRef = useRef(null);
  const sceneRef = useRef(null);
  const coverRef = useRef(null);
  const letterRefs = useRef([]);
  const simRef = useRef(null);
  const [index, setIndex] = useState(0);
  const [lifted, setLifted] = useState(false);
  const album = SET[index];
  const chars = Array.from(album.title);

  useLayoutEffect(() => {
    const stage = stageRef.current;
    const scene = sceneRef.current;
    if (!stage || !scene) return undefined;
    const sim = {
      w: 1,
      h: 1,
      fs: 100,
      cover: 240,
      coverY: 0,
      titleY: 0,
      R: 200,
      ringScale: 1,
      letters: [],
      want: false,
      hover: false,
      press: false,
      pinned: false,
      theta: 0,
      thetaV: 0,
      drag: null,
      tilt: 0,
      tiltV: 0,
      clock: 0,
      raf: 0,
      last: 0,
      onLift: setLifted,
    };
    simRef.current = sim;

    const layout = () => {
      const rect = stage.getBoundingClientRect();
      sim.w = rect.width;
      sim.h = rect.height;
      const compact = sim.w < 640;
      scene.style.setProperty("--tf-fs", "100px");
      const widths = sim.letters.map((l) => l.el?.offsetWidth || 0);
      const total = widths.reduce((a, b) => a + b, 0) || 1;
      const maxFs = compact ? 72 : 136;
      const fs = Math.max(28, Math.min(maxFs, ((sim.w - (compact ? 40 : 120)) * 100) / total));
      sim.fs = fs;
      scene.style.setProperty("--tf-fs", `${fs}px`);
      const k = fs / 100;
      const run = total * k;
      let acc = -run / 2;
      sim.letters.forEach((l, i) => {
        const wi = widths[i] * k;
        l.flatX = acc + wi / 2;
        l.along = acc + wi / 2;
        acc += wi;
      });
      sim.cover = Math.round(Math.max(150, Math.min(sim.w * 0.36, sim.h * 0.32, 300)));
      const block = sim.cover + 40 + fs;
      const top = -block / 2 - (compact ? 8 : 24);
      sim.coverY = top + sim.cover / 2;
      sim.titleY = top + sim.cover + 40 + fs / 2;
      sim.R = Math.min(sim.cover * 0.5 + fs * 0.62 + 28, sim.w * (compact ? 0.3 : 0.34));
      sim.ringScale = Math.min(1, (8 * sim.R * 0.82) / run);
      scene.style.setProperty("--tf-cover", `${sim.cover}px`);
      scene.style.setProperty("--tf-cover-y", `${sim.coverY}px`);
    };
    sim.layout = layout;

    const render = (dt) => {
      const want = sim.hover || sim.press || sim.pinned;
      if (want !== sim.want) {
        sim.want = want;
        sim.letters.forEach((l, i) => {
          l.switchAt = sim.clock + i * STAGGER;
          l.next = want ? 1 : 0;
        });
        whoosh(want);
        sim.onLift(want);
      }
      if (sim.drag) {
        sim.thetaV *= 0.8;
      } else if (want) {
        sim.thetaV += (0.32 - sim.thetaV) * Math.min(1, dt * 1.6);
        sim.theta += sim.thetaV * dt;
      } else {
        const target = TAU * Math.round(sim.theta / TAU);
        const acc = (target - sim.theta) * 60 - sim.thetaV * 13;
        sim.thetaV += acc * dt;
        sim.theta += sim.thetaV * dt;
      }
      const tiltTarget = want ? 1 : 0;
      sim.tiltV += ((tiltTarget - sim.tilt) * 70 - sim.tiltV * 15) * dt;
      sim.tilt += sim.tiltV * dt;
      scene.style.transform = `rotateX(${(-16 * sim.tilt).toFixed(3)}deg)`;
      const cover = coverRef.current;
      if (cover) cover.style.transform = `translate3d(-50%, -50%, 0) translateY(${sim.coverY.toFixed(1)}px) rotateY(${sim.theta.toFixed(4)}rad)`;
      const cos = Math.cos(sim.theta);
      const sin = Math.sin(sim.theta);
      const n = sim.letters.length;
      for (let i = 0; i < n; i += 1) {
        const l = sim.letters[i];
        if (!l.el) continue;
        if (sim.clock >= l.switchAt) l.target = l.next;
        l.v += ((l.target - l.p) * STIFF - l.v * DAMP) * dt;
        l.p += l.v * dt;
        const p = l.p;
        const q = clamp01(p);
        const [rx0, rz0, rr0] = ringPoint(l.along * sim.ringScale, sim.R);
        const rx = rx0 * cos + rz0 * sin;
        const rz = -rx0 * sin + rz0 * cos;
        const rr = wrapAngle(rr0 + sim.theta);
        const arc = Math.sin(Math.PI * q);
        const x = l.flatX + (rx - l.flatX) * p;
        const y = sim.titleY + (sim.coverY - sim.titleY) * p - arc * sim.fs * 0.7;
        const z = rz * p + arc * sim.fs * 0.9;
        const ry = rr * p;
        const tumble = arc * -38;
        const scale = 1 + (sim.ringScale - 1) * q;
        l.el.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, ${z.toFixed(2)}px) translate(-50%, -50%) rotateY(${ry.toFixed(4)}rad) rotateX(${tumble.toFixed(2)}deg) scale(${scale.toFixed(4)})`;
        l.el.style.setProperty("--tf-p", q.toFixed(3));
        const deep = q > 0.01;
        if (deep !== l.deep) {
          l.deep = deep;
          l.el.toggleAttribute("data-deep", deep);
        }
      }
    };

    sim.render = render;
    const step = (now) => {
      sim.raf = requestAnimationFrame(step);
      const dt = Math.min(0.033, sim.last ? (now - sim.last) / 1000 : 0.016);
      sim.last = now;
      sim.clock += dt;
      render(dt);
    };

    const ro = new ResizeObserver(layout);
    ro.observe(stage);
    const onVisibility = () => {
      cancelAnimationFrame(sim.raf);
      sim.last = 0;
      if (!document.hidden) sim.raf = requestAnimationFrame(step);
    };
    document.addEventListener("visibilitychange", onVisibility);
    sim.raf = requestAnimationFrame(step);
    let alive = true;
    document.fonts?.ready.then(() => alive && layout());
    return () => {
      alive = false;
      cancelAnimationFrame(sim.raf);
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      simRef.current = null;
      closeAudio();
    };
  }, []);

  useLayoutEffect(() => {
    const sim = simRef.current;
    if (!sim) return;
    const count = Array.from(SET[index].title).length;
    const fresh = sim.letters.length === 0;
    sim.letters = Array.from({ length: count }, (_, i) => ({
      el: letterRefs.current[i],
      p: 1,
      v: 0,
      target: 1,
      next: sim.want ? 1 : 0,
      switchAt: sim.clock + (fresh ? 0.35 : 0.08) + i * STAGGER,
      flatX: 0,
      along: 0,
      deep: null,
    }));
    sim.layout();
    sim.render(0);
  }, [index]);

  const insideBlock = (event) => {
    const sim = simRef.current;
    const stage = stageRef.current;
    if (!sim || !stage) return false;
    const rect = stage.getBoundingClientRect();
    const x = event.clientX - rect.left - sim.w / 2;
    const y = event.clientY - rect.top - sim.h / 2;
    const half = Math.max(sim.R, sim.fs * 3, sim.cover / 2) + 48;
    return Math.abs(x) < Math.max(half, sim.w * 0.42) && y > sim.coverY - sim.cover / 2 - 72 && y < sim.titleY + sim.fs / 2 + 56;
  };

  const onPointerMove = (event) => {
    const sim = simRef.current;
    if (!sim) return;
    if (event.pointerType === "mouse" && !sim.drag) sim.hover = insideBlock(event);
    if (sim.drag && sim.drag.id === event.pointerId) {
      const dx = event.clientX - sim.drag.x;
      const dt = Math.max(1, event.timeStamp - sim.drag.t) / 1000;
      sim.drag.x = event.clientX;
      sim.drag.t = event.timeStamp;
      const dTheta = dx * 0.0085;
      sim.theta += dTheta;
      sim.thetaV = sim.thetaV * 0.5 + (dTheta / dt) * 0.5;
    }
  };

  const onPointerDown = (event) => {
    const sim = simRef.current;
    if (!sim || event.button > 0) return;
    wakeAudio();
    if (!insideBlock(event)) return;
    sim.press = true;
    sim.drag = { id: event.pointerId, x: event.clientX, t: event.timeStamp };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      sim.drag.free = true;
    }
  };

  const endDrag = (event) => {
    const sim = simRef.current;
    if (!sim || !sim.drag || sim.drag.id !== event.pointerId) return;
    sim.drag = null;
    sim.press = false;
    sim.thetaV = Math.max(-9, Math.min(9, sim.thetaV));
    if (event.pointerType === "mouse") sim.hover = insideBlock(event);
  };

  const onPointerLeave = (event) => {
    const sim = simRef.current;
    if (!sim || event.pointerType !== "mouse" || sim.drag) return;
    sim.hover = false;
  };

  const onKeyDown = (event) => {
    const sim = simRef.current;
    if (!sim) return;
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      wakeAudio();
      sim.pinned = !sim.pinned;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      sim.pinned = true;
      sim.thetaV += event.key === "ArrowLeft" ? -2.4 : 2.4;
    } else if (event.key === "Escape") {
      sim.pinned = false;
    }
  };

  const Root = embedded ? "div" : "main";

  return (
    <Root className="tf-root" data-embedded={embedded ? "" : undefined} style={{ "--tf-color": album.color }}>
      <div
        ref={stageRef}
        className="tf-stage"
        tabIndex={0}
        role="application"
        aria-label={`${album.title}. Press Space to lift the letters into a ring around the cover, arrows to spin it, Escape to set them down.`}
        data-lifted={lifted ? "" : undefined}
        onPointerMove={onPointerMove}
        onPointerDown={onPointerDown}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={onPointerLeave}
        onKeyDown={onKeyDown}
      >
        <div ref={sceneRef} className="tf-scene">
          <div ref={coverRef} className="tf-cover">
            <img className="tf-face" src={album.cover} alt={`${album.title} cover`} draggable={false} />
            <div className="tf-face tf-back" aria-hidden="true">
              <span className="tf-back-title">{album.title}</span>
              <ol className="tf-back-tracks">
                {album.tracks.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ol>
              <span className="tf-back-year">
                {album.artist}, {album.year}
              </span>
            </div>
          </div>
          {chars.map((c, i) => (
            <span
              key={`${album.id}-${i}`}
              ref={(el) => {
                letterRefs.current[i] = el;
              }}
              className="tf-letter"
              aria-hidden="true"
              data-space={c === " " ? "" : undefined}
            >
              {Array.from({ length: LAYERS }, (_, k) => (
                <span key={k} className="tf-layer" style={{ "--k": k + 1 }}>
                  {c === " " ? " " : c}
                </span>
              ))}
              <span className="tf-front">{c === " " ? " " : c}</span>
            </span>
          ))}
        </div>
      </div>
      {embedded ? null : (
        <header className="tf-head">
          <h1 className="text-title-sm">Type Fly</h1>
          <p className="tf-hint text-ui-lg">Hover or press the record and its title lifts into a ring in depth. Drag to spin it round to the tracklist.</p>
        </header>
      )}
      <nav className="tf-picker" aria-label="Albums">
        {SET.map((a, i) => (
          <button
            key={a.id}
            type="button"
            className="tf-pick"
            aria-pressed={i === index}
            onClick={() => {
              wakeAudio();
              setIndex(i);
            }}
          >
            <img src={a.cover} alt="" width={32} height={32} draggable={false} />
            <span>{a.title}</span>
          </button>
        ))}
      </nav>
    </Root>
  );
}
