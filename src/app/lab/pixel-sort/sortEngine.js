import { createSortSound } from "./sortAudio";

const N = 720;

function hash(x) {
  let h = Math.imul(x ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const PRESET = [
  [
    [0.24, 0.02],
    [0.3, 0.3],
    [0.42, 0.58],
    [0.5, 0.66],
  ],
  [
    [0.58, 0.0],
    [0.64, 0.22],
    [0.72, 0.4],
  ],
  [
    [0.8, 0.08],
    [0.86, 0.34],
    [0.96, 0.52],
  ],
];

export function createSorter({ surface, canvas, brush, onReady }) {
  const g = canvas.getContext("2d");
  const work = document.createElement("canvas");
  work.width = N;
  work.height = N;
  const wg = work.getContext("2d", { willReadFrequently: true });
  const prev = document.createElement("canvas");
  prev.width = N;
  prev.height = N;
  const pg = prev.getContext("2d");
  const base = document.createElement("canvas");
  base.width = N;
  base.height = N;
  const bg = base.getContext("2d", { willReadFrequently: true });
  const out = wg.createImageData(N, N);
  const orig = new Uint8ClampedArray(N * N * 4);
  const lum = new Uint8Array(N * N);
  const mask = new Uint8Array(N * N);
  const dirty = new Uint8Array(N);
  const keys = new Uint32Array(N);
  const jitter = new Float32Array(N);
  for (let x = 0; x < N; x += 1) jitter[x] = hash(x * 7 + 3) * 0.6 + hash(Math.floor(x / 5) + 911) * 0.4;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const state = {
    threshold: 0.04,
    size: 1,
    dpr: 1,
    raf: 0,
    anyDirty: false,
    fade: null,
    wipe: null,
    pointer: null,
    hover: null,
    loaded: false,
    destroyed: false,
    token: 0,
    lastSpeedAt: 0,
  };
  let audio = null;

  const sortColumn = (x) => {
    const th = Math.round(state.threshold * 255);
    const d = out.data;
    let y = 0;
    while (y < N) {
      const i = y * N + x;
      if (!mask[x * N + y] || lum[i] < th) {
        const o = i * 4;
        d[o] = orig[o];
        d[o + 1] = orig[o + 1];
        d[o + 2] = orig[o + 2];
        d[o + 3] = 255;
        y += 1;
        continue;
      }
      let end = y;
      let count = 0;
      while (end < N && mask[x * N + end] && lum[end * N + x] >= th) {
        keys[count] = (lum[end * N + x] << 16) | end;
        count += 1;
        end += 1;
      }
      const run = keys.subarray(0, count);
      run.sort();
      for (let k = 0; k < count; k += 1) {
        const from = (run[count - 1 - k] & 0xffff) * N + x;
        const to = (y + k) * N + x;
        const fo = from * 4;
        const t = to * 4;
        d[t] = orig[fo];
        d[t + 1] = orig[fo + 1];
        d[t + 2] = orig[fo + 2];
        d[t + 3] = 255;
      }
      y = end;
    }
  };

  const flush = () => {
    let x0 = N;
    let x1 = -1;
    for (let x = 0; x < N; x += 1) {
      if (!dirty[x]) continue;
      sortColumn(x);
      dirty[x] = 0;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
    }
    if (x1 >= x0) wg.putImageData(out, 0, 0, x0, 0, x1 - x0 + 1, N);
    state.anyDirty = false;
  };

  const markAll = () => {
    dirty.fill(1);
    state.anyDirty = true;
  };

  const paint = (px, anchor, py0, py1) => {
    const r = N * 0.05;
    const xa = Math.max(0, Math.floor(px - r));
    const xb = Math.min(N - 1, Math.ceil(px + r));
    for (let x = xa; x <= xb; x += 1) {
      const d = Math.abs(x - px) / r;
      if (d > 1) continue;
      const off = jitter[x] * N * 0.06 + d * d * N * 0.1;
      const col = x * N;
      const end = Math.round(py1 - off);
      if (py1 >= py0) {
        const top = Math.round(Math.min(anchor, py1) + jitter[(x * 13) % N] * N * 0.03);
        for (let y = Math.max(0, top); y < Math.min(N, end); y += 1) mask[col + y] = 1;
      } else {
        for (let y = Math.max(0, end); y < N && mask[col + y]; y += 1) mask[col + y] = 0;
      }
      dirty[x] = 1;
    }
    state.anyDirty = true;
  };

  const stroke = (anchor, x0, y0, x1, y1) => {
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / (N * 0.012)));
    let py = y0;
    for (let i = 1; i <= steps; i += 1) {
      const t = i / steps;
      const x = x0 + (x1 - x0) * t;
      const y = y0 + (y1 - y0) * t;
      paint(x, anchor, py, y);
      py = y;
    }
  };

  const applyPreset = () => {
    mask.fill(0);
    for (const path of PRESET) {
      for (let i = 1; i < path.length; i += 1) stroke(path[0][1] * N, path[i - 1][0] * N, path[i - 1][1] * N, path[i][0] * N, path[i][1] * N);
    }
    markAll();
  };

  const resize = () => {
    const rect = surface.getBoundingClientRect();
    state.size = Math.max(1, rect.width);
    state.dpr = Math.min(2, window.devicePixelRatio || 1);
    const px = Math.round(state.size * state.dpr);
    canvas.width = px;
    canvas.height = px;
    wake();
  };

  const render = (now) => {
    const s = canvas.width;
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = "high";
    g.globalAlpha = 1;
    g.drawImage(work, 0, 0, s, s);
    if (state.wipe) {
      const p = Math.min(1, (now - state.wipe.start) / state.wipe.dur);
      const e = 1 - Math.pow(1 - p, 3);
      const h = Math.round(e * N);
      if (h > 0) g.drawImage(base, 0, 0, N, h, 0, 0, s, (h / N) * s);
      if (p >= 1) {
        state.wipe = null;
        mask.fill(0);
        markAll();
        flush();
        g.drawImage(work, 0, 0, s, s);
      }
    }
    if (state.fade) {
      const p = Math.min(1, (now - state.fade.start) / state.fade.dur);
      g.globalAlpha = 1 - p * p * (3 - 2 * p);
      g.drawImage(prev, 0, 0, s, s);
      g.globalAlpha = 1;
      if (p >= 1) state.fade = null;
    }
  };

  const step = (now) => {
    state.raf = 0;
    if (state.destroyed) return;
    if (state.anyDirty) flush();
    render(now);
    if (state.wipe || state.fade || state.anyDirty) state.raf = requestAnimationFrame(step);
  };

  function wake() {
    if (state.destroyed || state.raf || !state.loaded) return;
    state.raf = requestAnimationFrame(step);
  }

  const toWork = (e) => {
    const rect = surface.getBoundingClientRect();
    return [((e.clientX - rect.left) / rect.width) * N, ((e.clientY - rect.top) / rect.height) * N, rect];
  };

  const showBrush = (e) => {
    const rect = surface.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    brush.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    brush.style.setProperty("--pixel-sort-brush-w", `${rect.width * 0.1}px`);
  };

  const onDown = (e) => {
    if (!state.loaded || state.wipe) return;
    surface.setPointerCapture?.(e.pointerId);
    const [x, y] = toWork(e);
    state.pointer = { id: e.pointerId, x, y, anchor: y, t: performance.now() };
    surface.dataset.dragging = "";
    showBrush(e);
  };

  const onMove = (e) => {
    if (e.pointerType === "mouse") {
      surface.dataset.hover = "";
      showBrush(e);
    }
    const p = state.pointer;
    if (!p || p.id !== e.pointerId) return;
    if (e.pointerType !== "mouse") showBrush(e);
    const [x, y] = toWork(e);
    const now = performance.now();
    const dt = Math.max(8, now - p.t);
    const speed = Math.hypot(x - p.x, y - p.y) / N / (dt / 1000);
    if (y < p.anchor) p.anchor = y;
    stroke(p.anchor, p.x, p.y, x, y);
    audio?.drag(speed / 2.2, y / N, x / N, y < p.y);
    p.x = x;
    p.y = y;
    p.t = now;
    wake();
  };

  const onUp = (e) => {
    const p = state.pointer;
    if (!p || p.id !== e.pointerId) return;
    state.pointer = null;
    delete surface.dataset.dragging;
    if (surface.hasPointerCapture?.(e.pointerId)) surface.releasePointerCapture(e.pointerId);
    audio?.release();
  };

  const onLeave = (e) => {
    if (e.pointerType === "mouse") delete surface.dataset.hover;
  };

  const kb = { x: N * 0.5, y: N * 0.3 };
  const onKey = (e) => {
    const s = e.shiftKey ? N * 0.12 : N * 0.04;
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      kb.x = Math.max(0, Math.min(N, kb.x + (e.key === "ArrowLeft" ? -s : s)));
      kb.y = N * 0.3;
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const ny = Math.max(0, Math.min(N * 1.2, kb.y + (e.key === "ArrowUp" ? -s : s)));
      stroke(N * 0.02, kb.x, kb.y, kb.x, ny);
      kb.y = ny;
      wake();
    }
  };

  surface.addEventListener("pointerdown", onDown);
  surface.addEventListener("pointermove", onMove);
  surface.addEventListener("pointerup", onUp);
  surface.addEventListener("pointercancel", onUp);
  surface.addEventListener("pointerleave", onLeave);
  surface.addEventListener("keydown", onKey);
  const ro = new ResizeObserver(resize);
  ro.observe(surface);

  const load = (src, first) => {
    state.token += 1;
    const token = state.token;
    const img = new Image();
    img.decoding = "async";
    img.src = src;
    return img
      .decode()
      .then(() => {
        if (state.destroyed || token !== state.token) return;
        if (!first) {
          pg.clearRect(0, 0, N, N);
          pg.drawImage(canvas, 0, 0, N, N);
        }
        bg.imageSmoothingQuality = "high";
        bg.drawImage(img, 0, 0, N, N);
        const data = bg.getImageData(0, 0, N, N).data;
        orig.set(data);
        for (let i = 0; i < N * N; i += 1) {
          const o = i * 4;
          lum[i] = Math.round(0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2]);
        }
        if (first) applyPreset();
        markAll();
        flush();
        if (!first) state.fade = { start: performance.now(), dur: reduced ? 1 : 360 };
        state.loaded = true;
        resize();
        render(performance.now());
        if (first) onReady?.();
        wake();
      })
      .catch(() => {});
  };

  return {
    start(src) {
      return load(src, true);
    },
    setCover(src) {
      audio?.click();
      return load(src, false);
    },
    setThreshold(v) {
      state.threshold = v;
      markAll();
      wake();
    },
    reset() {
      if (!state.loaded || state.wipe) return;
      audio?.sweep();
      state.wipe = { start: performance.now(), dur: reduced ? 1 : 520 };
      wake();
    },
    async setSound(on) {
      if (on && !audio) audio = createSortSound();
      if (!audio) return false;
      return audio.setEnabled(on);
    },
    destroy() {
      state.destroyed = true;
      cancelAnimationFrame(state.raf);
      ro.disconnect();
      surface.removeEventListener("pointerdown", onDown);
      surface.removeEventListener("pointermove", onMove);
      surface.removeEventListener("pointerup", onUp);
      surface.removeEventListener("pointercancel", onUp);
      surface.removeEventListener("pointerleave", onLeave);
      surface.removeEventListener("keydown", onKey);
      audio?.destroy();
      audio = null;
    },
  };
}
