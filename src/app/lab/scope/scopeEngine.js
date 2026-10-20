import { createScopeSound } from "./scopeAudio";
import { MAX_SEGMENTS, createScopeGL } from "./scopeGL";
import { SHAPES, buildTable, canDraw, textStrokes } from "./scopeGlyphs";
import { ScopeSynth } from "./scopeSynth";

const SIZE = 2048;
const SIM_RATE = 48000;
const TAU = 0.075;
const HOLD = 3.4;
const MORPH = 0.7;
const IDLE = 9;
const MAX_CHARS = 14;
const SCALE = [55, 65.41, 73.42, 82.41, 98];

const ATTRACT = [
  { text: "let it be", freq: 65.41 },
  { shape: "record", freq: 98 },
  { text: "something", freq: 55 },
  { shape: "sun", freq: 87.31 },
  { text: "in my life", freq: 65.41 },
  { shape: "apple", freq: 98, spin: 1 },
  { text: "yesterday", freq: 55 },
  { shape: "heart", freq: 87.31, spin: 1 },
  { text: "help!", freq: 65.41 },
  { shape: "lissajous", freq: 98 },
  { text: "because", freq: 55 },
  { shape: "record", freq: 87.31 },
];

export function createScope(stage, { embedded = false, caption = null, input = null, onLive = () => {}, onFail = () => {}, onGesture = () => {} } = {}) {
  const root = document.createElement("div");
  root.className = "scope-screen";
  if (embedded) root.tabIndex = 0;
  root.setAttribute("role", "img");
  const canvas = document.createElement("canvas");
  canvas.className = "scope-canvas";
  root.append(canvas);
  stage.append(root);

  const gl = createScopeGL(canvas);
  if (!gl) {
    root.remove();
    onFail();
    return { destroy() {}, setSound: async () => false };
  }

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const sim = new ScopeSynth(SIZE);
  const simX = new Float32Array(4096);
  const simY = new Float32Array(4096);
  const segs = new Float32Array(MAX_SEGMENTS * 4);
  const energy = new Float32Array(MAX_SEGMENTS);
  const tableCache = new Map();
  let sound = null;

  let W = 0;
  let H = 0;
  let dpr = 1;
  let rows = 8;
  let pathLen = 8;
  let pathLenTarget = 8;
  let lastPx = null;
  let raf = 0;
  let last = 0;
  let visible = !document.hidden;
  let onscreen = true;
  let destroyed = false;
  let ready = false;
  let item = 0;
  let nextAt = 0;
  let clock = 0;
  let typed = "";
  let typedAt = -Infinity;
  let gestured = false;

  const tableFor = (key, make) => {
    if (tableCache.has(key)) return tableCache.get(key);
    const built = buildTable(make(), SIZE);
    if (tableCache.size > 64) tableCache.delete(tableCache.keys().next().value);
    tableCache.set(key, built);
    return built;
  };

  const show = (built, { morph, freq, glide, spin = 0 }) => {
    sim.setTarget(built.table, morph, freq, glide, spin);
    sound?.target({ table: built.table, morph, freq, glide, spin });
    pathLenTarget = Math.max(2, built.length);
  };

  const showItem = (i, morph) => {
    const it = ATTRACT[i];
    const built = it.text ? tableFor(`t:${it.text}`, () => textStrokes(it.text)) : tableFor(`s:${it.shape}`, SHAPES[it.shape]);
    show(built, { morph, freq: it.freq, glide: 0.35, spin: it.spin || 0 });
    onLive(it.text ? it.text : it.shape);
  };

  const showTyped = () => {
    if (!typed.trim()) {
      typedAt = -Infinity;
      nextAt = clock + 0.2;
      return;
    }
    const built = tableFor(`t:${typed}`, () => textStrokes(typed));
    const ch = typed[typed.length - 1];
    const freq = SCALE[(ch.charCodeAt(0) * 7) % SCALE.length];
    show(built, { morph: 0.16, freq, glide: 0.05, spin: 0 });
    onLive(typed);
  };

  const setTyped = (value) => {
    const clean = [...value.toLowerCase()].filter(canDraw).join("").replace(/^\s+/, "").slice(0, MAX_CHARS);
    if (input && input.value !== clean) input.value = clean;
    if (clean === typed) return;
    typed = clean;
    typedAt = clock;
    showTyped();
  };

  const gesture = () => {
    if (gestured) return;
    gestured = true;
    onGesture();
  };

  let sizeKey = "";
  const layout = (force) => {
    const sr = stage.getBoundingClientRect();
    if (!sr.width || !sr.height) return;
    const key = `${Math.round(sr.width)}x${Math.round(sr.height)}x${window.devicePixelRatio}`;
    if (!force && key === sizeKey) return;
    sizeKey = key;
    const narrow = sr.width < 640;
    const side = narrow ? 16 : 32;
    const bottom = narrow ? 56 : 64;
    if (caption) {
      caption.style.left = `${side}px`;
      caption.style.width = `${sr.width - side * 2}px`;
    }
    const capBottom = caption ? caption.getBoundingClientRect().bottom - sr.top : 0;
    const top = caption ? Math.round(capBottom + 24) : side;
    const availW = sr.width - side * 2;
    const availH = Math.max(200, sr.height - top - (caption ? bottom : side));
    rows = narrow ? Math.max(8, Math.min(12, Math.floor((availH / availW) * 10))) : 8;
    let w = Math.min(availW, (availH * 10) / rows);
    let h = (w * rows) / 10;
    w = Math.round(w);
    h = Math.round(h);
    const left = Math.round((sr.width - w) / 2);
    const y = narrow ? top : Math.round(top + Math.max(0, (availH - h) * 0.3));
    if (caption && !narrow) {
      caption.style.left = `${left}px`;
      caption.style.width = `${w}px`;
    }
    root.style.left = `${left}px`;
    root.style.top = `${y}px`;
    root.style.width = `${w}px`;
    root.style.height = `${h}px`;
    const maxScale = Math.min(window.devicePixelRatio || 1, 2);
    dpr = Math.min(maxScale, Math.sqrt(3200000 / (w * h)));
    W = Math.round(w * dpr);
    H = Math.round(h * dpr);
    gl.resize(W, H);
    lastPx = null;
  };

  const toPx = (x, y) => [(x / 1.25 * 0.5 + 0.5) * W, (y / (rows * 0.125) * 0.5 + 0.5) * H];

  const deposit = (xs, ys, n, rate) => {
    let count = 0;
    const e = 9000 / rate;
    let prev = lastPx;
    for (let i = 0; i < n && count < MAX_SEGMENTS; i += 1) {
      const p = toPx(xs[i], ys[i]);
      if (prev) {
        segs[count * 4] = prev[0];
        segs[count * 4 + 1] = prev[1];
        segs[count * 4 + 2] = p[0];
        segs[count * 4 + 3] = p[1];
        energy[count] = e;
        count += 1;
      }
      prev = p;
    }
    lastPx = prev;
    return count;
  };

  const frame = () => {
    const now = performance.now();
    raf = 0;
    if (destroyed) return;
    const raw = Math.min(0.25, Math.max(0.001, (now - last) / 1000));
    last = now;
    const dt = Math.min(raw, 1 / 20);
    clock += dt;

    if (typed && clock - typedAt > IDLE) {
      typed = "";
      if (input) input.value = "";
      typedAt = -Infinity;
      nextAt = clock;
    }
    if (!typed && clock >= nextAt) {
      showItem(item, reduced ? 0.01 : MORPH);
      item = (item + 1) % ATTRACT.length;
      nextAt = clock + HOLD;
    }

    const simCount = Math.min(4096, Math.round(SIM_RATE * dt));
    sim.render(simX, simY, simCount, SIM_RATE);
    let count;
    if (sound && sound.live) {
      const got = sound.read(Math.round(sound.sampleRate * dt));
      count = got ? deposit(got.x, got.y, got.n, sound.sampleRate) : deposit(simX, simY, simCount, SIM_RATE);
    } else {
      count = deposit(simX, simY, simCount, SIM_RATE);
    }

    pathLen += (pathLenTarget - pathLen) * (1 - Math.exp(-dt / 0.35));
    const pxPerUnit = W / 2.5;
    const sigma = Math.max(1.1, 1.3 * dpr);
    const exposure = 26 * Math.pow((pathLen * pxPerUnit) / 3000, 0.72) * (sigma / 1.2);
    gl.render({ segs, energy, count, decayFactor: Math.exp(-raw / TAU), sigma, exposure, time: now / 1000, dpr, rows, radius: 14 * dpr });
    raf = requestAnimationFrame(frame);
  };

  function wake() {
    if (destroyed || raf || !visible || !onscreen || !ready) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }

  const sleep = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  };

  const editable = (t) => t && t !== root && t !== document.body && t !== input && (t.closest?.("button, input, textarea, a, select") || t.isContentEditable);

  const onKey = (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target === input) return;
    if (editable(e.target)) return;
    const k = e.key;
    if (k === "Backspace") {
      gesture();
      setTyped(typed.slice(0, -1));
      e.preventDefault();
    } else if (k === "Escape") {
      setTyped("");
    } else if (k.length === 1 && canDraw(k.toLowerCase())) {
      gesture();
      setTyped(typed + k);
      e.preventDefault();
    }
  };

  const onInput = () => {
    gesture();
    setTyped(input.value);
  };

  const onInputKey = (e) => {
    if (e.key === "Escape") {
      setTyped("");
      input.blur();
    } else if (e.key === "Enter") {
      input.blur();
    }
  };

  const onDown = () => {
    gesture();
    if (input) input.focus({ preventScroll: true });
  };

  const onVisibility = () => {
    visible = !document.hidden;
    if (visible) wake();
    else sleep();
  };

  root.addEventListener("pointerdown", onDown);
  const keyTarget = embedded ? root : window;
  keyTarget.addEventListener("keydown", onKey);
  input?.addEventListener("input", onInput);
  input?.addEventListener("keydown", onInputKey);
  document.addEventListener("visibilitychange", onVisibility);
  const ro = new ResizeObserver(() => {
    if (ready) layout(false);
  });
  ro.observe(stage);
  const io = new IntersectionObserver(([entry]) => {
    onscreen = entry.isIntersecting;
    if (onscreen) wake();
    else sleep();
  });
  io.observe(root);

  layout(true);
  showItem(0, 0);
  item = 1;
  nextAt = HOLD;
  sim.phase = 0;
  const pre = Math.round(SIM_RATE * 0.03);
  for (let i = 0; i < 8; i += 1) {
    sim.render(simX, simY, pre, SIM_RATE);
    const count = deposit(simX, simY, pre, SIM_RATE);
    pathLen = pathLenTarget;
    const sigma = Math.max(1.1, 1.3 * dpr);
    gl.render({ segs, energy, count, decayFactor: Math.exp(-0.03 / TAU), sigma, exposure: 26 * Math.pow((pathLen * (W / 2.5)) / 3000, 0.72) * (sigma / 1.2), time: 0, dpr, rows, radius: 14 * dpr });
  }
  ready = true;
  root.dataset.ready = "";
  wake();

  return {
    async setSound(on) {
      if (on && !sound) sound = createScopeSound(SIZE);
      if (!sound) return false;
      const state = { cur: sim.cur, next: sim.next, morph: sim.morph, morphRate: sim.morphRate, phase: sim.phase, freq: sim.freq, freqTarget: sim.freqTarget, glide: sim.glide, spin: sim.spin, spinTarget: sim.spinTarget, angle: sim.angle };
      return sound.setEnabled(on, state);
    },
    destroy() {
      destroyed = true;
      sleep();
      ro.disconnect();
      io.disconnect();
      root.removeEventListener("pointerdown", onDown);
      keyTarget.removeEventListener("keydown", onKey);
      input?.removeEventListener("input", onInput);
      input?.removeEventListener("keydown", onInputKey);
      document.removeEventListener("visibilitychange", onVisibility);
      sound?.destroy();
      gl.dispose();
      root.remove();
    },
  };
}
