import {
  CUT_INDEX,
  ENCORE,
  ENCORE_BASELINE,
  FIRST_BASELINE,
  HEADER,
  KEY_LABEL,
  LINE_STEP,
  SHEET_H,
  SHEET_W,
  SONGS,
} from "./eraseSetlist";

export const FAMILY = "EraseHand";
export const GRID = 4;
export const GRID_COLS = Math.ceil(SHEET_W / GRID);
export const GRID_ROWS = Math.ceil(SHEET_H / GRID);

let fontPromise = null;

export function loadHand() {
  if (fontPromise) return fontPromise;
  if (typeof FontFace === "undefined") {
    fontPromise = Promise.resolve(false);
    return fontPromise;
  }
  const face = new FontFace(FAMILY, "url(/fonts/Geist-Variable.woff2)", { weight: "100 900" });
  fontPromise = face
    .load()
    .then((loaded) => {
      document.fonts.add(loaded);
      return true;
    })
    .catch(() => false);
  return fontPromise;
}

export function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash(ix, iy, seed) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function noise(x, y, seed) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy, seed);
  const b = hash(ix + 1, iy, seed);
  const c = hash(ix, iy + 1, seed);
  const d = hash(ix + 1, iy + 1, seed);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

export function smooth(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function blurPass(src, dst, w, h, r, horizontal) {
  const inv = 1 / (2 * r + 1);
  const outer = horizontal ? h : w;
  const inner = horizontal ? w : h;
  const step = horizontal ? 1 : w;
  for (let o = 0; o < outer; o += 1) {
    const base = horizontal ? o * w : o;
    let acc = 0;
    for (let i = -r; i <= r; i += 1) acc += src[base + Math.min(inner - 1, Math.max(0, i)) * step];
    for (let i = 0; i < inner; i += 1) {
      dst[base + i * step] = acc * inv;
      acc += src[base + Math.min(inner - 1, i + r + 1) * step] - src[base + Math.max(0, i - r) * step];
    }
  }
}

export function boxBlur(src, w, h, r) {
  const a = new Float32Array(src);
  const b = new Float32Array(src.length);
  for (let pass = 0; pass < 2; pass += 1) {
    blurPass(a, b, w, h, r, true);
    blurPass(b, a, w, h, r, false);
  }
  return a;
}

export function makeCanvas(w, h) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, w);
  canvas.height = Math.max(1, h);
  return canvas;
}

function sample(src, w, h, x, y) {
  const x0 = Math.max(0, Math.min(w - 2, Math.floor(x)));
  const y0 = Math.max(0, Math.min(h - 2, Math.floor(y)));
  const fx = Math.min(1, Math.max(0, x - x0));
  const fy = Math.min(1, Math.max(0, y - y0));
  const i = y0 * w + x0;
  const a = src[i] + (src[i + 1] - src[i]) * fx;
  const b = src[i + w] + (src[i + w + 1] - src[i + w]) * fx;
  return a + (b - a) * fy;
}

function shape(src, w, h, s, o) {
  const amp = o.wobble * s;
  const f = 1 / (o.scale * s);
  const reach = boxBlur(src, w, h, Math.ceil(amp) + 2);
  const moved = new Float32Array(w * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x;
      if (reach[i] < 0.0005) continue;
      const dx = (noise(x * f, y * f, o.seed) - 0.5) * 2 * amp;
      const dy = (noise(x * f + 31.7, y * f + 12.9, o.seed + 1) - 0.5) * 2 * amp;
      moved[i] = sample(src, w, h, x + dx, y + dy);
    }
  }
  const soft = boxBlur(moved, w, h, Math.max(1, Math.round(o.round * s)));
  for (let i = 0; i < soft.length; i += 1) soft[i] = smooth(o.lo, o.hi, soft[i]);
  return soft;
}

export function defaultTitles() {
  return [...SONGS.map((song) => song.title), ENCORE.title];
}

export function layoutHand(family, titles = defaultTitles()) {
  const ctx = makeCanvas(8, 8).getContext("2d");
  let rng = mulberry(20261017);
  const reseed = (n) => {
    rng = mulberry(20261017 + n * 7919);
  };
  const gauss = (sigma) => (rng() + rng() + rng() - 1.5) * 2 * sigma;
  const glyphs = [];
  const strokes = [];
  const lines = [];

  const write = (text, x, y, size, weight, ink, opts = {}) => {
    const slope = gauss(opts.slope ?? 0.007) + (opts.tilt ?? 0);
    let cx = x + gauss(2);
    const base = y + gauss(1.5);
    const startX = cx;
    let minX = Infinity;
    let maxX = -Infinity;
    const chars = [...text];
    chars.forEach((ch, i) => {
      const shrink = 1 - (i / Math.max(1, chars.length)) * (opts.shrink ?? 0.06);
      const size1 = size * shrink * (1 + gauss(0.03));
      const sx = 1 + gauss(0.04);
      const sy = 1 + gauss(0.045);
      const w = Math.round(weight + gauss(opts.weightJitter ?? 20));
      ctx.font = `${w} ${size1}px ${family}`;
      const adv = ctx.measureText(ch).width * sx;
      if (ch === " ") {
        cx += adv * (0.85 + rng() * 0.35);
        return;
      }
      const gy = base + slope * (cx - startX) + gauss(size * 0.02);
      glyphs.push({ ch, x: cx, y: gy, size: size1, weight: w, rot: gauss(0.03) + slope, sx, sy, skew: -0.07 + gauss(0.025), ink });
      minX = Math.min(minX, cx);
      maxX = Math.max(maxX, cx + adv);
      cx += adv + (opts.track ?? size * 0.03) + gauss(size * 0.018);
    });
    return { x0: minX, x1: maxX, top: base - size * 0.8, bottom: base + size * 0.1, base, slope, startX };
  };

  const measure = (text, size, weight) => {
    ctx.font = `${weight} ${size}px ${family}`;
    return ctx.measureText(text).width * 1.04;
  };

  const pen = (ink, p, width, n, opts = {}) => {
    const pts = [];
    for (let i = 0; i <= n; i += 1) {
      const t = i / n;
      const mt = 1 - t;
      const x = mt * mt * mt * p[0][0] + 3 * mt * mt * t * p[1][0] + 3 * mt * t * t * p[2][0] + t * t * t * p[3][0];
      const y = mt * mt * mt * p[0][1] + 3 * mt * mt * t * p[1][1] + 3 * mt * t * t * p[2][1] + t * t * t * p[3][1];
      const lift = opts.taper ?? 0.4;
      const w = width * (0.5 + 0.5 * Math.pow(Math.sin(Math.PI * Math.min(1, 0.08 + t * 0.92)), 0.5)) * (1 - lift * t * t * t) * (1 + gauss(0.05));
      pts.push([x + gauss(0.35), y + gauss(0.35), Math.max(width * 0.3, w)]);
    }
    strokes.push({ ink, pts });
  };

  write(HEADER, 98, 132, 50, 600, 0, { shrink: 0.04 });
  const labelW = measure(KEY_LABEL, 44, 544);
  write(KEY_LABEL, 902 - labelW, 128, 44, 544, 1, { track: 2 });
  pen(0, [[92, 166], [240, 158], [420, 170], [586, 158]], 6.5, 40, { taper: 0.55 });

  const fitSize = (text) => {
    const width = measure(text, 64, 640) + text.length * 64 * 0.03;
    return Math.max(36, Math.min(64, (64 * 720) / Math.max(1, width)));
  };

  const empty = (y) => ({ x0: 118, x1: 118, top: y - 64 * 0.8, bottom: y + 64 * 0.1, base: y, slope: 0, startX: 118 });

  SONGS.forEach((song, i) => {
    const y = FIRST_BASELINE + i * LINE_STEP;
    const title = titles[i] ?? "";
    reseed(i + 1);
    const tilt = (rng() - 0.5) * 0.012;
    const written = title.trim() ? write(title, 118, y, fitSize(title), 640, 0, { tilt }) : empty(y);
    const keyW = measure(song.key, 40, 560);
    reseed(i + 101);
    const key = write(song.key, 906 - keyW, y - 2, 40, 560, 1, { track: 1.5 });
    lines.push({ ...written, key, title, index: i, y });
  });

  reseed(200);

  pen(0, [[118, 1040], [200, 1046], [300, 1036], [396, 1044]], 5, 30, { taper: 0.5 });
  write("Encore", 118, ENCORE_BASELINE - 80, 42, 540, 1, { track: 2 });
  const encoreTitle = titles[SONGS.length] ?? "";
  reseed(300);
  const encore = encoreTitle.trim() ? write(encoreTitle, 118, ENCORE_BASELINE, fitSize(encoreTitle), 640, 0, { tilt: -0.006 }) : empty(ENCORE_BASELINE);
  const encKeyW = measure(ENCORE.key, 40, 560);
  reseed(301);
  const encKey = write(ENCORE.key, 906 - encKeyW, ENCORE_BASELINE - 2, 40, 560, 1, { track: 1.5 });
  lines.push({ ...encore, key: encKey, title: encoreTitle, index: SONGS.length, y: ENCORE_BASELINE });
  reseed(400);

  const cx = 80;
  const cy = ENCORE_BASELINE - 24;
  const star = [];
  for (let i = 0; i <= 5; i += 1) {
    const a = -Math.PI / 2 + i * ((Math.PI * 4) / 5);
    star.push([cx + Math.cos(a) * 17 + gauss(1), cy + Math.sin(a) * 17 + gauss(1)]);
  }
  for (let i = 0; i < 5; i += 1) {
    const a = star[i];
    const b = star[i + 1];
    pen(1, [a, [a[0] + (b[0] - a[0]) / 3, a[1] + (b[1] - a[1]) / 3], [a[0] + ((b[0] - a[0]) * 2) / 3, a[1] + ((b[1] - a[1]) * 2) / 3], b], 3.2, 6, { taper: 0 });
  }

  return { glyphs, strokes, lines, cut: lines[CUT_INDEX] };
}

function drawHand(ctx, hand, ink, family) {
  for (const g of hand.glyphs) {
    if (g.ink !== ink) continue;
    ctx.save();
    ctx.translate(g.x, g.y);
    ctx.rotate(g.rot);
    ctx.transform(1, 0, g.skew, 1, 0, 0);
    ctx.scale(g.sx, g.sy);
    ctx.font = `${g.weight} ${g.size}px ${family}`;
    ctx.fillText(g.ch, 0, 0);
    ctx.restore();
  }
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const st of hand.strokes) {
    if (st.ink !== ink) continue;
    for (let i = 0; i < st.pts.length - 1; i += 1) {
      const a = st.pts[i];
      const b = st.pts[i + 1];
      ctx.lineWidth = (a[2] + b[2]) / 2;
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.stroke();
    }
  }
}

export function bakeInk(hand, pw, ph, family) {
  const s = pw / SHEET_W;
  const n = pw * ph;
  const canvas = makeCanvas(pw, ph);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const read = (ink) => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, pw, ph);
    ctx.setTransform(s, 0, 0, s, 0, 0);
    ctx.fillStyle = "#000";
    ctx.strokeStyle = "#000";
    ctx.textBaseline = "alphabetic";
    drawHand(ctx, hand, ink, family);
    const data = ctx.getImageData(0, 0, pw, ph).data;
    const a = new Float32Array(n);
    for (let i = 0; i < n; i += 1) a[i] = data[i * 4 + 3] / 255;
    return a;
  };
  const m = shape(read(0), pw, ph, s, { wobble: 1.1, scale: 9, round: 1.05, lo: 0.34, hi: 0.6, seed: 21 });
  const b = shape(read(1), pw, ph, s, { wobble: 0.55, scale: 6, round: 0.4, lo: 0.3, hi: 0.66, seed: 23 });
  const bm = boxBlur(m, pw, ph, Math.max(1, Math.round(2.4 * s)));
  const total = new Float32Array(n);
  for (let i = 0; i < n; i += 1) total[i] = 1 - (1 - m[i]) * (1 - b[i]);
  const smudge = boxBlur(total, pw, ph, Math.max(2, Math.round(6 * s)));

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const inkImage = ctx.createImageData(pw, ph);
  const ink = inkImage.data;
  for (let y = 1; y < ph - 1; y += 1) {
    for (let x = 1; x < pw - 1; x += 1) {
      const i = y * pw + x;
      const ma = m[i];
      const ba = b[i];
      if (ma + ba < 0.004) continue;
      const u = x / s;
      const v = y / s;
      let r = 0;
      let g = 0;
      let bl = 0;
      let am = 0;
      if (ma > 0.004) {
        const rim = Math.min(1, Math.max(0, (ma - bm[i]) * 3));
        const streak = noise(u * 0.09, v * 0.85, 31);
        const density = Math.min(1, 0.84 + 0.16 * rim + 0.1 * (streak - 0.5));
        const gx = bm[i + 1] - bm[i - 1];
        const gy = bm[i + pw] - bm[i - pw];
        const lit = Math.min(1, Math.max(0, (gx * 0.8 + gy) * s * 1.1));
        const sheen = lit * lit * 0.42 * (0.6 + 0.4 * streak);
        const thin = (1 - ma) * 0.55;
        r = 24 - 8 * rim + 34 * thin;
        g = 22 - 8 * rim + 26 * thin;
        bl = 32 - 8 * rim + 46 * thin;
        r += (138 - r) * sheen;
        g += (136 - g) * sheen;
        bl += (158 - bl) * sheen;
        am = ma * density;
      }
      let ab = 0;
      if (ba > 0.004) {
        const grain = noise(u * 0.6, v * 0.6, 37);
        const skip = noise(u * 0.32 + 7, v * 0.32, 41) > 0.82 ? 0.8 : 1;
        ab = ba * (0.74 + 0.26 * grain) * skip * 0.92;
      }
      const a = ab + am * (1 - ab);
      if (a <= 0) continue;
      const k = am * (1 - ab);
      const o = i * 4;
      ink[o] = (r * k + 36 * ab) / a;
      ink[o + 1] = (g * k + 52 * ab) / a;
      ink[o + 2] = (bl * k + 132 * ab) / a;
      ink[o + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(inkImage, 0, 0);
  const inkCanvas = canvas;

  const fxCanvas = makeCanvas(pw, ph);
  const fctx = fxCanvas.getContext("2d");
  const fxImage = fctx.createImageData(pw, ph);
  const fx = fxImage.data;
  for (let y = 0; y < ph; y += 1) {
    for (let x = 0; x < pw; x += 1) {
      const i = y * pw + x;
      const u = x / s;
      const v = y / s;
      const fibre = noise(u * 0.5, v * 0.13, 43) * 0.6 + noise(u * 1.6, v * 0.42, 47) * 0.4;
      let la = 0.05 + 0.26 * smooth(0.52, 0.86, fibre);
      let lr = 255;
      let lg = 253;
      let lb = 247;
      if (hash(x, y, 53) > 0.9984) {
        lr = 150;
        lg = 138;
        lb = 124;
        la = 0.34;
      }
      const sa = Math.min(0.12, smudge[i] * 0.11);
      const a = sa + la * (1 - sa);
      const o = i * 4;
      fx[o] = (66 * sa + lr * la * (1 - sa)) / a;
      fx[o + 1] = (60 * sa + lg * la * (1 - sa)) / a;
      fx[o + 2] = (78 * sa + lb * la * (1 - sa)) / a;
      fx[o + 3] = Math.round(a * 255);
    }
  }
  fctx.putImageData(fxImage, 0, 0);
  return { ink: inkCanvas, fx: fxCanvas, total, blue: b, s };
}

export function coverage(total, blue, pw, ph, s) {
  const cov = new Float32Array(GRID_COLS * GRID_ROWS);
  const tint = new Float32Array(GRID_COLS * GRID_ROWS);
  for (let row = 0; row < GRID_ROWS; row += 1) {
    const y0 = Math.floor(row * GRID * s);
    const y1 = Math.min(ph, Math.max(y0 + 1, Math.floor((row + 1) * GRID * s)));
    for (let col = 0; col < GRID_COLS; col += 1) {
      const x0 = Math.floor(col * GRID * s);
      const x1 = Math.min(pw, Math.max(x0 + 1, Math.floor((col + 1) * GRID * s)));
      let sum = 0;
      let sumB = 0;
      let count = 0;
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          sum += total[y * pw + x];
          sumB += blue[y * pw + x];
          count += 1;
        }
      }
      const idx = row * GRID_COLS + col;
      cov[idx] = count ? sum / count : 0;
      tint[idx] = sum > 0.001 ? Math.min(1, sumB / sum) : 0;
    }
  }
  return { cov, tint };
}

export function makeStamp() {
  const size = 96;
  const canvas = makeCanvas(size, size);
  const ctx = canvas.getContext("2d");
  const image = ctx.createImageData(size, size);
  const half = size / 2;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = (x + 0.5 - half) / half;
      const dy = (y + 0.5 - half) / half;
      const d2 = dx * dx + dy * dy;
      if (d2 >= 1) continue;
      const body = Math.pow(1 - d2, 0.85);
      const streak = 0.5 + 0.5 * noise(x * 0.05, y * 0.7, 61) * 0.7 + 0.15 * noise(x * 0.3, y * 0.3, 67);
      const o = (y * size + x) * 4;
      image.data[o] = 255;
      image.data[o + 1] = 255;
      image.data[o + 2] = 255;
      image.data[o + 3] = Math.round(Math.min(1, body * streak) * 255);
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

function grainTile(seed, dpr) {
  const size = 192;
  const canvas = makeCanvas(size, size);
  const ctx = canvas.getContext("2d");
  const image = ctx.createImageData(size, size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const v = hash(x, y, seed) * 0.55 + noise(x * 0.35, y * 0.35, seed + 3) * 0.45;
      const o = (y * size + x) * 4;
      if (v < 0.5) {
        image.data[o] = 96;
        image.data[o + 1] = 80;
        image.data[o + 2] = 62;
        image.data[o + 3] = Math.round((0.5 - v) * 0.2 * 255);
      } else {
        image.data[o] = 255;
        image.data[o + 1] = 252;
        image.data[o + 2] = 244;
        image.data[o + 3] = Math.round((v - 0.5) * 0.26 * 255);
      }
    }
  }
  ctx.putImageData(image, 0, 0);
  return { canvas, scale: 1 / dpr };
}

function patterned(ctx, tile) {
  const pattern = ctx.createPattern(tile.canvas, "repeat");
  if (pattern && typeof DOMMatrix !== "undefined") pattern.setTransform(new DOMMatrix().scale(tile.scale));
  return pattern;
}

function drawTape(ctx, cx, cy, len, wid, angle, rng, grain) {
  const pts = [];
  const teeth = 7;
  const hl = len / 2;
  const hw = wid / 2;
  for (let i = 0; i <= teeth; i += 1) pts.push([hl + (rng() - 0.5) * wid * 0.16, -hw + (i / teeth) * wid]);
  for (let i = 0; i <= teeth; i += 1) pts.push([-hl + (rng() - 0.5) * wid * 0.16, hw - (i / teeth) * wid]);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
  ctx.closePath();
  ctx.shadowColor = "rgba(70, 52, 30, 0.16)";
  ctx.shadowBlur = 3;
  ctx.shadowOffsetY = 1;
  ctx.fillStyle = "rgba(233, 222, 192, 0.8)";
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.clip();
  const edge = ctx.createLinearGradient(0, -hw, 0, hw);
  edge.addColorStop(0, "rgba(180, 160, 118, 0.22)");
  edge.addColorStop(0.12, "rgba(255, 250, 236, 0.18)");
  edge.addColorStop(0.5, "rgba(255, 250, 236, 0.04)");
  edge.addColorStop(0.88, "rgba(255, 250, 236, 0.1)");
  edge.addColorStop(1, "rgba(160, 140, 100, 0.26)");
  ctx.fillStyle = edge;
  ctx.fillRect(-hl - wid, -hw, len + wid * 2, wid);
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = patterned(ctx, grain);
  ctx.fillRect(-hl - wid, -hw, len + wid * 2, wid);
  ctx.restore();
}

export function bakeScene(canvas, geo, dpr) {
  const { W, H, sheetX, sheetY, sheetW, sheetH, ledgeY, ledgeT, ledgeF } = geo;
  canvas.width = Math.max(1, Math.round(W * dpr));
  canvas.height = Math.max(1, Math.round(H * dpr));
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const grain = grainTile(71, dpr);

  const wall = ctx.createLinearGradient(0, 0, 0, H);
  wall.addColorStop(0, "#ebe7df");
  wall.addColorStop(0.4, "#e7e2d9");
  wall.addColorStop(0.75, "#e2ddd3");
  wall.addColorStop(1, "#ddd7cc");
  ctx.fillStyle = wall;
  ctx.fillRect(0, 0, W, H);
  const lightR = Math.max(W, H);
  const light = ctx.createRadialGradient(W * 0.32, H * 0.12, 0, W * 0.32, H * 0.12, lightR);
  light.addColorStop(0, "rgba(255, 253, 247, 0.55)");
  light.addColorStop(0.3, "rgba(255, 253, 247, 0.3)");
  light.addColorStop(0.6, "rgba(255, 253, 247, 0.1)");
  light.addColorStop(1, "rgba(255, 253, 247, 0)");
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 0.7;
  ctx.fillStyle = patterned(ctx, grain);
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 1;

  const under = ledgeY + ledgeT + ledgeF;
  const drop = ctx.createLinearGradient(0, under, 0, under + ledgeF * 3.2);
  drop.addColorStop(0, "rgba(74, 58, 40, 0.24)");
  drop.addColorStop(0.2, "rgba(74, 58, 40, 0.12)");
  drop.addColorStop(0.5, "rgba(74, 58, 40, 0.04)");
  drop.addColorStop(1, "rgba(74, 58, 40, 0)");
  ctx.fillStyle = drop;
  ctx.fillRect(0, under, W, ledgeF * 3.2);

  const top = ctx.createLinearGradient(0, ledgeY, 0, ledgeY + ledgeT);
  top.addColorStop(0, "#d9d2c5");
  top.addColorStop(0.3, "#e6e0d5");
  top.addColorStop(0.7, "#efeae1");
  top.addColorStop(1, "#f4f0e8");
  ctx.fillStyle = top;
  ctx.fillRect(0, ledgeY, W, ledgeT);
  const contact = ctx.createLinearGradient(0, ledgeY, 0, ledgeY + ledgeT * 0.6);
  contact.addColorStop(0, "rgba(64, 50, 34, 0.2)");
  contact.addColorStop(0.4, "rgba(64, 50, 34, 0.07)");
  contact.addColorStop(1, "rgba(64, 50, 34, 0)");
  ctx.fillStyle = contact;
  ctx.fillRect(sheetX - ledgeT, ledgeY, sheetW + ledgeT * 2, ledgeT * 0.6);
  const face = ctx.createLinearGradient(0, ledgeY + ledgeT, 0, under);
  face.addColorStop(0, "#ddd6ca");
  face.addColorStop(0.5, "#d4ccbf");
  face.addColorStop(1, "#cbc3b5");
  ctx.fillStyle = face;
  ctx.fillRect(0, ledgeY + ledgeT, W, ledgeF);
  ctx.fillStyle = "rgba(255, 255, 255, 0.75)";
  ctx.fillRect(0, ledgeY + ledgeT, W, 1);
  ctx.fillStyle = "rgba(90, 74, 54, 0.22)";
  ctx.fillRect(0, under - 1, W, 1);
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = patterned(ctx, grain);
  ctx.fillRect(0, ledgeY, W, ledgeT + ledgeF);
  ctx.globalAlpha = 1;

  ctx.save();
  ctx.fillStyle = "#f4f0e7";
  ctx.shadowColor = "rgba(70, 52, 30, 0.14)";
  ctx.shadowBlur = 22;
  ctx.shadowOffsetY = 6;
  ctx.fillRect(sheetX, sheetY, sheetW, sheetH);
  ctx.shadowColor = "rgba(70, 52, 30, 0.16)";
  ctx.shadowBlur = 2;
  ctx.shadowOffsetY = 1;
  ctx.fillRect(sheetX, sheetY, sheetW, sheetH);
  ctx.restore();

  const px0 = Math.round(sheetX * dpr);
  const py0 = Math.round(sheetY * dpr);
  const pw = Math.round(sheetW * dpr);
  const ph = Math.round(sheetH * dpr);
  const s = pw / SHEET_W;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const image = ctx.createImageData(pw, ph);
  const data = image.data;
  for (let y = 0; y < ph; y += 1) {
    const v = y / s;
    for (let x = 0; x < pw; x += 1) {
      const u = x / s;
      const tooth = (noise(u * 0.42, v * 0.42, 3) - 0.5) * 0.045 + (noise(u * 1.3, v * 1.3, 5) - 0.5) * 0.03 + (noise(u * 0.03, v * 0.045, 9) - 0.5) * 0.04;
      const light2 = 0.016 * (1 - u / SHEET_W) + 0.02 * (1 - v / SHEET_H) - 0.016;
      const d = v - SHEET_H * 0.5;
      const crease = -0.022 * Math.exp(-(d * d) / 2.4) + 0.016 * Math.exp(-((d + 2.6) * (d + 2.6)) / 5) - 0.014 * Math.exp(-((d - 7) * (d - 7)) / 160) + 0.008 * Math.exp(-((d + 12) * (d + 12)) / 220);
      const e = Math.min(u, SHEET_W - u, v, SHEET_H - v);
      const edge = -0.06 * Math.exp(-e / 1.2);
      const L = 1 + tooth + light2 + crease + edge;
      const o = (y * pw + x) * 4;
      data[o] = 246 * L;
      data[o + 1] = 242 * L;
      data[o + 2] = 233 * L;
      data[o + 3] = 255;
    }
  }
  ctx.putImageData(image, px0, py0);

  const rng = mulberry(311);
  ctx.save();
  ctx.beginPath();
  ctx.rect(px0, py0, pw, ph);
  ctx.clip();
  ctx.setTransform(s, 0, 0, s, px0, py0);
  ctx.lineCap = "round";
  for (let i = 0; i < 260; i += 1) {
    const x = rng() * SHEET_W;
    const y = rng() * SHEET_H;
    const a = rng() * Math.PI * 2;
    const len = 6 + rng() * 22;
    const bend = (rng() - 0.5) * len * 0.6;
    const light3 = rng() < 0.55;
    ctx.strokeStyle = light3 ? "rgba(255, 255, 255, 0.5)" : "rgba(150, 132, 104, 0.16)";
    ctx.lineWidth = Math.max(0.7 / s, 0.35 + rng() * 0.4);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + Math.cos(a) * len * 0.5 - Math.sin(a) * bend, y + Math.sin(a) * len * 0.5 + Math.cos(a) * bend, x + Math.cos(a) * len, y + Math.sin(a) * len);
    ctx.stroke();
  }
  ctx.restore();

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const tapeL = sheetW * 0.2;
  const tapeW = sheetW * 0.062;
  const trng = mulberry(97);
  drawTape(ctx, sheetX + sheetW * 0.035, sheetY + sheetW * 0.028, tapeL, tapeW, -0.72, trng, grain);
  drawTape(ctx, sheetX + sheetW * 0.965, sheetY + sheetW * 0.03, tapeL, tapeW, 0.66, trng, grain);
}
