const START = 0.06;
const SPREAD = 0.6;
const WINDOW = 0.24;
const LEVELS = 8;

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function hash(i) {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

const tracking = (size) => -0.043 * (size - 12);

function lum(r, g, b) {
  const f = (c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function pickInk(px) {
  const buckets = new Map();
  for (let o = 0; o < px.length; o += 4) {
    const r = px[o];
    const g = px[o + 1];
    const b = px[o + 2];
    const L = lum(r, g, b);
    if (L > 0.12) continue;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const sat = max ? (max - min) / max : 0;
    const key = (r >> 5) * 64 + (g >> 5) * 8 + (b >> 5);
    const e = buckets.get(key) || { n: 0, w: 0, r: 0, g: 0, b: 0 };
    const w = 1 + sat * 3 + (L > 0.01 ? 1 : 0);
    e.n += 1;
    e.w += w;
    e.r += r;
    e.g += g;
    e.b += b;
    buckets.set(key, e);
  }
  let best = null;
  buckets.forEach((e) => {
    if (!best || e.w > best.w) best = e;
  });
  if (!best || best.n < 12) return [24, 24, 27];
  let c = [best.r / best.n, best.g / best.n, best.b / best.n];
  for (let i = 0; i < 24 && lum(c[0], c[1], c[2]) > 0.03; i += 1) c = c.map((v) => v * 0.9);
  return c.map(Math.round);
}

function layoutPoster(album, S, family) {
  const c = document.createElement("canvas").getContext("2d");
  const words = album.title.split(" ");
  const lines = [];
  words.forEach((w) => {
    const last = lines[lines.length - 1];
    if (last && (last + " " + w).length <= 7) lines[lines.length - 1] = `${last} ${w}`;
    else lines.push(w);
  });
  c.font = `700 100px ${family}`;
  if ("letterSpacing" in c) c.letterSpacing = `${tracking(100)}px`;
  const widest = Math.max(...lines.map((l) => c.measureText(l).width));
  const lead = 0.88;
  const metaGap = 0.34;
  const meta = Math.max(14, Math.round(S * 0.048));
  const fs = Math.min((S * 100) / widest, (S - meta * 2.4) / (lines.length * lead + metaGap));
  const block = lines.length * fs * lead + fs * metaGap * 0.3 + meta * 1.4;
  const top = (S - block) / 2;
  const baselines = lines.map((_, i) => top + fs * 0.74 + i * fs * lead);
  const metaY = baselines[baselines.length - 1] + fs * metaGap + meta;
  return { lines, fs, baselines, meta, metaY, metaText: `${album.artist}, ${album.year}`, family };
}

function setTitleFont(g, poster) {
  g.font = `700 ${poster.fs}px ${poster.family}`;
  if ("letterSpacing" in g) g.letterSpacing = `${tracking(poster.fs).toFixed(2)}px`;
}

function setMetaFont(g, poster) {
  g.font = `560 ${poster.meta}px ${poster.family}`;
  if ("letterSpacing" in g) g.letterSpacing = `${tracking(poster.meta).toFixed(2)}px`;
}

function titlePoints(poster, S, count) {
  const c = document.createElement("canvas");
  c.width = S;
  c.height = S;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.fillStyle = "#000";
  g.textBaseline = "alphabetic";
  setTitleFont(g, poster);
  poster.lines.forEach((l, i) => g.fillText(l, 0, poster.baselines[i]));
  const data = g.getImageData(0, 0, S, S).data;
  let ink = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 127) ink += 1;
  const step = Math.max(1.2, Math.sqrt(ink / count));
  const pts = [];
  for (let yy = step / 2; yy < S; yy += step) {
    for (let xx = step / 2; xx < S; xx += step) {
      if (data[(Math.floor(yy) * S + Math.floor(xx)) * 4 + 3] > 127) pts.push([xx, yy]);
    }
  }
  const out = [];
  if (pts.length >= count) {
    const ratio = pts.length / count;
    for (let i = 0; i < count; i += 1) out.push(pts[Math.floor(i * ratio)]);
  } else {
    for (let i = 0; i < count; i += 1) {
      const p = pts[i % pts.length];
      out.push([p[0] + (hash(i) - 0.5) * step * 0.5, p[1] + (hash(i + 7) - 0.5) * step * 0.5]);
    }
  }
  return { pts: out, size: step * 1.1 };
}

export function createArt(canvas, { onProgress }) {
  const ctx = canvas.getContext("2d");
  const state = {
    w: 1,
    h: 1,
    dpr: 1,
    S: 400,
    ox: 0,
    oy: 0,
    parts: null,
    cell: 5,
    textSize: 3,
    poster: null,
    ink: "rgb(24,24,27)",
    img: null,
    p: 0,
    v: 0,
    target: 0,
    stiffness: 38,
    raf: 0,
    last: 0,
    album: null,
    token: 0,
    family: "sans-serif",
    shownAt: 0,
  };

  const measure = () => {
    const rect = canvas.getBoundingClientRect();
    state.w = Math.max(1, rect.width);
    state.h = Math.max(1, rect.height);
    state.dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(state.w * state.dpr);
    canvas.height = Math.round(state.h * state.dpr);
    const compact = state.w < 640;
    const S = Math.floor(compact ? Math.min(state.w - 48, state.h - 320) : Math.min(state.w * 0.42, state.h - 304, 480));
    state.S = Math.max(200, S);
    state.ox = Math.round((state.w - state.S) / 2);
    state.oy = Math.round(Math.max(compact ? 152 : 136, (state.h - state.S) / 2 - 32));
  };

  const build = async (album) => {
    const token = ++state.token;
    const img = await loadImage(album.cover);
    if (token !== state.token) return;
    const S = state.S;
    const G = Math.round(Math.min(112, Math.max(64, S / 4.2)));
    const sample = document.createElement("canvas");
    sample.width = G;
    sample.height = G;
    const sg = sample.getContext("2d", { willReadFrequently: true });
    sg.drawImage(img, 0, 0, G, G);
    const px = sg.getImageData(0, 0, G, G).data;
    const ink = pickInk(px);
    const count = G * G;
    const cell = S / G;
    const poster = layoutPoster(album, S, state.family);
    const { pts, size } = titlePoints(poster, S, count);
    const homes = [];
    for (let i = 0; i < count; i += 1) homes.push({ x: ((i % G) + 0.5) * cell, y: (Math.floor(i / G) + 0.5) * cell, i });
    const key = (x, y) => x + y * 0.3;
    homes.sort((a, b) => key(a.x, a.y) - key(b.x, b.y));
    const targets = pts.slice().sort((a, b) => key(a[0], a[1]) - key(b[0], b[1]));
    const parts = new Array(count);
    for (let k = 0; k < count; k += 1) {
      const h = homes[k];
      const t = targets[k];
      const o = h.i * 4;
      const ramp = [];
      for (let l = 0; l <= LEVELS; l += 1) {
        const m = l / LEVELS;
        ramp.push(`rgb(${Math.round(px[o] + (ink[0] - px[o]) * m)},${Math.round(px[o + 1] + (ink[1] - px[o + 1]) * m)},${Math.round(px[o + 2] + (ink[2] - px[o + 2]) * m)})`);
      }
      parts[k] = {
        hx: h.x,
        hy: h.y,
        tx: t[0],
        ty: t[1],
        d: START + ((h.x + t[0]) / (2 * S)) * SPREAD + hash(k) * 0.02,
        lift: 16 + Math.abs(t[0] - h.x) * 0.08 + Math.abs(t[1] - h.y) * 0.04,
        ramp,
      };
    }
    state.parts = parts;
    state.cell = cell;
    state.textSize = size;
    state.poster = poster;
    state.ink = `rgb(${ink[0]},${ink[1]},${ink[2]})`;
    state.img = img;
    state.album = album;
    state.shownAt = performance.now();
    kick();
  };

  const drawPoster = (alpha) => {
    const { poster } = state;
    if (!poster || alpha <= 0) return;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = state.ink;
    ctx.textBaseline = "alphabetic";
    setTitleFont(ctx, poster);
    poster.lines.forEach((l, i) => ctx.fillText(l, 0, poster.baselines[i]));
    setMetaFont(ctx, poster);
    ctx.fillText(poster.metaText, 0, poster.metaY);
    ctx.globalAlpha = 1;
  };

  const drawCover = (alpha) => {
    if (!state.img || alpha <= 0) return;
    ctx.globalAlpha = alpha;
    ctx.save();
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(0, 0, state.S, state.S, 8);
    else ctx.rect(0, 0, state.S, state.S);
    ctx.clip();
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(state.img, 0, 0, state.S, state.S);
    ctx.restore();
    ctx.globalAlpha = 1;
  };

  const draw = (now) => {
    const { parts, dpr, ox, oy, p } = state;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!parts) return false;
    ctx.setTransform(dpr, 0, 0, dpr, ox * dpr, oy * dpr);
    const reveal = smooth(0, 260, now - state.shownAt);
    const coverA = 1 - smooth(0.005, START + 0.02, p);
    const textA = smooth(START + SPREAD + WINDOW - 0.02, START + SPREAD + WINDOW + 0.08, p);
    const partA = 1 - smooth(0.4, 1, textA);
    if (partA > 0.001) {
      ctx.globalAlpha = partA * reveal;
      for (let k = 0; k < parts.length; k += 1) {
        const a = parts[k];
        const raw = Math.min(1, Math.max(0, (p - a.d) / WINDOW));
        const t = easeInOut(raw);
        const arc = Math.sin(Math.PI * t);
        const x = a.hx + (a.tx - a.hx) * t;
        const y = a.hy + (a.ty - a.hy) * t - arc * a.lift;
        const s = state.cell + (state.textSize - state.cell) * t;
        const seam = 0.6;
        ctx.fillStyle = a.ramp[Math.round(smooth(0.2, 0.85, raw) * LEVELS)];
        ctx.fillRect(x - s / 2, y - s / 2, s + seam, s + seam);
      }
      ctx.globalAlpha = 1;
    }
    drawCover(coverA * reveal);
    drawPoster(textA * reveal);
    return reveal < 1;
  };

  const step = (now) => {
    const dt = Math.min(0.05, state.last ? (now - state.last) / 1000 : 0.016);
    state.last = now;
    const k = state.stiffness;
    const c = 2 * Math.sqrt(k) * 1.02;
    state.v += ((state.target - state.p) * k - state.v * c) * dt;
    state.p += state.v * dt;
    const settled = Math.abs(state.target - state.p) < 0.0004 && Math.abs(state.v) < 0.001;
    if (settled) {
      state.p = state.target;
      state.v = 0;
    }
    const fading = draw(now);
    onProgress?.(state.p);
    if ((settled && !fading) || document.hidden) {
      state.raf = 0;
      state.last = 0;
      return;
    }
    state.raf = requestAnimationFrame(step);
  };

  function kick() {
    if (!state.raf) state.raf = requestAnimationFrame(step);
  }

  const ro = new ResizeObserver(() => {
    const prevS = state.S;
    measure();
    if (state.album && prevS !== state.S) build(state.album);
    kick();
  });
  ro.observe(canvas);
  measure();
  const onVisibility = () => {
    if (!document.hidden) kick();
  };
  document.addEventListener("visibilitychange", onVisibility);

  return {
    setFamily(family) {
      state.family = family;
    },
    setAlbum(album) {
      return build(album);
    },
    setTarget(t, stiffness = 38) {
      state.target = Math.min(1, Math.max(0, t));
      state.stiffness = stiffness;
      kick();
    },
    get target() {
      return state.target;
    },
    square() {
      return { x: state.ox, y: state.oy, S: state.S };
    },
    destroy() {
      state.token += 1;
      cancelAnimationFrame(state.raf);
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    },
  };
}
