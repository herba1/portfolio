import { ALBUMS } from "@/app/lab/_music/catalog";

import { METHODS, applyContrast, dither, lumaFrom } from "./ditherAlgos";
import { createDitherSound } from "./ditherAudio";
import { FONT_ASCENT, drawText, measure } from "./pixelFont";

const WHITE = [250, 250, 246];
const BLACK = [14, 14, 14];
const MB = 18;
const TITLE = 19;
const ROW = 15;
const START_ALBUM = ALBUMS.findIndex((a) => a.id === "abbey-road");
const PILOT_ALBUMS = ["revolver", "rubber-soul", "let-it-be", "help", "sgt-pepper", "a-hard-days-night", "abbey-road", "white-album", "with-the-beatles", "magical-mystery-tour"].map((id) => ALBUMS.findIndex((a) => a.id === id));
const CONTRAST_MIN = 0.5;
const CONTRAST_MAX = 2.2;
const IDLE = 6000;

const ARROW = [
  "X           ",
  "XX          ",
  "X.X         ",
  "X..X        ",
  "X...X       ",
  "X....X      ",
  "X.....X     ",
  "X......X    ",
  "X.......X   ",
  "X........X  ",
  "X.....XXXXX ",
  "X..X..X     ",
  "X.X X..X    ",
  "XX  X..X    ",
  "X    X..X   ",
  "     X..X   ",
  "      XX    ",
];

function lower(text) {
  return text.toLowerCase();
}

function seeded(n, seed) {
  const out = new Float32Array(n);
  let s = seed >>> 0;
  for (let i = 0; i < n; i += 1) {
    s = (s * 1664525 + 1013904223) >>> 0;
    out[i] = s / 4294967296;
  }
  return out;
}

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export function createDither(stage, { embedded = false, caption = null, onLive = () => {}, onGesture = () => {} } = {}) {
  const root = document.createElement("div");
  root.className = "dither-screen";
  root.tabIndex = embedded ? 0 : -1;
  root.setAttribute("role", "application");
  root.setAttribute("aria-label", "Dither. Arrow keys up and down change the method, left and right change the record, plus and minus change contrast.");
  const canvas = document.createElement("canvas");
  canvas.className = "dither-canvas";
  root.append(canvas);
  stage.append(root);
  const cx = canvas.getContext("2d");

  let sound = null;
  let W = 0;
  let H = 0;
  let fb = new Uint8Array(1);
  let image = null;
  let L = null;
  let raf = 0;
  let last = 0;
  let visible = !document.hidden;
  let onscreen = true;
  let destroyed = false;
  let ready = false;
  let dirty = true;
  let minute = -1;

  let album = START_ALBUM;
  let pos = 3;
  let posTarget = 3;
  let posVel = 0;
  let contrast = 1.15;
  let lastDetent = 3;

  let fade = 1;
  let oldBits = null;
  let shown = null;
  let noise = null;
  let noiseFade = null;
  let noiseN = 0;

  const images = new Map();
  const lumas = new Map();
  const bitsCache = new Map();
  const thumbs = new Map();
  let lumBuf = null;

  let cursor = { x: 0, y: 0, visible: false };
  let drag = null;
  let hoverDown = false;
  let lastPointer = null;
  let moveAccum = 0;
  const pilot = { on: true, tasks: [], task: null, t0: 0, from: null, cycle: 0, resumeAt: 0 };

  const loadCover = (i) => {
    const a = ALBUMS[i];
    if (images.has(a.id)) return images.get(a.id);
    const entry = { img: new Image(), ready: false, promise: null };
    entry.img.decoding = "async";
    entry.promise = new Promise((resolve) => {
      entry.img.onload = () => {
        entry.ready = true;
        thumbs.delete(a.id);
        dirty = true;
        resolve(true);
      };
      entry.img.onerror = () => resolve(false);
    });
    entry.img.src = a.cover;
    images.set(a.id, entry);
    return entry;
  };

  const lumaFor = (i, n) => {
    const a = ALBUMS[i];
    const key = `${a.id}:${n}`;
    if (lumas.has(key)) return lumas.get(key);
    const entry = loadCover(i);
    if (!entry.ready) return null;
    const l = lumaFrom(entry.img, n);
    lumas.set(key, l);
    return l;
  };

  const bitsFor = (i, m, n) => {
    const a = ALBUMS[i];
    const cq = Math.round(contrast * 100);
    const key = `${a.id}:${n}:${cq}:${m}`;
    if (bitsCache.has(key)) return bitsCache.get(key);
    const l = lumaFor(i, n);
    if (!l) return null;
    if (!lumBuf || lumBuf.length !== n * n) lumBuf = new Float32Array(n * n);
    applyContrast(l, cq / 100, lumBuf);
    const bits = dither(METHODS[m].id, lumBuf, n);
    if (bitsCache.size > 40) bitsCache.delete(bitsCache.keys().next().value);
    bitsCache.set(key, bits);
    return bits;
  };

  const thumbFor = (i, n) => {
    const a = ALBUMS[i];
    if (thumbs.has(a.id) && thumbs.get(a.id).n === n) return thumbs.get(a.id).bits;
    const l = lumaFor(i, n);
    if (!l) return null;
    const buf = new Float32Array(n * n);
    applyContrast(l, 1.2, buf);
    const bits = dither("atkinson", buf, n);
    thumbs.set(a.id, { n, bits });
    return bits;
  };

  const plotBlack = (x, y) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    fb[y * W + x] = 0;
  };
  const plotWhite = (x, y) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    fb[y * W + x] = 1;
  };
  const fill = (x, y, w, h, v) => {
    const x0 = Math.max(0, x);
    const y0 = Math.max(0, y);
    const x1 = Math.min(W, x + w);
    const y1 = Math.min(H, y + h);
    for (let yy = y0; yy < y1; yy += 1) fb.fill(v, yy * W + x0, yy * W + x1);
  };
  const frame1 = (x, y, w, h) => {
    fill(x, y, w, 1, 0);
    fill(x, y + h - 1, w, 1, 0);
    fill(x, y, 1, h, 0);
    fill(x + w - 1, y, 1, h, 0);
  };
  const gray = (x, y, w, h, phase = 0) => {
    for (let yy = Math.max(0, y); yy < Math.min(H, y + h); yy += 1) {
      for (let xx = Math.max(0, x); xx < Math.min(W, x + w); xx += 1) fb[yy * W + xx] = (xx + yy + phase) & 1;
    }
  };
  const circle = (cx0, cy0, r, filled) => {
    for (let yy = -r; yy <= r; yy += 1) {
      for (let xx = -r; xx <= r; xx += 1) {
        const d = Math.sqrt(xx * xx + yy * yy);
        if (filled ? d <= r + 0.15 : d <= r + 0.35 && d >= r - 0.65) plotBlack(cx0 + xx, cy0 + yy);
      }
    }
  };
  const text = (x, y, s, bold = false, white = false) => drawText(white ? plotWhite : plotBlack, x, y, s, bold);

  const computeLayout = () => {
    const wide = W >= 470;
    const lay = { wide };
    const pad = wide ? 10 : 6;
    const inner = wide ? 12 : 10;
    const deskTop = MB;
    const deskH = H - MB;
    if (wide) {
      const panelW = 196;
      const iconRoom = W >= 600 ? 64 : 0;
      const availW = W - pad * 2 - iconRoom * 2;
      const availH = deskH - pad * 2 - 2;
      let S = Math.min(availH - TITLE - inner * 2, availW - panelW - inner * 3);
      S = Math.max(150, Math.floor(S / 2) * 2);
      const winW = inner + S + inner + panelW + inner;
      const winH = TITLE + inner + S + inner;
      const wx = Math.round((W - winW) / 2);
      const wy = Math.round(deskTop + (deskH - winH) / 2);
      Object.assign(lay, { S, win: { x: wx, y: wy, w: winW, h: winH }, cover: { x: wx + inner, y: wy + TITLE + inner }, panel: { x: wx + inner * 2 + S, y: wy + TITLE + inner, w: panelW }, icons: iconRoom > 0 });
      const p = lay.panel;
      lay.methodLabel = { x: p.x, y: p.y + 2 };
      lay.radios = { x: p.x + 5, y: p.y + 21, label: p.x + 16 };
      lay.contrastLabel = { x: p.x, y: lay.radios.y + ROW * 3 + 20 };
      lay.slider = { x: p.x + 1, y: lay.contrastLabel.y + 15, w: 150, h: 9 };
      lay.recordsLabel = { x: p.x, y: lay.slider.y + 26 };
      const T = Math.min(26, Math.floor((p.w - 20) / 6));
      lay.grid = { x: p.x + 1, y: lay.recordsLabel.y + 15, cols: 6, T, gap: 4 };
    } else {
      const winW = W - pad * 2;
      const panelH = 132;
      const availH = deskH - pad * 2 - 2;
      let S = Math.min(winW - inner * 2, availH - TITLE - inner * 3 - panelH);
      S = Math.max(120, Math.floor(S / 2) * 2);
      const winH = TITLE + inner + S + inner + panelH + inner;
      const wx = pad;
      const wy = Math.round(deskTop + Math.max(pad, (deskH - winH) / 2));
      const cxp = wx + Math.round((winW - S) / 2);
      Object.assign(lay, { S, win: { x: wx, y: wy, w: winW, h: winH }, cover: { x: cxp, y: wy + TITLE + inner }, panel: { x: wx + inner, y: wy + TITLE + inner * 2 + S, w: winW - inner * 2 }, icons: false });
      const p = lay.panel;
      lay.methodLabel = { x: p.x, y: p.y + 2 };
      lay.radios = { x: p.x + 5, y: p.y + 21, label: p.x + 16 };
      const T = 24;
      const gw = T * 3 + 4 * 2;
      lay.grid = { x: p.x + p.w - gw - 1, y: p.y + 17, cols: 3, T, gap: 4, label: true };
      lay.recordsLabel = { x: lay.grid.x, y: p.y + 2 };
      lay.contrastLabel = { x: p.x, y: lay.radios.y + ROW * 3 + 20 };
      lay.slider = { x: p.x + 1, y: lay.contrastLabel.y + 15, w: Math.min(140, lay.grid.x - p.x - 20), h: 9 };
    }
    return lay;
  };

  const ensureNoise = (n) => {
    if (noiseN === n) return;
    noiseN = n;
    noise = seeded(n * n, 1985);
    noiseFade = seeded(n * n, 1984);
    shown = new Uint8Array(n * n);
    oldBits = null;
    fade = 1;
  };

  const sliderX = () => {
    const s = L.slider;
    const t = (contrast - CONTRAST_MIN) / (CONTRAST_MAX - CONTRAST_MIN);
    return Math.round(s.x + 1 + t * (s.w - 11));
  };

  const radioY = (i) => L.radios.y + i * ROW;
  const thumbRect = (i) => {
    const g = L.grid;
    const c = i % g.cols;
    const r = Math.floor(i / g.cols);
    return { x: g.x + c * (g.T + g.gap), y: g.y + r * (g.T + g.gap), w: g.T, h: g.T };
  };

  const coverBits = () => {
    const n = L.S;
    ensureNoise(n);
    const a = Math.min(3, Math.max(0, Math.floor(pos)));
    const b = Math.min(3, a + 1);
    const t = pos - a;
    const A = bitsFor(album, a, n);
    if (!A) return null;
    const B = t > 0.001 ? bitsFor(album, b, n) : A;
    if (!B) return null;
    for (let i = 0; i < n * n; i += 1) shown[i] = noise[i] < t ? B[i] : A[i];
    if (oldBits && fade < 1) {
      const f = ease(fade);
      for (let i = 0; i < n * n; i += 1) if (noiseFade[i] >= f) shown[i] = oldBits[i];
    }
    return shown;
  };

  const drawMenuBar = () => {
    fill(0, 0, W, MB - 1, 1);
    fill(0, MB - 1, W, 1, 0);
    const my = Math.round((MB - 1 - FONT_ASCENT) / 2);
    let x = 12;
    circle(x + 4, my + 3, 4, false);
    circle(x + 4, my + 3, 1, true);
    x += 20;
    const items = L.wide ? ["File", "Edit", "Image", "Dither"] : ["File", "Edit", "Dither"];
    for (const it of items) x += text(x, my, it, true) + 14;
    const d = new Date();
    const h = d.getHours() % 12 || 12;
    const clock = `${h}:${String(d.getMinutes()).padStart(2, "0")}`;
    text(W - 12 - measure(clock, true), my, clock, true);
  };

  const drawCorners = () => {
    const r = 5;
    for (let y = 0; y < r; y += 1) {
      for (let x = 0; x < r; x += 1) {
        const dx = r - x - 0.5;
        const dy = r - y - 0.5;
        if (dx * dx + dy * dy > r * r) {
          plotBlack(x, y);
          plotBlack(W - 1 - x, y);
          plotBlack(x, H - 1 - y);
          plotBlack(W - 1 - x, H - 1 - y);
        }
      }
    }
  };

  const drawIcon = (x, y, kind, label) => {
    if (kind === "disk") {
      fill(x + 3, y, 26, 28, 1);
      frame1(x + 3, y, 26, 28);
      fill(x + 9, y, 14, 10, 0);
      fill(x + 18, y + 2, 3, 6, 1);
      fill(x + 7, y + 14, 18, 12, 1);
      frame1(x + 7, y + 14, 18, 12);
      for (let i = 0; i < 3; i += 1) fill(x + 10, y + 17 + i * 3, 12, 1, 0);
    } else {
      fill(x + 6, y + 6, 20, 22, 1);
      frame1(x + 6, y + 6, 20, 22);
      fill(x + 4, y + 3, 24, 3, 1);
      frame1(x + 4, y + 3, 24, 3);
      fill(x + 12, y, 8, 3, 1);
      frame1(x + 12, y, 8, 4);
      for (let i = 0; i < 4; i += 1) fill(x + 10 + i * 4, y + 9, 1, 16, 0);
    }
    const tw = measure(label);
    const lx = x + 16 - Math.round(tw / 2);
    fill(lx - 2, y + 31, tw + 4, 11, 1);
    text(lx, y + 33, label);
  };

  const drawWindow = () => {
    const w = L.win;
    fill(w.x + 1, w.y + 1, w.w, w.h, 0);
    fill(w.x, w.y, w.w, w.h, 1);
    frame1(w.x, w.y, w.w, w.h);
    fill(w.x, w.y + TITLE - 1, w.w, 1, 0);
    for (let i = 0; i < 6; i += 1) fill(w.x + 2, w.y + 4 + i * 2, w.w - 4, 1, 0);
    const title = lower(ALBUMS[album].title);
    const room = w.w - 60;
    let label = title;
    while (measure(label, true) > room && label.length > 4) label = `${label.slice(0, -2)}…`.replace(/……$/, "…");
    const tw = measure(label, true);
    const tx = w.x + Math.round((w.w - tw) / 2);
    fill(tx - 6, w.y + 3, tw + 12, TITLE - 6, 1);
    text(tx, w.y + 6, label, true);
    fill(w.x + 8, w.y + 3, 15, TITLE - 6, 1);
    frame1(w.x + 10, w.y + 4, 11, 11);
  };

  const drawCover = () => {
    const c = L.cover;
    const n = L.S;
    frame1(c.x - 1, c.y - 1, n + 2, n + 2);
    const bits = coverBits();
    if (!bits) {
      gray(c.x, c.y, n, n, 1);
      return;
    }
    for (let y = 0; y < n; y += 1) {
      const row = (c.y + y) * W + c.x;
      fb.set(bits.subarray(y * n, y * n + n), row);
    }
  };

  const drawPanel = () => {
    text(L.methodLabel.x, L.methodLabel.y, "Method", true);
    const r = L.radios;
    for (let y = radioY(0); y <= radioY(3); y += 2) plotBlack(r.x, y);
    METHODS.forEach((m, i) => {
      const y = radioY(i);
      fill(r.x - 5, y - 5, 11, 11, 1);
      circle(r.x, y, 5, false);
      const active = Math.round(pos) === i;
      text(r.label, y - 3, m.label, active);
    });
    const dotY = Math.round(radioY(0) + pos * ROW);
    circle(r.x, dotY, 2, true);
    text(L.contrastLabel.x, L.contrastLabel.y, "Contrast", true);
    const s = L.slider;
    fill(s.x, s.y, s.w, s.h, 1);
    gray(s.x + 1, s.y + 1, s.w - 2, s.h - 2, 0);
    frame1(s.x, s.y, s.w, s.h);
    const kx = sliderX();
    fill(kx, s.y - 3, 9, s.h + 6, 1);
    frame1(kx, s.y - 3, 9, s.h + 6);
    fill(kx + 4, s.y, 1, s.h, 0);
    const pct = `${Math.round(contrast * 100)}%`;
    text(s.x + s.w + 8, s.y + 1, pct);
    text(L.recordsLabel.x, L.recordsLabel.y, "Records", true);
    ALBUMS.forEach((_, i) => {
      const t = thumbRect(i);
      const bits = thumbFor(i, t.w);
      if (bits) {
        for (let y = 0; y < t.h; y += 1) fb.set(bits.subarray(y * t.w, y * t.w + t.w), (t.y + y) * W + t.x);
      } else {
        gray(t.x, t.y, t.w, t.h);
      }
      if (i === album) {
        frame1(t.x - 3, t.y - 3, t.w + 6, t.h + 6);
        frame1(t.x - 2, t.y - 2, t.w + 4, t.h + 4);
      } else {
        frame1(t.x - 1, t.y - 1, t.w + 2, t.h + 2);
      }
    });
  };

  const drawCursor = () => {
    if (!cursor.visible) return;
    const x0 = Math.round(cursor.x);
    const y0 = Math.round(cursor.y);
    ARROW.forEach((row, y) => {
      for (let x = 0; x < row.length; x += 1) {
        if (row[x] === "X") plotBlack(x0 + x, y0 + y);
        else if (row[x] === ".") plotWhite(x0 + x, y0 + y);
      }
    });
  };

  const render = () => {
    gray(0, MB, W, H - MB);
    drawMenuBar();
    if (L.icons) {
      drawIcon(W - 52, MB + 14, "disk", "Records");
      drawIcon(W - 52, H - 58, "trash", "Trash");
    }
    drawWindow();
    drawCover();
    drawPanel();
    drawCursor();
    drawCorners();
    const d = image.data;
    for (let i = 0; i < W * H; i += 1) {
      const c = fb[i] ? WHITE : BLACK;
      const j = i * 4;
      d[j] = c[0];
      d[j + 1] = c[1];
      d[j + 2] = c[2];
      d[j + 3] = 255;
    }
    cx.putImageData(image, 0, 0);
  };

  const setAlbum = (i) => {
    const next = (i + ALBUMS.length) % ALBUMS.length;
    if (next === album) return;
    if (shown && L) oldBits = Uint8Array.from(shown);
    album = next;
    fade = 0;
    sound?.swap();
    loadCover(album);
    onLive(`${ALBUMS[album].title}, ${ALBUMS[album].year}`);
    dirty = true;
  };

  const setMethod = (m) => {
    posTarget = Math.min(3, Math.max(0, m));
    onLive(METHODS[Math.round(posTarget)].label);
    dirty = true;
  };

  const setContrast = (c) => {
    const next = Math.min(CONTRAST_MAX, Math.max(CONTRAST_MIN, c));
    if (Math.abs(next - contrast) < 0.004) return;
    const before = Math.round(contrast * 20);
    contrast = next;
    if (Math.round(contrast * 20) !== before) sound?.tick(0.2);
    dirty = true;
  };

  const inRect = (p, x, y, w, h) => p.x >= x && p.x < x + w && p.y >= y && p.y < y + h;

  const hit = (p) => {
    const r = L.radios;
    if (inRect(p, r.x - 8, radioY(0) - 8, Math.max(110, L.panel.w * 0.6), ROW * 3 + 16)) return { kind: "method" };
    const s = L.slider;
    if (inRect(p, s.x - 6, s.y - 6, s.w + 12, s.h + 12)) return { kind: "contrast" };
    for (let i = 0; i < ALBUMS.length; i += 1) {
      const t = thumbRect(i);
      if (inRect(p, t.x - 2, t.y - 2, t.w + 4, t.h + 4)) return { kind: "album", index: i };
    }
    const c = L.cover;
    if (inRect(p, c.x, c.y, L.S, L.S)) return { kind: "cover" };
    return null;
  };

  const methodAt = (y) => Math.min(3, Math.max(0, (y - radioY(0)) / ROW));

  const pressAt = (p) => {
    const h = hit(p);
    drag = { kind: h?.kind ?? null, index: h?.index, x: p.x, y: p.y, pos0: pos, moved: false };
    if (!h) return;
    sound?.press((p.x / W) * 1.2 - 0.6);
    if (h.kind === "method") {
      posTarget = methodAt(p.y);
      drag.scrub = true;
    } else if (h.kind === "contrast") {
      const s = L.slider;
      const kx = sliderX();
      drag.grab = p.x >= kx - 1 && p.x <= kx + 10 ? p.x - kx : 4;
      setContrast(CONTRAST_MIN + ((p.x - drag.grab - s.x - 1) / (s.w - 11)) * (CONTRAST_MAX - CONTRAST_MIN));
    }
    dirty = true;
  };

  const moveTo = (p) => {
    if (!drag || !drag.kind) return;
    if (Math.abs(p.x - drag.x) + Math.abs(p.y - drag.y) > 2) drag.moved = true;
    if (drag.kind === "method") {
      posTarget = methodAt(p.y);
    } else if (drag.kind === "cover" && drag.moved) {
      posTarget = Math.min(3, Math.max(0, drag.pos0 + ((p.x - drag.x) / L.S) * 3.2));
      drag.scrub = true;
    } else if (drag.kind === "contrast") {
      const s = L.slider;
      setContrast(CONTRAST_MIN + ((p.x - drag.grab - s.x - 1) / (s.w - 11)) * (CONTRAST_MAX - CONTRAST_MIN));
    }
    dirty = true;
  };

  const releaseAt = () => {
    const d = drag;
    drag = null;
    if (!d || !d.kind) return;
    sound?.release();
    if (d.kind === "album" && !d.moved) setAlbum(d.index);
    if (d.scrub) setMethod(Math.round(posTarget));
    dirty = true;
  };

  const toLogical = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  };

  const stopPilot = () => {
    if (pilot.on && drag) releaseAt();
    pilot.on = false;
    pilot.task = null;
    pilot.tasks = [];
    pilot.resumeAt = performance.now() + IDLE;
  };

  const pilotPlan = () => {
    const tasks = [];
    const k = pilot.cycle;
    pilot.cycle += 1;
    const cur = Math.round(posTarget);
    const goal = cur >= 2 ? 0 : 3;
    const r = L.radios;
    tasks.push({ type: "wait", ms: 900 });
    tasks.push({ type: "move", to: [r.x, radioY(cur)], ms: 900 });
    tasks.push({ type: "down" });
    const step = goal > cur ? 1 : -1;
    for (let m = cur + step; step > 0 ? m <= goal : m >= goal; m += step) {
      tasks.push({ type: "drag", to: [r.x + 1, radioY(m)], ms: 1050 });
      tasks.push({ type: "wait", ms: 650 });
    }
    tasks.push({ type: "up" });
    tasks.push({ type: "wait", ms: 700 });
    if (k % 2 === 0) {
      const s = L.slider;
      const kx = sliderX() + 4;
      tasks.push({ type: "move", to: [kx, s.y + 4], ms: 800 });
      tasks.push({ type: "down" });
      tasks.push({ type: "drag", to: [Math.min(s.x + s.w - 6, kx + 46), s.y + 5], ms: 1100 });
      tasks.push({ type: "wait", ms: 500 });
      tasks.push({ type: "drag", to: [kx, s.y + 4], ms: 900 });
      tasks.push({ type: "up" });
      tasks.push({ type: "wait", ms: 600 });
    }
    const target = PILOT_ALBUMS[k % PILOT_ALBUMS.length];
    const t = thumbRect(target === album ? (target + 1) % ALBUMS.length : target);
    tasks.push({ type: "move", to: [t.x + t.w / 2, t.y + t.h / 2], ms: 1000 });
    tasks.push({ type: "down" });
    tasks.push({ type: "wait", ms: 110 });
    tasks.push({ type: "up" });
    tasks.push({ type: "wait", ms: 1300 });
    return tasks;
  };

  const runPilot = (now) => {
    if (!pilot.on) {
      if (pilot.resumeAt && now > pilot.resumeAt && !hoverDown) {
        pilot.on = true;
        pilot.tasks = [];
        pilot.task = null;
        cursor.visible = true;
      } else return;
    }
    if (!L) return;
    let guard = 0;
    while (guard < 8) {
      guard += 1;
      if (!pilot.task) {
        if (!pilot.tasks.length) pilot.tasks = pilotPlan();
        pilot.task = pilot.tasks.shift();
        pilot.t0 = now;
        pilot.from = [cursor.x, cursor.y];
      }
      const t = pilot.task;
      const el = now - pilot.t0;
      if (t.type === "down") {
        pressAt({ x: cursor.x, y: cursor.y });
        pilot.task = null;
        continue;
      }
      if (t.type === "up") {
        releaseAt();
        pilot.task = null;
        continue;
      }
      if (t.type === "wait") {
        if (el >= t.ms) {
          pilot.task = null;
          pilot.t0 += t.ms;
          continue;
        }
        return;
      }
      const k = Math.min(1, el / t.ms);
      const e = ease(k);
      const [fx, fy] = pilot.from;
      const [tx, ty] = t.to;
      const dx = tx - fx;
      const dy = ty - fy;
      const arc = t.type === "move" ? Math.sin(Math.PI * e) * Math.min(24, Math.hypot(dx, dy) * 0.12) : 0;
      const len = Math.hypot(dx, dy) || 1;
      cursor.x = fx + dx * e + (-dy / len) * arc;
      cursor.y = fy + dy * e + (dx / len) * arc;
      cursor.visible = true;
      if (t.type === "drag") moveTo({ x: cursor.x, y: cursor.y });
      dirty = true;
      if (k >= 1) {
        pilot.task = null;
        continue;
      }
      return;
    }
  };

  const frame = () => {
    const now = performance.now();
    raf = 0;
    if (destroyed) return;
    const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
    last = now;
    runPilot(now);
    const before = pos;
    const k = 120;
    const c = 2 * Math.sqrt(k);
    posVel += ((posTarget - pos) * k - posVel * c) * dt;
    pos += posVel * dt;
    if (Math.abs(posTarget - pos) < 0.001 && Math.abs(posVel) < 0.01) {
      pos = posTarget;
      posVel = 0;
    }
    pos = Math.min(3, Math.max(0, pos));
    if (pos !== before) {
      dirty = true;
      const det = Math.round(pos);
      if (det !== lastDetent && Math.abs(pos - det) < 0.08) {
        lastDetent = det;
        sound?.tick();
      }
    }
    if (fade < 1) {
      fade = Math.min(1, fade + dt / 0.6);
      if (fade >= 1) oldBits = null;
      dirty = true;
    }
    const m = new Date().getMinutes();
    if (m !== minute) {
      minute = m;
      dirty = true;
    }
    if (dirty && L) {
      dirty = false;
      render();
    }
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

  let sizeKey = "";
  const layout = (force) => {
    const sr = stage.getBoundingClientRect();
    if (!sr.width || !sr.height) return;
    const key = `${Math.round(sr.width)}x${Math.round(sr.height)}x${window.devicePixelRatio}`;
    if (!force && key === sizeKey) return;
    sizeKey = key;
    const narrow = sr.width < 640;
    const side = narrow ? 16 : 32;
    const bottom = narrow ? 40 : 56;
    if (caption) {
      caption.style.left = `${side}px`;
      caption.style.width = `${sr.width - side * 2}px`;
    }
    const capBottom = caption ? caption.getBoundingClientRect().bottom - sr.top : 0;
    const top = caption ? Math.round(capBottom + 24) : side;
    const availW = sr.width - side * 2;
    const availH = Math.max(240, sr.height - top - (caption ? bottom : side));
    const dpr = window.devicePixelRatio || 1;
    const mult = Math.max(1, Math.round((narrow ? 1.3 : 2) * dpr));
    const cssPer = mult / dpr;
    W = Math.min(narrow ? 420 : 680, Math.floor(availW / cssPer));
    H = Math.min(narrow ? 640 : 400, Math.floor(availH / cssPer));
    const cw = (W * mult) / dpr;
    const ch = (H * mult) / dpr;
    const left = Math.round((sr.width - cw) / 2);
    if (caption && !narrow) {
      caption.style.left = `${left}px`;
      caption.style.width = `${cw}px`;
    }
    root.style.left = `${left}px`;
    root.style.top = `${top}px`;
    root.style.width = `${cw}px`;
    root.style.height = `${ch}px`;
    canvas.width = W;
    canvas.height = H;
    fb = new Uint8Array(W * H);
    image = cx.createImageData(W, H);
    L = computeLayout();
    if (!cursor.x && !cursor.y) {
      cursor.x = L.cover.x + L.S * 0.62;
      cursor.y = L.cover.y + L.S * 0.55;
    }
    cursor.x = Math.min(W - 4, cursor.x);
    cursor.y = Math.min(H - 4, cursor.y);
    pilot.tasks = [];
    pilot.task = null;
    drag = null;
    dirty = true;
  };

  const onDown = (e) => {
    if (e.button > 0) return;
    onGesture();
    stopPilot();
    hoverDown = true;
    root.setPointerCapture?.(e.pointerId);
    const p = toLogical(e);
    cursor = { x: p.x, y: p.y, visible: e.pointerType === "mouse" };
    pressAt(p);
  };
  const onMove = (e) => {
    const p = toLogical(e);
    const prevPointer = lastPointer;
    lastPointer = p;
    if (e.pointerType === "mouse" && !hoverDown && pilot.on) {
      if (prevPointer) moveAccum += Math.hypot(p.x - prevPointer.x, p.y - prevPointer.y);
      if (moveAccum < 6) return;
    }
    moveAccum = 0;
    if (e.pointerType === "mouse") {
      if (pilot.on) stopPilot();
      pilot.resumeAt = performance.now() + IDLE;
      cursor = { x: p.x, y: p.y, visible: true };
      dirty = true;
    }
    if (hoverDown) {
      pilot.resumeAt = performance.now() + IDLE;
      moveTo(p);
    }
  };
  const onUp = () => {
    if (!hoverDown) return;
    hoverDown = false;
    pilot.resumeAt = performance.now() + IDLE;
    releaseAt();
  };

  const onKey = (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    if (t && t !== root && t !== document.body && (t.closest?.("button, input, textarea, a") || t.isContentEditable)) return;
    const k = e.key;
    let handled = true;
    if (k === "ArrowUp") setMethod(Math.round(posTarget) - 1);
    else if (k === "ArrowDown") setMethod(Math.round(posTarget) + 1);
    else if (k === "ArrowLeft") setAlbum(album - 1);
    else if (k === "ArrowRight") setAlbum(album + 1);
    else if (k >= "1" && k <= "4") setMethod(Number(k) - 1);
    else if (k === "+" || k === "=") setContrast(contrast + 0.1);
    else if (k === "-" || k === "_") setContrast(contrast - 0.1);
    else handled = false;
    if (handled) {
      e.preventDefault();
      onGesture();
      stopPilot();
      sound?.press();
    }
  };

  const onVisibility = () => {
    visible = !document.hidden;
    if (visible) wake();
    else sleep();
  };

  root.addEventListener("pointerdown", onDown);
  root.addEventListener("pointermove", onMove);
  root.addEventListener("pointerup", onUp);
  root.addEventListener("pointercancel", onUp);
  const keyTarget = embedded ? root : window;
  keyTarget.addEventListener("keydown", onKey);
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
    ALBUMS.forEach((_, i) => loadCover(i));
    await Promise.race([loadCover(album).promise, new Promise((r) => setTimeout(r, 4000))]);
    await Promise.race([Promise.all(ALBUMS.map((_, i) => loadCover(i).promise)), new Promise((r) => setTimeout(r, 1500))]);
    if (destroyed) return;
    layout(true);
    cursor.visible = true;
    render();
    ready = true;
    root.dataset.ready = "";
    wake();
  };
  boot();

  return {
    async setSound(on) {
      if (on && !sound) sound = createDitherSound();
      if (!sound) return false;
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
      root.removeEventListener("pointercancel", onUp);
      keyTarget.removeEventListener("keydown", onKey);
      document.removeEventListener("visibilitychange", onVisibility);
      sound?.destroy();
      root.remove();
    },
  };
}
