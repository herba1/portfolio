"use client";

import { useEffect, useRef } from "react";

import { albumById } from "../_kit/covers";

import "./corner-throw.css";

// UIScrollView.DecelerationRate.normal. Velocity in px/s, distance in px.
const RATE = 0.998;
const project = (v) => ((v / 1000) * RATE) / (1 - RATE);

// UISpringTimingParameters-style: response (s) and damping ratio.
const RESPONSE = 0.44;
const DAMPING = 0.86;
const K = (2 * Math.PI / RESPONSE) ** 2;
const C = (4 * Math.PI * DAMPING) / RESPONSE;
const STEP = 1 / 240;

const INSET = 32;
const ALBUM = albumById("abbey-road");

// iOS-style rubber band past the edge: resistance grows with distance.
const rubber = (x, d) => (1 - 1 / ((x * 0.55) / d + 1)) * d;
const band = (v, lo, hi, d) => (v < lo ? lo - rubber(lo - v, d) : v > hi ? hi + rubber(v - hi, d) : v);

export default function Piece() {
  const rootRef = useRef(null);
  const tileRef = useRef(null);
  const ghostRef = useRef(null);

  useEffect(() => {
    const root = rootRef.current;
    const tile = tileRef.current;
    const ghost = ghostRef.current;
    const box = root.closest(".piece-box") || root;
    const params = new URLSearchParams(window.location.search);
    const still = params.has("t") ? Math.max(0, +params.get("t") || 0) : null;
    const stillDrag = params.has("drag");

    const s = {
      w: 0, h: 0, size: 0,
      x: 0, y: 0, vx: 0, vy: 0,
      corner: 2, ghostCorner: 2,
      mode: "rest", // rest | drag | fly
      grab: { dx: 0, dy: 0 },
      samples: [],
      raf: 0, last: 0,
    };

    const corners = () => {
      const half = s.size / 2;
      const l = INSET + half, r = s.w - INSET - half;
      const t = INSET + half, b = s.h - INSET - half;
      return [[l, t], [r, t], [l, b], [r, b]];
    };
    const nearest = (px, py) => {
      let best = 0, bd = Infinity;
      corners().forEach(([cx, cy], i) => {
        const d = (cx - px) ** 2 + (cy - py) ** 2;
        if (d < bd) { bd = d; best = i; }
      });
      return best;
    };

    const paint = () => {
      const half = s.size / 2;
      tile.style.transform = `translate3d(${s.x - half}px, ${s.y - half}px, 0)`;
    };
    const placeGhost = (i, show) => {
      const [cx, cy] = corners()[i];
      const half = s.size / 2;
      ghost.style.transform = `translate3d(${cx - half}px, ${cy - half}px, 0)`;
      if (show) ghost.dataset.show = "";
      else delete ghost.dataset.show;
      s.ghostCorner = i;
    };

    const measure = () => {
      const r = box.getBoundingClientRect();
      const k = box.offsetWidth ? r.width / box.offsetWidth : 1;
      s.w = box.offsetWidth || r.width / k;
      s.h = box.offsetHeight || r.height / k;
      s.k = k;
      // A PiP window is small: about a fifth of the short side.
      s.size = Math.round(Math.max(88, Math.min(168, Math.min(s.w, s.h) * 0.21)));
      root.style.setProperty("--ct-size", `${s.size}px`);
      if (s.mode === "rest") {
        [s.x, s.y] = corners()[s.corner];
        paint();
      }
      placeGhost(s.ghostCorner, ghost.dataset.show !== undefined);
    };

    const point = (e) => {
      const r = box.getBoundingClientRect();
      return [(e.clientX - r.left) / s.k, (e.clientY - r.top) / s.k];
    };

    const velocity = () => {
      const now = performance.now();
      const pts = s.samples.filter((p) => now - p.t < 64);
      if (pts.length < 2) return [0, 0];
      const a = pts[0], b = pts[pts.length - 1];
      const dt = (b.t - a.t) / 1000;
      if (dt < 0.008 || now - b.t > 60) return [0, 0];
      return [(b.x - a.x) / dt, (b.y - a.y) / dt];
    };

    const projectedCorner = (vx, vy) => nearest(s.x + project(vx), s.y + project(vy));

    const tick = (now) => {
      const dt = Math.min(0.05, (now - s.last) / 1000 || 0);
      s.last = now;
      if (s.mode === "fly") {
        advance(dt);
        paint();
        if (s.mode === "fly") s.raf = requestAnimationFrame(tick);
        else s.raf = 0;
      } else s.raf = 0;
    };
    const advance = (dt) => {
      const [tx, ty] = corners()[s.corner];
      for (let t = 0; t < dt; t += STEP) {
        const h = Math.min(STEP, dt - t);
        s.vx += (-K * (s.x - tx) - C * s.vx) * h;
        s.vy += (-K * (s.y - ty) - C * s.vy) * h;
        s.x += s.vx * h;
        s.y += s.vy * h;
      }
      const near = Math.hypot(s.x - tx, s.y - ty) < 0.25 && Math.hypot(s.vx, s.vy) < 4;
      if (Math.hypot(s.x - tx, s.y - ty) < s.size * 0.35) placeGhost(s.corner, false);
      if (near) {
        s.x = tx; s.y = ty; s.vx = s.vy = 0;
        s.mode = "rest";
        delete root.dataset.flying;
      }
    };
    const fly = (vx, vy, corner) => {
      s.vx = vx; s.vy = vy;
      s.corner = corner;
      s.mode = "fly";
      root.dataset.flying = "";
      s.last = performance.now();
      if (!s.raf) s.raf = requestAnimationFrame(tick);
    };

    const onDown = (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      tile.setPointerCapture(e.pointerId);
      const [px, py] = point(e);
      cancelAnimationFrame(s.raf); s.raf = 0;
      s.mode = "drag";
      s.vx = s.vy = 0;
      s.grab = { dx: s.x - px, dy: s.y - py };
      s.samples = [{ x: s.x, y: s.y, t: performance.now() }];
      root.dataset.dragging = "";
      delete root.dataset.flying;
      placeGhost(s.corner, false);
    };
    const onMove = (e) => {
      if (s.mode !== "drag") return;
      const [px, py] = point(e);
      const half = s.size / 2;
      s.x = band(px + s.grab.dx, half, s.w - half, s.w);
      s.y = band(py + s.grab.dy, half, s.h - half, s.h);
      const t = performance.now();
      s.samples.push({ x: s.x, y: s.y, t });
      while (s.samples.length > 2 && t - s.samples[0].t > 120) s.samples.shift();
      paint();
      const [vx, vy] = velocity();
      placeGhost(projectedCorner(vx, vy), true);
    };
    const onUp = (e) => {
      if (s.mode !== "drag") return;
      const [vx, vy] = velocity();
      delete root.dataset.dragging;
      const c = projectedCorner(vx, vy);
      placeGhost(c, true);
      fly(vx, vy, c);
    };
    const onKey = (e) => {
      const map = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      const d = map[e.key];
      if (!d) return;
      e.preventDefault();
      let c = s.corner;
      if (d[0]) c = (c & 2) | (d[0] > 0 ? 1 : 0);
      if (d[1]) c = (c & 1) | (d[1] > 0 ? 2 : 0);
      if (c !== s.corner || s.mode === "fly") fly(s.vx + d[0] * 600, s.vy + d[1] * 600, c);
    };

    const ro = new ResizeObserver(measure);
    ro.observe(box);
    measure();

    if (still !== null || stillDrag) {
      // A held moment: picked up from the bottom-left, flung up and right.
      s.x = corners()[2][0] + s.w * 0.22;
      s.y = corners()[2][1] - s.h * 0.2;
      const vx = 1250, vy = -980;
      const c = projectedCorner(vx, vy);
      if (stillDrag) {
        root.dataset.dragging = "";
        placeGhost(c, true);
        paint();
        s.mode = "frozen";
      } else {
        s.corner = c; s.vx = vx; s.vy = vy; s.mode = "fly";
        root.dataset.flying = "";
        placeGhost(c, true);
        advance(still);
        paint();
        s.mode = "frozen";
      }
    }

    tile.addEventListener("pointerdown", onDown);
    tile.addEventListener("pointermove", onMove);
    tile.addEventListener("pointerup", onUp);
    tile.addEventListener("pointercancel", onUp);
    tile.addEventListener("keydown", onKey);
    root.dataset.ready = "";
    return () => {
      ro.disconnect();
      cancelAnimationFrame(s.raf);
      tile.removeEventListener("pointerdown", onDown);
      tile.removeEventListener("pointermove", onMove);
      tile.removeEventListener("pointerup", onUp);
      tile.removeEventListener("pointercancel", onUp);
      tile.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div ref={rootRef} className="ct-root">
      <div ref={ghostRef} className="ct-ghost" aria-hidden="true" />
      <div
        ref={tileRef}
        className="ct-tile"
        tabIndex={0}
        role="img"
        aria-label={`Now playing: ${ALBUM.tracks[0]}, ${ALBUM.title}. Arrow keys move it between corners.`}
      >
        <div className="ct-lift">
          <img className="ct-cover" src={ALBUM.cover} alt="" draggable={false} />
          <div className="ct-progress" aria-hidden="true">
            <span />
          </div>
        </div>
      </div>
    </div>
  );
}
