import { albumById } from "@/app/lab/_music/catalog";

import { ATLAS_COLS, buildAtlas, coverTarget, glyphIndex, simplex, wordTarget } from "./fieldArt";
import { createFieldSound } from "./fieldAudio";
import { createFieldGL } from "./fieldGL";

const SEQUENCE = [
  { word: "still here?" },
  { cover: "with-the-beatles" },
  { word: "stay a while" },
  { cover: "revolver" },
  { word: "breathe" },
  { cover: "let-it-be" },
  { word: "you are loved" },
  { cover: "abbey-road" },
  { word: "come home" },
  { cover: "help" },
  { word: "it gets softer" },
  { cover: "rubber-soul" },
];
const CROPS = {
  "with-the-beatles": { crop: [0.01, 0.14, 0.955, 0.85], gamma: 0.8 },
  revolver: { crop: [0, 0, 1, 0.88], gamma: 1.1 },
  "let-it-be": { crop: [0.04, 0.1, 0.92, 0.86], gamma: 0.85 },
  "abbey-road": { crop: [0, 0.3, 1, 0.7], gamma: 0.9 },
  help: { crop: [0.02, 0.3, 0.96, 0.6], gamma: 1 },
  "rubber-soul": { crop: [0, 0, 1, 1], gamma: 0.75 },
};
const COVERS = Object.keys(CROPS);
const FLOW = 3.2;
const FIRST_FLOW = 1.4;
const GATHER = 2.6;
const HOLD = 3.4;
const DISSOLVE = 2.4;
const SPREAD = 0.75;
const MAX_TYPED = 18;
const COMMIT_IDLE = 2.2;

const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

export function createField(stage, { embedded = false, caption = null, input = null, onLive = () => {}, onFail = () => {}, onGesture = () => {} } = {}) {
  const root = document.createElement("div");
  root.className = "field-screen";
  if (embedded) root.tabIndex = 0;
  root.setAttribute("role", "img");
  root.setAttribute("aria-label", "A field of characters flowing like wind, gathering into words and Beatles covers");
  const canvas = document.createElement("canvas");
  canvas.className = "field-canvas";
  root.append(canvas);
  stage.append(root);

  const gl = createFieldGL(canvas);
  if (!gl) {
    root.remove();
    onFail();
    return { destroy() {}, setSound: async () => false };
  }

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const images = new Map();
  const targetCache = new Map();
  let sound = null;

  let Wc = 0;
  let Hc = 0;
  let dpr = 1;
  let cwD = 8;
  let chD = 14;
  let cw = 8;
  let ch = 14;
  let cols = 0;
  let rows = 0;
  let ox = 0;
  let oy = 0;
  let region = { x: 0, y: 0, w: 1, h: 1 };
  let ramp = new Uint8Array([0]);
  let cells = new Uint8Array(0);
  let dens = new Float32Array(0);
  let counts = new Uint16Array(0);
  let capMask = new Float32Array(0);
  let jitter = new Int8Array(0);
  let disturb = new Float32Array(0);
  let psi = new Float32Array(0);
  let fvx = new Float32Array(0);
  let fvy = new Float32Array(0);
  let promptRow = 0;
  let promptCol = 2;
  let fresh = true;

  let N = 0;
  let px = new Float32Array(0);
  let py = new Float32Array(0);
  let vx = new Float32Array(0);
  let vy = new Float32Array(0);
  let tx = new Float32Array(0);
  let ty = new Float32Array(0);
  let key = new Float32Array(0);
  let free = new Uint8Array(0);

  let raf = 0;
  let last = 0;
  let clock = 0;
  let visible = !document.hidden;
  let onscreen = true;
  let destroyed = false;
  let ready = false;
  let fade = 0;

  let phase = "flow";
  let phaseT = 0;
  let phaseLen = FIRST_FLOW;
  let G = 0;
  let seq = 0;
  let current = null;
  let pending = null;
  let target = null;

  let typed = "";
  let typedAt = -Infinity;
  let focused = false;
  let gestured = false;

  const pointer = { x: 0, y: 0, vx: 0, vy: 0, at: -Infinity, down: false, type: "mouse", startX: 0, startY: 0, startAt: 0 };
  let stir = 0;

  let rng = 987654321;
  const rand = () => {
    rng = (rng * 1664525 + 1013904223) >>> 0;
    return rng / 4294967296;
  };

  const loadCovers = () => {
    for (const id of COVERS) {
      const album = albumById(id);
      if (!album) continue;
      const img = new Image();
      img.decoding = "async";
      img.src = album.cover;
      img
        .decode()
        .then(() => {
          if (!destroyed) images.set(id, img);
        })
        .catch(() => {});
    }
  };

  const seedParticles = () => {
    N = Math.round(Math.min(16000, Math.max(5000, cols * rows * 1.0)));
    px = new Float32Array(N);
    py = new Float32Array(N);
    vx = new Float32Array(N);
    vy = new Float32Array(N);
    tx = new Float32Array(N);
    ty = new Float32Array(N);
    key = new Float32Array(N);
    free = new Uint8Array(N);
    for (let i = 0; i < N; i += 1) {
      px[i] = rand() * cols;
      py[i] = rand() * rows;
      tx[i] = px[i];
      ty[i] = py[i];
      free[i] = rand() < 0.1 ? 1 : 0;
    }
  };

  let sizeKey = "";
  const layout = (force) => {
    const sr = stage.getBoundingClientRect();
    if (!sr.width || !sr.height) return false;
    const key0 = `${Math.round(sr.width)}x${Math.round(sr.height)}x${window.devicePixelRatio}`;
    if (!force && key0 === sizeKey) return false;
    sizeKey = key0;
    Wc = sr.width;
    Hc = sr.height;
    const narrow = Wc < 640;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cellW = Math.max(5.6, Math.min((Hc / 68) * 0.6, Wc / (narrow ? 60 : 100), 8.5));
    cwD = Math.max(5, Math.round(cellW * dpr));
    chD = Math.round(cwD / 0.6);
    cw = cwD / dpr;
    ch = chD / dpr;
    const Wd = Math.round(Wc * dpr);
    const Hd = Math.round(Hc * dpr);
    gl.resize(Wd, Hd);
    cols = Math.floor(Wd / cwD);
    rows = Math.floor(Hd / chD);
    ox = Math.floor((Wd - cols * cwD) / 2);
    oy = Math.floor((Hd - rows * chD) / 2);
    const atlas = buildAtlas(cwD, chD, dpr);
    ramp = atlas.ramp;
    gl.atlas(atlas.image, cwD, chD, ATLAS_COLS);
    const n = cols * rows;
    cells = new Uint8Array(n * 2);
    dens = new Float32Array(n);
    counts = new Uint16Array(n);
    jitter = new Int8Array(n);
    disturb = new Float32Array(n);
    capMask = new Float32Array(n).fill(1);
    psi = new Float32Array((cols + 1) * (rows + 1));
    fvx = new Float32Array(n);
    fvy = new Float32Array(n);
    fresh = true;
    const gx = ox / dpr;
    const gy = oy / dpr;
    let top = embedded ? 12 : 16;
    if (caption) {
      const side = narrow ? 16 : 32;
      caption.style.left = `${side}px`;
      caption.style.width = `${Wc - side * 2}px`;
      const cr = caption.getBoundingClientRect();
      const x0 = cr.left - sr.left - gx - 12;
      const x1 = cr.right - sr.left - gx + 12;
      const y0 = cr.top - sr.top - gy - 12;
      const y1 = cr.bottom - sr.top - gy + 12;
      for (let j = 0; j < rows; j += 1) {
        for (let i = 0; i < cols; i += 1) {
          const cx = (i + 0.5) * cw;
          const cy = (j + 0.5) * ch;
          const dx = Math.max(x0 - cx, 0, cx - x1) / cw;
          const dy = Math.max(y0 - cy, 0, cy - y1) / ch;
          const d = Math.hypot(dx, dy * 1.4);
          capMask[j * cols + i] = smooth(d / 3);
        }
      }
      top = cr.bottom - sr.top - gy + 20;
      promptCol = Math.max(1, Math.round((cr.left - sr.left - gx) / cw));
    } else {
      promptCol = 2;
    }
    if (!embedded) {
      const topBand = 76 - gy;
      const bottomBand = Hc - 52 - gy;
      for (let j = 0; j < rows; j += 1) {
        const cy = (j + 0.5) * ch;
        const edge = Math.min(smooth((cy - topBand) / 40), smooth((bottomBand - cy) / 32));
        for (let i = 0; i < cols; i += 1) capMask[j * cols + i] *= edge;
      }
    }
    promptRow = rows - (narrow ? 4 : 3);
    const bottom = embedded ? 12 : (rows - promptRow + 1) * ch;
    const side = embedded ? 8 : narrow ? 12 : 32;
    region = { x: side, y: top, w: cols * cw - side * 2, h: Math.max(80, rows * ch - top - bottom) };
    targetCache.clear();
    const prevN = N;
    if (!prevN || Math.abs(N - cols * rows * 1.0) > 2000) seedParticles();
    else {
      for (let i = 0; i < N; i += 1) {
        px[i] = Math.min(cols - 0.01, px[i]);
        py[i] = Math.min(rows - 0.01, py[i]);
      }
    }
    if (target && current) {
      target = buildTarget(current);
      if (target) assign(target);
    }
    return true;
  };

  const buildTarget = (item) => {
    const k = item.word ? `w:${item.word}` : `c:${item.cover}`;
    if (targetCache.has(k)) return targetCache.get(k);
    const opts = { cols, rows, cw, ch, region };
    let made = null;
    if (item.word) made = wordTarget(item.word, opts);
    else if (images.has(item.cover)) made = coverTarget(images.get(item.cover), opts, CROPS[item.cover].crop, CROPS[item.cover].gamma);
    if (!made) return null;
    const n = cols * rows;
    const cdf = new Float32Array(n);
    let sum = 0;
    for (let i = 0; i < n; i += 1) {
      const w = made.target[i] * capMask[i];
      sum += w * w;
      cdf[i] = sum;
    }
    made.cdf = cdf;
    made.sum = sum;
    if (targetCache.size > 16) targetCache.delete(targetCache.keys().next().value);
    targetCache.set(k, made);
    return made;
  };

  const assign = (t) => {
    if (!t.sum) return;
    const n = cols * rows;
    for (let p = 0; p < N; p += 1) {
      if (free[p]) continue;
      const u = rand() * t.sum;
      let lo = 0;
      let hi = n - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (t.cdf[mid] < u) lo = mid + 1;
        else hi = mid;
      }
      const i = lo % cols;
      const j = (lo / cols) | 0;
      tx[p] = i + rand();
      ty[p] = j + rand();
      key[p] = Math.min(1, Math.max(0, (tx[p] / cols) * 0.82 + rand() * 0.18));
    }
  };

  const nextItem = () => {
    if (pending) {
      const p = pending;
      pending = null;
      return p;
    }
    for (let k = 0; k < SEQUENCE.length; k += 1) {
      const it = SEQUENCE[seq % SEQUENCE.length];
      seq += 1;
      if (it.word || images.has(it.cover)) return it;
    }
    return SEQUENCE[0];
  };

  const describe = (item) => (item.word ? item.word : `${albumById(item.cover)?.title ?? ""} cover`);

  const startGather = (item) => {
    const t = buildTarget(item);
    if (!t) return false;
    current = item;
    target = t;
    assign(t);
    phase = "gather";
    phaseT = 0;
    phaseLen = GATHER;
    G = 0;
    sound?.chord(seq);
    onLive(describe(item));
    return true;
  };

  const startDissolve = () => {
    phase = "dissolve";
    phaseT = 0;
    phaseLen = DISSOLVE;
  };

  const commit = () => {
    const word = typed.trim();
    typed = "";
    typedAt = -Infinity;
    if (input) input.value = "";
    if (!word) return;
    const item = { word };
    if (phase === "flow") startGather(item);
    else if (phase === "gather") {
      const t = buildTarget(item);
      if (t) {
        current = item;
        target = t;
        assign(t);
        onLive(word);
      }
    } else if (phase === "hold") {
      pending = item;
      startDissolve();
      phaseLen = DISSOLVE * 0.7;
    } else {
      pending = item;
    }
  };

  const advancePhase = (dt) => {
    phaseT += dt;
    if (phase === "flow") {
      G = 0;
      if (phaseT >= phaseLen && !reduced) {
        if (!startGather(nextItem())) phaseT = phaseLen - 0.5;
      }
    } else if (phase === "gather") {
      G = easeInOut(Math.min(1, phaseT / phaseLen));
      if (phaseT >= phaseLen) {
        phase = "hold";
        phaseT = 0;
        phaseLen = HOLD;
        G = 1;
      }
    } else if (phase === "hold") {
      G = 1;
      if (phaseT >= phaseLen) startDissolve();
    } else if (phase === "dissolve") {
      G = 1 - smooth(Math.min(1, phaseT / phaseLen));
      if (phaseT >= phaseLen) {
        phase = "flow";
        phaseT = 0;
        phaseLen = pending ? 0.7 : FLOW;
        G = 0;
        target = null;
        current = null;
      }
    }
  };

  const updateFlow = (t) => {
    const f = 1 / Math.max(180, Math.min(Wc, Hc) * 0.42);
    const nc = cols + 1;
    for (let j = 0; j <= rows; j += 1) {
      const y = j * ch * f;
      for (let i = 0; i <= cols; i += 1) {
        const x = i * cw * f;
        psi[j * nc + i] = simplex(x + t * 0.045, y - t * 0.03) + 0.42 * simplex(x * 2.2 - t * 0.08 + 5.2, y * 2.2 + t * 0.06 - 1.7);
      }
    }
    const amp = 100 / (1.6 * f);
    for (let j = 0; j < rows; j += 1) {
      for (let i = 0; i < cols; i += 1) {
        const a = psi[j * nc + i];
        const b = psi[j * nc + i + 1];
        const c = psi[(j + 1) * nc + i];
        const d = psi[(j + 1) * nc + i + 1];
        const dpy = (c - a + d - b) * 0.5;
        const dpx = (b - a + d - c) * 0.5;
        fvx[j * cols + i] = ((dpy / ch) * amp) / cw;
        fvy[j * cols + i] = ((-dpx / cw) * amp) / ch;
      }
    }
  };

  const step = (dt) => {
    updateFlow(clock);
    const n = cols * rows;
    counts.fill(0);
    const relax = 1 - Math.exp(-dt / 0.35);
    const windBase = phase === "dissolve" ? 26 + 50 * (1 - G) : 16;
    const wind = windBase / cw;
    const pActive = pointer.down || (pointer.type === "mouse" && clock - pointer.at < 0.3);
    const R = Math.max(70, Math.min(Wc, Hc) * 0.16);
    const R2 = R * R;
    const pvx = pointer.vx;
    const pvy = pointer.vy;
    const gathering = phase !== "flow";
    const settle = Math.exp(-dt / 0.8);
    for (let i = 0; i < n; i += 1) disturb[i] *= settle;
    const pSpeed = Math.hypot(pvx, pvy);
    if (pActive && pSpeed > 30) {
      const strength = Math.min(1, pSpeed / 500);
      const ri = Math.ceil(R / cw);
      const rj = Math.ceil(R / ch);
      const pi = Math.floor(pointer.x);
      const pj = Math.floor(pointer.y);
      for (let j = Math.max(0, pj - rj); j <= Math.min(rows - 1, pj + rj); j += 1) {
        for (let i = Math.max(0, pi - ri); i <= Math.min(cols - 1, pi + ri); i += 1) {
          const dx = (i + 0.5 - pointer.x) * cw;
          const dy = (j + 0.5 - pointer.y) * ch;
          const r = Math.sqrt(dx * dx + dy * dy);
          if (r >= R) continue;
          const v = strength * smooth(1 - r / R);
          const c = j * cols + i;
          if (v > disturb[c]) disturb[c] = v;
        }
      }
    }
    for (let p = 0; p < N; p += 1) {
      let x = px[p];
      let y = py[p];
      let gi = 0;
      if (gathering && !free[p]) {
        const k = phase === "dissolve" ? 1 - key[p] : key[p];
        gi = smooth(G * (1 + SPREAD) - k * SPREAD);
      }
      const ci = Math.min(cols - 1, Math.max(0, x | 0));
      const cj = Math.min(rows - 1, Math.max(0, y | 0));
      const ci2 = ci + cj * cols;
      gi *= 1 - disturb[ci2];
      const fx = (fvx[ci2] + wind) * (1 - gi);
      const fy = fvy[ci2] * (1 - gi);
      let ax = 0;
      let ay = 0;
      if (pActive) {
        const dx = (x - pointer.x) * cw;
        const dy = (y - pointer.y) * ch;
        const r2 = dx * dx + dy * dy;
        if (r2 < R2) {
          const r = Math.sqrt(r2) + 0.001;
          const fall = (1 - r / R) * (1 - r / R);
          const swirl = 900 * fall;
          ax += ((-dy / r) * swirl + pvx * fall * 5 + (dx / r) * 260 * fall) / cw;
          ay += ((dx / r) * swirl + pvy * fall * 5 + (dy / r) * 260 * fall) / ch;
        }
      }
      vx[p] += (fx - vx[p]) * relax + ax * dt;
      vy[p] += (fy - vy[p]) * relax + ay * dt;
      const sp = Math.hypot(vx[p] * cw, vy[p] * ch);
      if (sp > 900) {
        vx[p] *= 900 / sp;
        vy[p] *= 900 / sp;
      }
      const move = 1 - 0.82 * gi;
      x += vx[p] * dt * move;
      y += vy[p] * dt * move;
      if (gi > 0) {
        const pull = 1 - Math.exp(-dt * 7.5 * gi * gi);
        x += (tx[p] - x) * pull;
        y += (ty[p] - y) * pull;
      } else {
        if (x < 0) x += cols;
        else if (x >= cols) x -= cols;
        if (y < 0) y += rows;
        else if (y >= rows) y -= rows;
      }
      px[p] = x;
      py[p] = y;
      const i = x | 0;
      const j = y | 0;
      if (i >= 0 && j >= 0 && i < cols && j < rows) counts[j * cols + i] += 1;
    }
    const decay = Math.exp(-dt / 0.075);
    const gain = dt * 60;
    for (let i = 0; i < n; i += 1) dens[i] = dens[i] * decay + counts[i] * gain * (1 - decay) * 4.7;
  };

  const composeCells = () => {
    const n = cols * rows;
    const levels = ramp.length - 1;
    const hasTarget = target && phase !== "flow";
    if (hasTarget) {
      const flips = Math.round(n * 0.012);
      for (let k = 0; k < flips; k += 1) jitter[(rand() * n) | 0] = Math.round(rand() * 2 - 1);
    }
    for (let j = 0; j < rows; j += 1) {
      const rowBase = j * cols;
      for (let i = 0; i < cols; i += 1) {
        const c = rowBase + i;
        let L = (1 - Math.exp(-dens[c] * 0.1)) * 0.86;
        if (hasTarget) {
          const kx = i / cols;
          const k = phase === "dissolve" ? 1 - kx : kx;
          const g = smooth(G * (1 + SPREAD) - (k * 0.85 + 0.075) * SPREAD);
          const h = smooth((g - 0.62) / 0.38) * target.mask[c] * (1 - smooth(disturb[c] * 1.6));
          if (h > 0) L = L * (1 - h) + target.target[c] * h;
          if (h > 0.5 && L > 0.06) L += jitter[c] / levels;
        }
        L *= capMask[c];
        let idx = Math.round(L * levels);
        if (idx < 0) idx = 0;
        if (idx > levels) idx = levels;
        if (L < 0.035) idx = 0;
        cells[c * 2] = ramp[idx];
        cells[c * 2 + 1] = idx ? Math.round(255 * Math.min(1, 0.16 + 0.84 * Math.pow(L, 0.85))) : 0;
      }
    }
    const showPrompt = !embedded && (typed.length > 0 || focused);
    if (showPrompt && promptRow > 0) {
      const text = `> ${typed}`;
      const blink = Math.floor(clock * 2.2) % 2 === 0;
      const end = Math.min(cols - 1, promptCol + text.length + 2);
      for (let jj = promptRow - 1; jj <= promptRow + 1; jj += 1) {
        if (jj < 0 || jj >= rows) continue;
        for (let i = Math.max(0, promptCol - 2); i <= Math.min(cols - 1, end + 1); i += 1) {
          const c = jj * cols + i;
          if (jj === promptRow) {
            cells[c * 2] = 0;
            cells[c * 2 + 1] = 0;
          } else {
            cells[c * 2 + 1] = Math.round(cells[c * 2 + 1] * 0.35);
          }
        }
      }
      for (let k = 0; k < text.length && promptCol + k < cols; k += 1) {
        const c = promptRow * cols + promptCol + k;
        cells[c * 2] = glyphIndex(text[k]);
        cells[c * 2 + 1] = 255;
      }
      const cur = promptCol + text.length;
      if (blink && cur < cols) {
        const c = promptRow * cols + cur;
        cells[c * 2] = glyphIndex("_");
        cells[c * 2 + 1] = 255;
      }
    }
  };

  const draw = () => {
    gl.cells(cells, cols, rows, fresh);
    fresh = false;
    gl.render({ ox, oy, cols, rows, height: Math.round(Hc * dpr), fade: smooth(fade) });
  };

  const frame = () => {
    const now = performance.now();
    raf = 0;
    if (destroyed) return;
    const raw = Math.min(0.25, Math.max(0.001, (now - last) / 1000));
    last = now;
    const dt = Math.min(raw, 1 / 30);
    clock += dt;
    fade = Math.min(1, fade + raw / 0.7);
    if (typed && clock - typedAt > COMMIT_IDLE) commit();
    advancePhase(Math.min(raw, 0.1));
    pointer.vx *= Math.exp(-dt / 0.12);
    pointer.vy *= Math.exp(-dt / 0.12);
    const speed = Math.hypot(pointer.vx, pointer.vy);
    const pActive = pointer.down || (pointer.type === "mouse" && clock - pointer.at < 0.3);
    stir += ((pActive ? Math.min(1, speed / 1600) : 0) - stir) * (1 - Math.exp(-dt / 0.2));
    step(dt);
    composeCells();
    draw();
    const swell = phase === "flow" ? 0 : G;
    sound?.update({ swell, hold: Math.pow(G, 3), stir, clock });
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

  const gesture = () => {
    if (gestured) return;
    gestured = true;
    onGesture();
  };

  const setTyped = (value) => {
    const clean = [...value.toLowerCase()].filter((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) <= 126).join("").replace(/^\s+/, "").slice(0, MAX_TYPED);
    if (input && input.value !== clean) input.value = clean;
    typed = clean;
    typedAt = clock;
  };

  const localPoint = (e) => {
    const r = root.getBoundingClientRect();
    return [((e.clientX - r.left) * dpr - ox) / cwD, ((e.clientY - r.top) * dpr - oy) / chD];
  };

  const onMove = (e) => {
    const [x, y] = localPoint(e);
    const dtp = Math.max(0.008, clock - pointer.at);
    if (clock - pointer.at < 0.2) {
      const nvx = ((x - pointer.x) * cw) / dtp;
      const nvy = ((y - pointer.y) * ch) / dtp;
      pointer.vx += (Math.max(-3000, Math.min(3000, nvx)) - pointer.vx) * 0.5;
      pointer.vy += (Math.max(-3000, Math.min(3000, nvy)) - pointer.vy) * 0.5;
    }
    pointer.x = x;
    pointer.y = y;
    pointer.at = clock;
    pointer.type = e.pointerType;
  };

  const onDown = (e) => {
    gesture();
    onMove(e);
    pointer.down = true;
    pointer.vx = 0;
    pointer.vy = 0;
    pointer.startX = e.clientX;
    pointer.startY = e.clientY;
    pointer.startAt = clock;
  };

  const onUp = (e) => {
    if (!pointer.down) return;
    pointer.down = false;
    const moved = Math.hypot(e.clientX - pointer.startX, e.clientY - pointer.startY);
    if (!embedded && input && e.pointerType !== "mouse" && moved < 8 && clock - pointer.startAt < 0.35) input.focus({ preventScroll: true });
  };

  const onLeave = () => {
    pointer.down = false;
    pointer.at = -Infinity;
  };

  const editable = (t) => t && t !== root && t !== document.body && t !== input && (t.closest?.("button, input, textarea, a, select") || t.isContentEditable);

  const onKey = (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target === input) return;
    if (editable(e.target)) return;
    const k = e.key;
    if (k === "Enter") {
      if (typed) {
        commit();
        e.preventDefault();
      }
    } else if (k === "Backspace") {
      if (!typed) return;
      gesture();
      setTyped(typed.slice(0, -1));
      e.preventDefault();
    } else if (k === "Escape") {
      setTyped("");
    } else if (k.length === 1 && k.charCodeAt(0) >= 32 && k.charCodeAt(0) <= 126) {
      if (k === " " && !typed) return;
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
      commit();
      input.blur();
      e.preventDefault();
    }
  };

  const onFocus = () => {
    focused = true;
  };
  const onBlur = () => {
    focused = false;
  };

  const onVisibility = () => {
    visible = !document.hidden;
    if (visible) wake();
    else sleep();
  };

  root.addEventListener("pointerdown", onDown);
  root.addEventListener("pointermove", onMove);
  root.addEventListener("pointerup", onUp);
  root.addEventListener("pointercancel", onLeave);
  root.addEventListener("pointerleave", onLeave);
  const keyTarget = embedded ? root : window;
  keyTarget.addEventListener("keydown", onKey);
  input?.addEventListener("input", onInput);
  input?.addEventListener("keydown", onInputKey);
  input?.addEventListener("focus", onFocus);
  input?.addEventListener("blur", onBlur);
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

  const boot = async () => {
    loadCovers();
    try {
      await Promise.race([Promise.all([document.fonts.load("500 16px FieldMono"), document.fonts.load("700 32px FieldSerif")]), new Promise((r) => setTimeout(r, 1500))]);
    } catch {}
    if (destroyed) return;
    if (!layout(true)) {
      requestAnimationFrame(boot);
      return;
    }
    for (let k = 0; k < 50; k += 1) {
      clock += 1 / 60;
      step(1 / 60);
    }
    composeCells();
    ready = true;
    root.dataset.ready = "";
    draw();
    wake();
  };
  boot();

  return {
    async setSound(on) {
      if (on && !sound) sound = createFieldSound();
      if (!sound) return false;
      if (on && current) sound.chord(seq);
      return sound.setEnabled(on);
    },
    destroy() {
      destroyed = true;
      sleep();
      ro.disconnect();
      io.disconnect();
      root.removeEventListener("pointerdown", onDown);
      root.removeEventListener("pointermove", onMove);
      root.removeEventListener("pointerup", onUp);
      root.removeEventListener("pointercancel", onLeave);
      root.removeEventListener("pointerleave", onLeave);
      keyTarget.removeEventListener("keydown", onKey);
      input?.removeEventListener("input", onInput);
      input?.removeEventListener("keydown", onInputKey);
      input?.removeEventListener("focus", onFocus);
      input?.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVisibility);
      sound?.destroy();
      gl.dispose();
      root.remove();
    },
  };
}
