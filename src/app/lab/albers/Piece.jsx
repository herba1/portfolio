"use client";

import { useCallback, useEffect, useRef } from "react";

import "./albers.css";

// Each plate: left ground, right ground, and the one ink both squares are
// printed in. The grounds are neighbours, close in hue and chroma, and part
// mainly in lightness and temperature; the ink is their OKLab midpoint. On
// the lighter, warmer ground it reads darker and cooler, on the deeper,
// cooler one lighter and warmer, so one ink is pushed two ways at once.
const PLATES = [
  { l: "#d8a447", r: "#58612f", i: "#97823b" }, // warm ochre / cool olive: olive on one, ochre on the other
  { l: "#e8bfae", r: "#76342a", i: "#af7869" }, // light rose / deep brick
  { l: "#c3ccd6", r: "#2f3847", i: "#757e8b" }, // pale grey-blue / slate
  { l: "#cfc3dd", r: "#3e2747", i: "#83718f" }, // lilac / aubergine
  { l: "#f0c75a", r: "#9b5a1e", i: "#c68f3c" }, // cadmium yellow / burnt sienna: orange on one, ochre on the other
  { l: "#2b2523", r: "#e2d6bd", i: "#80776b" }, // umber / cream: one grey as two
];

const SLOP = 5;
const HOME = { k: 300, zeta: 0.86 }; // a square returning to its print position
const BRIDGE = { k: 70, zeta: 1 }; // critically damped: reads as ease-out, interruptible
const WIPE_MS = 760;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const easeOut = (t) => 1 - Math.pow(1 - t, 4);

function spring(s, key, vkey, target, { k, zeta }, dt) {
  const c = 2 * Math.sqrt(k) * zeta;
  const a = -k * (s[key] - target) - c * s[vkey];
  s[vkey] += a * dt;
  s[key] += s[vkey] * dt;
}

function rubber(v, lo, hi, s) {
  if (v < lo) return lo - (lo - v) * (s / (s + (lo - v) * 1.6));
  if (v > hi) return hi + (v - hi) * (s / (s + (v - hi) * 1.6));
  return v;
}

function Layer({ layerRef, className }) {
  return (
    <div ref={layerRef} className={`al-layer ${className}`}>
      <div className="al-ground al-ground--l" />
      <div className="al-ground al-ground--r" />
      <div className="al-bridge al-bridge--l" />
      <div className="al-bridge al-bridge--r" />
      <div className="al-sq al-sq--l" />
      <div className="al-sq al-sq--r" />
    </div>
  );
}

export default function Piece() {
  const rootRef = useRef(null);
  const plateRef = useRef(null);
  const backRef = useRef(null);
  const frontRef = useRef(null);

  const geo = useRef({ w: 0, h: 0, s: 0 });
  const sq = useRef([
    { x: 0, y: 0, vx: 0, vy: 0 },
    { x: 0, y: 0, vx: 0, vy: 0 },
  ]);
  const bridge = useRef({ b: 0, v: 0, target: 0 });
  const wipe = useRef({ p: 0, start: 0, active: false });
  const plate = useRef(0);
  const drag = useRef(null);
  const frozen = useRef(null);
  const raf = useRef(0);
  const last = useRef(0);
  const intro = useRef(0);

  const ink = useCallback((el, p) => {
    if (!el) return;
    const c = PLATES[p];
    el.style.setProperty("--al-gl", c.l);
    el.style.setProperty("--al-gr", c.r);
    el.style.setProperty("--al-in", c.i);
  }, []);

  const paint = useCallback(() => {
    const el = plateRef.current;
    if (!el) return;
    const [a, b] = sq.current;
    el.style.setProperty("--al-lx", `${a.x.toFixed(2)}px`);
    el.style.setProperty("--al-ly", `${a.y.toFixed(2)}px`);
    el.style.setProperty("--al-rx", `${b.x.toFixed(2)}px`);
    el.style.setProperty("--al-ry", `${b.y.toFixed(2)}px`);
    el.style.setProperty("--al-b", clamp(bridge.current.b, 0, 1).toFixed(4));
    const p = wipe.current.active || frozen.current?.w != null ? wipe.current.p : 0;
    // The new ink covers [0, p]; the old ink only shows over the rest, so
    // the two never overlap and antialiased edges cannot mix.
    const pct = (p * 100).toFixed(3);
    if (frontRef.current) frontRef.current.style.clipPath = `inset(0 ${(100 - p * 100).toFixed(3)}% 0 0)`;
    if (backRef.current) backRef.current.style.clipPath = p > 0 ? `inset(0 0 0 ${pct}%)` : "none";
  }, []);

  const settled = useCallback(() => {
    const [a, b] = sq.current;
    const br = bridge.current;
    const still = (s) => Math.abs(s.x) < 0.05 && Math.abs(s.y) < 0.05 && Math.abs(s.vx) < 0.05 && Math.abs(s.vy) < 0.05;
    return (
      !drag.current &&
      !wipe.current.active &&
      still(a) &&
      still(b) &&
      Math.abs(br.b - br.target) < 0.0005 &&
      Math.abs(br.v) < 0.001
    );
  }, []);

  const tick = useCallback(
    function loop(now) {
      const dt = Math.min(1 / 30, (now - (last.current || now)) / 1000) || 1 / 120;
      last.current = now;

      sq.current.forEach((s, i) => {
        if (drag.current?.i === i && drag.current.moved) return;
        spring(s, "x", "vx", 0, HOME, dt);
        spring(s, "y", "vy", 0, HOME, dt);
      });

      const br = bridge.current;
      spring(br, "b", "v", br.target, BRIDGE, dt);

      const wp = wipe.current;
      if (wp.active) {
        wp.p = easeOut(clamp((now - wp.start) / WIPE_MS, 0, 1));
        if (wp.p >= 1) {
          wp.active = false;
          ink(backRef.current, plate.current);
          wp.p = 0;
        }
      }

      paint();
      if (settled()) {
        for (const s of sq.current) Object.assign(s, { x: 0, y: 0, vx: 0, vy: 0 });
        br.b = br.target;
        br.v = 0;
        paint();
        raf.current = 0;
        last.current = 0;
        return;
      }
      raf.current = requestAnimationFrame(loop);
    },
    [ink, paint, settled]
  );

  const kick = useCallback(() => {
    if (frozen.current) return;
    if (!raf.current) raf.current = requestAnimationFrame(tick);
  }, [tick]);

  const next = useCallback(() => {
    const wp = wipe.current;
    // Interrupting a pull: the half-pulled ink lands at once, the next one starts.
    if (wp.active) ink(backRef.current, plate.current);
    plate.current = (plate.current + 1) % PLATES.length;
    ink(frontRef.current, plate.current);
    wp.active = true;
    wp.p = 0;
    wp.start = performance.now();
    kick();
  }, [ink, kick]);

  const layout = useCallback(() => {
    const root = rootRef.current;
    const el = plateRef.current;
    if (!root || !el) return;
    const box = root.closest(".piece-box") || root;
    const cw = box.clientWidth;
    const ch = box.clientHeight;
    const ratio = 1.16;
    const w = Math.round(Math.min(cw * (cw < 600 ? 0.43 : 0.37), (ch * 0.6) / ratio, 380));
    const h = Math.round(w * ratio);
    // Even sizes keep the square centred on whole pixels. The square is a
    // field, not a dot: at 0.4 of its ground the eye judges its colour.
    const s = Math.round((w * 0.4) / 2) * 2;
    // The bridge is a band with presence, half the square's height.
    const t = Math.max(2, Math.round((s * 0.5) / 2) * 2);
    geo.current = { w, h, s };
    el.style.setProperty("--al-w", `${w}px`);
    el.style.setProperty("--al-h", `${h}px`);
    el.style.setProperty("--al-s", `${s}px`);
    el.style.setProperty("--al-t", `${t}px`);
    // Frozen stills: ?t= carries the left square that fraction of the way
    // to its twin, ?b= holds the bridge, ?p= picks the plate, ?w= holds a pull.
    if (frozen.current) {
      const f = frozen.current;
      if (f.t != null) sq.current[0].x = f.t * w;
      paint();
    }
  }, [paint]);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const num = (k) => (q.has(k) ? parseFloat(q.get(k)) : null);
    const f = { t: num("t"), b: num("b"), p: num("p"), w: num("w") };
    const p0 = f.p != null ? clamp(Math.round(f.p), 0, PLATES.length - 1) : 0;
    plate.current = p0;
    ink(backRef.current, p0);
    ink(frontRef.current, p0);
    if (f.t != null || f.b != null || f.p != null || f.w != null) {
      frozen.current = f;
      if (f.b != null) bridge.current.b = bridge.current.target = clamp(f.b, 0, 1);
      if (f.w != null) {
        plate.current = (p0 + 1) % PLATES.length;
        ink(frontRef.current, plate.current);
        wipe.current.p = easeOut(clamp(f.w, 0, 1));
      }
    }

    layout();
    const box = rootRef.current?.closest(".piece-box") || rootRef.current;
    const ro = new ResizeObserver(layout);
    if (box) ro.observe(box);

    // The plate shows itself once: the bridge draws in, holds, and lets go.
    if (!frozen.current) {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (!reduce) {
        intro.current = window.setTimeout(() => {
          bridge.current.target = 1;
          kick();
          intro.current = window.setTimeout(() => {
            bridge.current.target = 0;
            kick();
            intro.current = 0;
          }, 2200);
        }, 1400);
      }
    }

    return () => {
      ro.disconnect();
      window.clearTimeout(intro.current);
      cancelAnimationFrame(raf.current);
      raf.current = 0;
    };
  }, [ink, kick, layout]);

  const stopIntro = () => {
    if (intro.current) {
      window.clearTimeout(intro.current);
      intro.current = 0;
    }
  };

  const local = (e) => {
    const r = plateRef.current.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const hit = (pt) => {
    const { w, h, s } = geo.current;
    const pad = Math.max(6, s * 0.15);
    // The square on top wins: a dragged-over square is under the other.
    const order = plateRef.current?.dataset.top === "l" ? [0, 1] : [1, 0];
    for (const i of order) {
      const cx = w * (i + 0.5) + sq.current[i].x;
      const cy = h / 2 + sq.current[i].y;
      if (Math.abs(pt.x - cx) <= s / 2 + pad && Math.abs(pt.y - cy) <= s / 2 + pad) return i;
    }
    return -1;
  };

  const onDown = (e) => {
    if (e.button !== 0 || drag.current) return;
    if (frozen.current) {
      frozen.current = null;
      wipe.current.p = 0;
      ink(frontRef.current, plate.current);
      ink(backRef.current, plate.current);
    }
    stopIntro();
    const pt = local(e);
    const i = hit(pt);
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = {
      id: e.pointerId,
      i,
      x0: pt.x,
      y0: pt.y,
      ox: i >= 0 ? sq.current[i].x : 0,
      oy: i >= 0 ? sq.current[i].y : 0,
      moved: false,
      samples: [{ x: pt.x, y: pt.y, t: performance.now() }],
    };
    if (i >= 0) plateRef.current.dataset.top = i === 0 ? "l" : "r";
  };

  const onMove = (e) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId || d.i < 0) return;
    const pt = local(e);
    const dx = pt.x - d.x0;
    const dy = pt.y - d.y0;
    if (!d.moved) {
      if (Math.hypot(dx, dy) < SLOP) return;
      d.moved = true;
      bridge.current.target = 0;
      rootRef.current.dataset.dragging = "";
    }
    const { w, h, s } = geo.current;
    const home = w * (d.i + 0.5);
    const cx = rubber(home + d.ox + dx, s / 2, 2 * w - s / 2, s);
    const cy = rubber(h / 2 + d.oy + dy, s / 2, h - s / 2, s);
    const sqr = sq.current[d.i];
    sqr.x = cx - home;
    sqr.y = cy - h / 2;
    const now = performance.now();
    d.samples.push({ x: pt.x, y: pt.y, t: now });
    while (d.samples.length > 2 && now - d.samples[0].t > 90) d.samples.shift();
    kick();
  };

  const onUp = (e) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    delete rootRef.current.dataset.dragging;
    if (d.moved) {
      const a = d.samples[0];
      const b = d.samples[d.samples.length - 1];
      const dt = Math.max(16, b.t - a.t) / 1000;
      const sqr = sq.current[d.i];
      sqr.vx = clamp((b.x - a.x) / dt, -3000, 3000);
      sqr.vy = clamp((b.y - a.y) / dt, -3000, 3000);
      kick();
      return;
    }
    if (e.type === "pointercancel") return;
    if (d.i >= 0) {
      const br = bridge.current;
      br.target = br.target > 0.5 ? 0 : 1;
      kick();
    } else {
      next();
    }
  };

  const onKey = (e) => {
    if (e.key === " " || e.key === "Enter" || e.key === "ArrowRight") {
      e.preventDefault();
      stopIntro();
      next();
    } else if (e.key === "b" || e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      stopIntro();
      bridge.current.target = bridge.current.target > 0.5 ? 0 : 1;
      kick();
    }
  };

  return (
    <div
      ref={rootRef}
      className="al"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onKeyDown={onKey}
      tabIndex={0}
      role="img"
      aria-label="Two coloured grounds side by side, each holding a square of the same ink that appears as two different colours."
    >
      <div ref={plateRef} className="al-plate">
        <Layer layerRef={backRef} className="al-layer--back" />
        <Layer layerRef={frontRef} className="al-layer--front" />
      </div>
      <div className="al-grain" aria-hidden="true" />
    </div>
  );
}
