const SPREAD = 0.7;
const WINDOW = 0.42;

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

function posterPoints(album, S, family, count) {
  const c = document.createElement("canvas");
  c.width = S;
  c.height = S;
  const g = c.getContext("2d", { willReadFrequently: true });
  const words = album.title.split(" ");
  const lines = [];
  words.forEach((w) => {
    const last = lines[lines.length - 1];
    if (last && (last + " " + w).length <= 7) lines[lines.length - 1] = `${last} ${w}`;
    else lines.push(w);
  });
  g.font = `700 100px ${family}`;
  const widest = Math.max(...lines.map((l) => g.measureText(l).width));
  const lead = 0.86;
  const metaRatio = 0.2;
  const fs = Math.min((S * 0.98 * 100) / widest, (S * 0.94) / (lines.length * lead + metaRatio * 1.6));
  const block = lines.length * fs * lead + fs * metaRatio * 1.6;
  let y = (S - block) / 2 + fs * 0.78;
  g.fillStyle = "#000";
  g.textBaseline = "alphabetic";
  g.font = `700 ${fs}px ${family}`;
  if ("letterSpacing" in g) g.letterSpacing = `${(-0.04 * fs).toFixed(2)}px`;
  lines.forEach((l) => {
    g.fillText(l, 0, y);
    y += fs * lead;
  });
  const meta = fs * metaRatio;
  g.font = `600 ${meta}px ${family}`;
  if ("letterSpacing" in g) g.letterSpacing = `${(-0.01 * meta).toFixed(2)}px`;
  g.fillText(`${album.artist}, ${album.year}`, 2, y - fs * lead + meta * 1.7);
  const data = g.getImageData(0, 0, S, S).data;
  let ink = 0;
  for (let i = 3; i < data.length; i += 16) if (data[i] > 127) ink += 1;
  const area = ink * 4;
  const step = Math.max(1.2, Math.sqrt(area / count));
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
      const j = (hash(i) - 0.5) * step * 0.6;
      out.push([p[0] + j, p[1] + (hash(i + 7) - 0.5) * step * 0.6]);
    }
  }
  return { pts: out, size: step * 0.94 };
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
    G: 80,
    parts: null,
    cell: 5,
    textSize: 3,
    p: 0,
    v: 0,
    target: 0,
    raf: 0,
    last: 0,
    album: null,
    token: 0,
    family: "sans-serif",
    dirty: true,
  };

  const measure = () => {
    const rect = canvas.getBoundingClientRect();
    state.w = Math.max(1, rect.width);
    state.h = Math.max(1, rect.height);
    state.dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(state.w * state.dpr);
    canvas.height = Math.round(state.h * state.dpr);
    const compact = state.w < 640;
    const S = Math.floor(compact ? Math.min(state.w - 48, state.h - 300) : Math.min(state.w * 0.42, state.h - 300, 480));
    state.S = Math.max(200, S);
    state.ox = Math.round((state.w - state.S) / 2);
    state.oy = Math.round(Math.max(compact ? 176 : 140, (state.h - state.S) / 2 - 24));
  };

  const build = async (album) => {
    const token = ++state.token;
    const img = await loadImage(album.cover);
    if (token !== state.token) return;
    const S = state.S;
    const G = Math.round(Math.min(110, Math.max(64, S / 4.4)));
    const sample = document.createElement("canvas");
    sample.width = G;
    sample.height = G;
    const sg = sample.getContext("2d", { willReadFrequently: true });
    sg.drawImage(img, 0, 0, G, G);
    const px = sg.getImageData(0, 0, G, G).data;
    const count = G * G;
    const cell = S / G;
    const { pts, size } = posterPoints(album, S, state.family, count);
    const homes = [];
    for (let i = 0; i < count; i += 1) {
      const gx = i % G;
      const gy = Math.floor(i / G);
      homes.push({ x: (gx + 0.5) * cell, y: (gy + 0.5) * cell, i });
    }
    const key = (x, y) => x + y * 0.35;
    homes.sort((a, b) => key(a.x, a.y) - key(b.x, b.y));
    const targets = pts.slice().sort((a, b) => key(a[0], a[1]) - key(b[0], b[1]));
    const parts = new Array(count);
    for (let k = 0; k < count; k += 1) {
      const h = homes[k];
      const t = targets[k];
      const o = h.i * 4;
      parts[k] = {
        hx: h.x,
        hy: h.y,
        tx: t[0],
        ty: t[1],
        d: (Math.min(h.x, t[0]) / S) * SPREAD + hash(k) * 0.08,
        lift: 12 + hash(k + 3) * 36,
        swirl: (hash(k + 11) - 0.5) * 2,
        color: `rgb(${px[o] & 248},${px[o + 1] & 248},${px[o + 2] & 248})`,
      };
    }
    parts.sort((a, b) => (a.color < b.color ? -1 : 1));
    state.parts = parts;
    state.cell = cell;
    state.textSize = size;
    state.album = album;
    state.dirty = true;
    kick();
  };

  const draw = () => {
    const { parts, dpr, ox, oy } = state;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!parts) return;
    ctx.setTransform(dpr, 0, 0, dpr, ox * dpr, oy * dpr);
    const P = state.p * (SPREAD + 0.08 + WINDOW);
    let color = "";
    for (let k = 0; k < parts.length; k += 1) {
      const a = parts[k];
      const raw = Math.min(1, Math.max(0, (P - a.d) / WINDOW));
      const t = raw * raw * (3 - 2 * raw);
      const arc = Math.sin(Math.PI * t);
      const x = a.hx + (a.tx - a.hx) * t + arc * a.swirl * 10;
      const y = a.hy + (a.ty - a.hy) * t - arc * a.lift;
      const s = state.cell + (state.textSize - state.cell) * t + arc * 1.6;
      if (a.color !== color) {
        color = a.color;
        ctx.fillStyle = color;
      }
      const seam = 0.7 * (1 - t);
      ctx.fillRect(x - s / 2, y - s / 2, s + seam, s + seam);
    }
  };

  const step = (now) => {
    const dt = Math.min(0.05, state.last ? (now - state.last) / 1000 : 0.016);
    state.last = now;
    const k = 38;
    const c = 11.5;
    state.v += ((state.target - state.p) * k - state.v * c) * dt;
    state.p += state.v * dt;
    const settled = Math.abs(state.target - state.p) < 0.0005 && Math.abs(state.v) < 0.001;
    if (settled) {
      state.p = state.target;
      state.v = 0;
    }
    draw();
    onProgress?.(state.p);
    state.dirty = false;
    if (settled || document.hidden) {
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
    state.dirty = true;
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
    setTarget(t) {
      state.target = Math.min(1, Math.max(0, t));
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
