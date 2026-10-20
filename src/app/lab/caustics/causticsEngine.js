import { caretPoint, markingLayout, paintFloor } from "./causticsFloor";
import { createCausticsGL } from "./causticsGL";

const DEFAULT_TEXT = "deep end";
const MAX_CHARS = 16;
const SIM_HZ = 120;
const DAMPING = 0.995;
const DEPTH = 380;
const ETAS = [1 / 1.326, 1 / 1.333, 1 / 1.342];
const SUN = (() => {
  const el = (80 * Math.PI) / 180;
  const az = (-128 * Math.PI) / 180;
  return [Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)];
})();
const WAVES = [
  { len: 280, focus: 0.03, dir: 18, phase: 0.3 },
  { len: 196, focus: 0.06, dir: 155, phase: 2.1 },
  { len: 150, focus: 0.1, dir: 293, phase: 4.0 },
  { len: 118, focus: 0.14, dir: 70, phase: 1.2 },
  { len: 96, focus: 0.16, dir: 208, phase: 5.1 },
  { len: 80, focus: 0.16, dir: 346, phase: 3.3 },
  { len: 67, focus: 0.14, dir: 123, phase: 0.8 },
  { len: 57, focus: 0.11, dir: 261, phase: 2.6 },
  { len: 48, focus: 0.08, dir: 39, phase: 4.7 },
];
const G = 3920;
const TIME_SCALE = 0.32;
const AMBIENT_FOCUS = 1.8;
const FOCUS_CURVE = 1 / (DEPTH * (1 - 1 / 1.333));

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function srgbToLinear(c) {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

const linear = (rgb) => rgb.map(srgbToLinear);

export function createCaustics({ box, canvas, embedded, onReady, onText }) {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let gl = createCausticsGL(canvas);
  if (!gl) throw new Error("WebGL2 unavailable");

  const floorCanvas = document.createElement("canvas");
  const measure = floorCanvas.getContext("2d");
  const family = getComputedStyle(box).fontFamily || "system-ui, sans-serif";
  const view = { width: 1, height: 1, dpr: 1, unit: 1 };
  const waves = new Float32Array(WAVES.length * 4);
  const sim = { w: 0, h: 0, cs: 4, a: null, b: null, v: null, out: null, active: false, acc: 0, quiet: 0 };
  let text = DEFAULT_TEXT;
  let layout = null;
  let fontReady = false;
  const LADDER = [
    { chroma: true, mesh: 3, quality: 1 },
    { chroma: false, mesh: 3, quality: 1 },
    { chroma: false, mesh: 4, quality: 0.85 },
    { chroma: false, mesh: 5, quality: 0.72 },
    { chroma: false, mesh: 7, quality: 0.6 },
    { chroma: false, mesh: 9, quality: 0.5 },
  ];
  let rung = gl.software ? 4 : 0;
  let quality = LADDER[rung].quality;
  const calib = { gaps: [], expect: 0 };
  let visible = false;
  let raf = 0;
  let last = 0;
  let lastRender = 0;
  let clock = 0;
  let destroyed = false;
  let ready = false;
  let fade = reduced ? 1 : 0;
  let drag = null;
  let introAt = reduced ? -1 : 0.7;
  let readySentFlag = false;
  let edited = false;

  function allocSim() {
    const cs = Math.max(3, Math.min(6, Math.max(view.width, view.height) / 340));
    const w = Math.max(8, Math.ceil(view.width / cs));
    const h = Math.max(8, Math.ceil(view.height / cs));
    sim.cs = cs;
    sim.w = w;
    sim.h = h;
    sim.a = new Float32Array(w * h);
    sim.b = new Float32Array(w * h);
    sim.v = new Float32Array(w * h);
    sim.out = new Float32Array(w * h * 4);
    sim.active = false;
    gl?.uploadSim(sim.out, w, h);
  }

  function stepSim() {
    const { w, h, a, b, v } = sim;
    let peak = 0;
    for (let y = 0; y < h; y += 1) {
      const row = y * w;
      const up = (y > 0 ? y - 1 : 0) * w;
      const down = (y < h - 1 ? y + 1 : h - 1) * w;
      for (let x = 0; x < w; x += 1) {
        const i = row + x;
        const l = a[row + (x > 0 ? x - 1 : 0)];
        const r = a[row + (x < w - 1 ? x + 1 : w - 1)];
        const avg = (l + r + a[up + x] + a[down + x]) * 0.25;
        let vel = (v[i] + (avg - a[i]) * 2) * DAMPING;
        v[i] = vel;
        const nh = a[i] + vel;
        b[i] = nh;
        if (vel < 0) vel = -vel;
        if (vel > peak) peak = vel;
      }
    }
    sim.a = b;
    sim.b = a;
    return peak;
  }

  function packSim() {
    const { w, h, a, out, cs } = sim;
    const inv = 1 / (2 * cs);
    for (let y = 0; y < h; y += 1) {
      const row = y * w;
      const up = (y > 0 ? y - 1 : 0) * w;
      const down = (y < h - 1 ? y + 1 : h - 1) * w;
      for (let x = 0; x < w; x += 1) {
        const i = row + x;
        const k = i * 4;
        out[k] = a[i];
        out[k + 1] = (a[row + (x < w - 1 ? x + 1 : w - 1)] - a[row + (x > 0 ? x - 1 : 0)]) * inv;
        out[k + 2] = (a[down + x] - a[up + x]) * inv;
      }
    }
    gl.uploadSim(out, w, h);
  }

  function addDrop(px, py, radius, strength) {
    const { w, h, a, cs } = sim;
    if (!a || py < (view.deck || 0) + 4) return;
    const cx = px / cs - 0.5;
    const cy = py / cs - 0.5;
    const rc = radius / cs;
    const x0 = Math.max(0, Math.floor(cx - rc));
    const x1 = Math.min(w - 1, Math.ceil(cx + rc));
    const y0 = Math.max(0, Math.floor(cy - rc));
    const y1 = Math.min(h - 1, Math.ceil(cy + rc));
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const d = Math.hypot(x - cx, y - cy) / rc;
        if (d >= 1) continue;
        const bump = 0.5 - Math.cos((1 - d) * Math.PI) * 0.5;
        a[y * w + x] += bump * strength;
      }
    }
    sim.active = true;
    sim.quiet = 0;
    wake();
  }

  function setWaves(t) {
    WAVES.forEach((wave, i) => {
      const len = wave.len * view.unit;
      const k = (Math.PI * 2) / len;
      const amp = (wave.focus * AMBIENT_FOCUS * FOCUS_CURVE) / (k * k);
      const omega = Math.sqrt((G / view.unit) * k) * TIME_SCALE;
      const ang = (wave.dir * Math.PI) / 180;
      waves[i * 4] = Math.cos(ang) * k;
      waves[i * 4 + 1] = Math.sin(ang) * k;
      waves[i * 4 + 2] = amp;
      waves[i * 4 + 3] = wave.phase - omega * t;
    });
  }

  function repaint() {
    layout = paintFloor(floorCanvas, {
      width: view.width,
      height: view.height,
      scale: Math.min(2, view.dpr * 1.25),
      text,
      family,
    });
    gl?.uploadFloor(floorCanvas);
  }

  function layoutView() {
    const rect = box.getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    const changed = Math.abs(w - view.width) > 0.5 || Math.abs(h - view.height) > 0.5;
    view.width = w;
    view.height = h;
    view.unit = clamp(Math.min(w, h) / 760, 0.62, 1.15);
    const head = box.querySelector(".caustics-head");
    view.deck = head ? Math.round(head.getBoundingClientRect().bottom - rect.top + 36) : 0;
    const dprCap = Math.min(window.devicePixelRatio || 1, 2);
    const budget = Math.sqrt(2200000 / (w * h));
    view.dpr = Math.max(0.6, Math.min(dprCap, budget));
    applyQuality(quality);
    if (changed || !sim.a) allocSim();
    if (fontReady) repaint();
  }

  function applyQuality(q) {
    quality = q;
    gl?.resize(Math.max(1, Math.round(view.width * view.dpr * q)), Math.max(1, Math.round(view.height * view.dpr * q)));
  }

  function watchQuality(gap, expect) {
    if (gap > 1000) return;
    calib.gaps.push(gap);
    calib.expect += expect;
    if (calib.gaps.length < 12) return;
    const mean = calib.gaps.reduce((sum, g) => sum + g, 0) / calib.gaps.length;
    const want = calib.expect / calib.gaps.length;
    calib.gaps = [];
    calib.expect = 0;
    if (mean > want * 1.8 + 8 && rung < LADDER.length - 1) {
      rung += 1;
      applyQuality(LADDER[rung].quality);
    }
  }

  function render() {
    const cScale = Math.min(1.5, view.dpr) * quality;
    const margin = 130 * view.unit;
    gl.draw({
      stage: [view.width, view.height],
      targetW: Math.max(1, Math.round(view.width * cScale)),
      targetH: Math.max(1, Math.round(view.height * cScale)),
      meshCols: Math.max(16, Math.round((view.width + margin * 2) / LADDER[rung].mesh)),
      meshRows: Math.max(16, Math.round((view.height + margin * 2) / LADDER[rung].mesh)),
      margin,
      waves,
      simSpan: [sim.w * sim.cs, sim.h * sim.cs],
      surfW: sim.w,
      surfH: sim.h,
      cell: sim.cs,
      simOn: sim.active,
      sun: SUN,
      etas: ETAS,
      chroma: LADDER[rung].chroma,
      depth: DEPTH * view.unit,
      viewDepth: DEPTH * view.unit * 0.62,
      absorb: [0.95 / (DEPTH * 1.6), 0.2 / (DEPTH * 1.6), 0.12 / (DEPTH * 1.6)].map((x) => x / view.unit),
      ambient: [0.22, 0.24, 0.25],
      sunColor: [0.8, 0.78, 0.72],
      sky: linear([226, 238, 246]),
      ground: linear([214, 234, 236]),
      fade: 1 - Math.pow(1 - fade, 3),
      deck: view.deck,
      stone: linear([240, 236, 228]),
    });
  }

  function frame(now) {
    raf = 0;
    if (!gl || !visible || document.hidden || destroyed) return;
    const dt = last ? clamp((now - last) / 1000, 0, 0.1) : 0;
    last = now;
    const ambient = !reduced;
    if (ambient) clock += dt;
    if (introAt > 0 && ready) {
      introAt -= dt;
      if (introAt <= 0 && layout) {
        introAt = -1;
        addDrop(view.width * 0.5, layout.baseline - layout.size * 0.9, 16 * view.unit, 1.1);
      }
    }
    if (ready && fade < 1) fade = Math.min(1, fade + dt / 0.9);
    if (sim.active) {
      sim.acc = Math.min(sim.acc + dt * SIM_HZ, 4);
      let peak = 1;
      let steps = 0;
      while (sim.acc >= 1) {
        sim.acc -= 1;
        peak = stepSim();
        steps += 1;
      }
      if (steps) {
        if (peak < 0.0006 && !drag) {
          sim.quiet += 1;
          if (sim.quiet > 30) {
            sim.active = false;
            sim.a.fill(0);
            sim.b.fill(0);
            sim.v.fill(0);
          }
        } else sim.quiet = 0;
        packSim();
      }
    }
    if (drag) flushDrag();
    const busy = Boolean(drag) || sim.active || (ready && fade < 1) || introAt > 0;
    const idleGap = busy ? 0 : 33;
    if (ready && now - lastRender >= idleGap - 2) {
      setWaves(clock);
      render();
      if (lastRender && !reduced) watchQuality(now - lastRender, busy ? 16.7 : 33);
      lastRender = now;
      if (!readySentFlag && fade > 0) {
        readySentFlag = true;
        onReady?.();
      }
    }
    if (busy || ambient) raf = requestAnimationFrame(frame);
  }
  function wake() {
    if (raf || !gl || !visible || document.hidden || destroyed) return;
    last = 0;
    raf = requestAnimationFrame(frame);
  }

  function local(e) {
    const r = box.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  function flushDrag() {
    const d = drag;
    if (!d || !d.pending.length) return;
    const pts = d.pending;
    d.pending = [];
    const spacing = Math.max(4, sim.cs * 1.6);
    let budget = 80;
    for (const [x, y, t] of pts) {
      const elapsed = Math.max(0.004, t - d.pt);
      d.speed += (Math.hypot(x - d.px, y - d.py) / elapsed - d.speed) * 0.3;
      d.px = x;
      d.py = y;
      d.pt = t;
      const strength = clamp(d.speed / 500, 0.5, 2.2);
      let dist = Math.hypot(x - d.x, y - d.y);
      while (dist >= spacing && budget > 0) {
        d.x += ((x - d.x) / dist) * spacing;
        d.y += ((y - d.y) / dist) * spacing;
        addDrop(d.x, d.y, 10 * view.unit, strength);
        budget -= 1;
        dist = Math.hypot(x - d.x, y - d.y);
      }
      if (budget <= 0) {
        d.x = x;
        d.y = y;
      }
    }
  }

  function onDown(e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (drag) return;
    canvas.setPointerCapture?.(e.pointerId);
    const [x, y] = local(e);
    drag = { id: e.pointerId, x, y, px: x, py: y, pt: e.timeStamp / 1000, speed: 0, pending: [] };
    box.dataset.grabbing = "";
    addDrop(x, y, 24 * view.unit, 3.6);
  }

  function onMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    const list = events.length ? events : [e];
    for (const ev of list) {
      const [x, y] = local(ev);
      drag.pending.push([x, y, ev.timeStamp / 1000]);
    }
    wake();
  }

  function onUp(e) {
    if (!drag || e.pointerId !== drag.id) return;
    flushDrag();
    drag = null;
    delete box.dataset.grabbing;
  }

  function setText(next) {
    text = next;
    onText?.(text);
    repaint();
    wake();
  }

  function onKey(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (!layout) return;
    if (e.key === "Backspace") {
      e.preventDefault();
      edited = true;
      if (!text.length) return;
      const point = caretPoint(layout, text, family, measure);
      setText(text.slice(0, -1));
      addDrop(point[0], point[1], 14 * view.unit, 0.7);
      return;
    }
    if (e.key === "Escape") {
      if (text === DEFAULT_TEXT) return;
      edited = false;
      setText(DEFAULT_TEXT);
      addDrop(view.width / 2, layout.baseline - layout.size * 0.4, 18 * view.unit, 1);
      return;
    }
    if (e.key.length !== 1 || !/^[\p{L}\p{N} .,'!?&+-]$/u.test(e.key)) return;
    e.preventDefault();
    if (edited && text.length >= MAX_CHARS) return;
    if (edited && e.key === " " && (!text.length || text.endsWith(" "))) return;
    const fresh = !edited;
    edited = true;
    if (fresh && e.key === " ") return;
    const next = (fresh ? "" : text) + e.key.toLowerCase();
    const nextLayout = markingLayout({ width: view.width, height: view.height, text: next, family, measure });
    setText(next);
    const point = caretPoint(nextLayout, next, family, measure);
    addDrop(point[0] - nextLayout.size * 0.24, point[1], 14 * view.unit, 0.8);
  }

  function onWindowKey(e) {
    if (embedded || e.defaultPrevented) return;
    const el = document.activeElement;
    if (el && el !== document.body && el !== canvas) return;
    if (el === canvas) return;
    onKey(e);
  }

  layoutView();

  document.fonts
    .load(`600 120px ${family}`, "deep end")
    .catch(() => null)
    .then(() => {
      if (destroyed || !gl) return;
      fontReady = true;
      repaint();
      ready = true;
      wake();
    });

  const io = new IntersectionObserver(
    ([entry]) => {
      visible = entry.isIntersecting;
      if (visible) {
        last = 0;
        if (!raf) raf = requestAnimationFrame(frame);
      } else if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    },
    { rootMargin: "80px" },
  );
  io.observe(box);
  const ro = new ResizeObserver(() => {
    layoutView();
    if (ready && gl) {
      setWaves(clock);
      render();
    }
    if (visible && !raf) raf = requestAnimationFrame(frame);
  });
  ro.observe(box);
  const headEl = box.querySelector(".caustics-head");
  if (headEl) ro.observe(headEl);
  const onVisibility = () => {
    if (document.hidden) {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    } else wake();
  };
  document.addEventListener("visibilitychange", onVisibility);
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);
  canvas.addEventListener("lostpointercapture", onUp);
  canvas.addEventListener("keydown", onKey);
  window.addEventListener("keydown", onWindowKey);

  return {
    destroy() {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      io.disconnect();
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("lostpointercapture", onUp);
      canvas.removeEventListener("keydown", onKey);
      window.removeEventListener("keydown", onWindowKey);
      gl?.destroy();
      gl = null;
    },
  };
}
