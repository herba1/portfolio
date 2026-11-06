import { createStage, clamp, damp } from "../_kit/stage";

// Dry transfer lettering. The letters are printed in reverse on the back of a
// translucent carrier with a low-tack adhesive over them. Rubbing presses the
// adhesive onto the paper; where the bond beats the carrier the ink lets go,
// and the letter on the sheet goes grey and silvery because it is now the
// paper's ink you see through the film. Light rubbing lets go in patches,
// and the film flexing under the burnisher cracks the letter into pieces
// that do not all come away.
//
// Everything that is printed on the sheet (letters, spacing marks, crop
// marks, the footer) lives in one ink mask in sheet space, with a pressure
// buffer, a per-pixel release threshold (noise: the adhesive is uneven) and
// a crack mask (warped Voronoi edges per glyph). A rub stamps pressure along
// the stroke; pixels that pass their threshold are released, and copied onto
// the paper through the sheet's current pose.

const FAMILY = '"Letraset Geist", Geist, system-ui, sans-serif';
const LYRIC = "JUST FOR ONE DAY";
// Letters by frequency, the way a sheet is laid out.
const ROWS = ["EEEEEEAAAAAAA", "TTTTTOOOONNNN", "IIIIRRRRSSSHHH", "DDDLLLUUUCCCMM", "WWFFGGYYPPBBVK", "JJQXZ&!?.,1234567890"];
const LETTERS = LYRIC.replace(/ /g, "").length;

const weight = (name, fallback) => {
  const v = parseInt(getComputedStyle(document.documentElement).getPropertyValue(`--font-weight-${name}`), 10);
  return Number.isFinite(v) ? v : fallback;
};

async function loadFont() {
  try {
    const face = new FontFace("Letraset Geist", "url(/fonts/Geist-Variable.woff2)", { weight: "100 900" });
    await face.load();
    document.fonts.add(face);
  } catch {
    /* falls back to the page's Geist */
  }
  await document.fonts.ready;
}

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash2(x, y, s) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 982451653)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x, y, s) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, s);
  const b = hash2(xi + 1, yi, s);
  const c = hash2(xi, yi + 1, s);
  const d = hash2(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const fbm = (x, y, s) => vnoise(x, y, s) * 0.55 + vnoise(x * 2.07 + 5.3, y * 2.07 + 1.7, s + 1) * 0.3 + vnoise(x * 4.3 + 9.1, y * 4.3 + 3.3, s + 2) * 0.15;
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

const PAPER = [242, 240, 235];
const INK = [17, 17, 18];
const PAPER_INK = "rgb(20, 19, 18)";

// ---------------------------------------------------------------- paper

function makePaper(W, H, R) {
  const cw = Math.round(W * R);
  const ch = Math.round(H * R);
  const cv = document.createElement("canvas");
  cv.width = cw;
  cv.height = ch;
  const x = cv.getContext("2d");
  const img = x.createImageData(cw, ch);
  const d = img.data;
  for (let j = 0; j < ch; j++) {
    for (let i = 0; i < cw; i++) {
      const k = (j * cw + i) * 4;
      // Fine tooth plus a slow cloud in the sheet's formation.
      const g = (hash2(i, j, 7) - 0.5) * 4.2 + (vnoise(i / (60 * R), j / (60 * R), 3) - 0.5) * 3.2 + (vnoise(i / (7 * R), j / (5 * R), 4) - 0.5) * 1.6;
      d[k] = PAPER[0] + g;
      d[k + 1] = PAPER[1] + g;
      d[k + 2] = PAPER[2] + g * 1.1;
      d[k + 3] = 255;
    }
  }
  x.putImageData(img, 0, 0);
  // A few fibres caught in the sheet.
  const r = rng(11);
  x.lineCap = "round";
  for (let n = 0; n < (W * H) / 2600; n++) {
    const px = r() * cw;
    const py = r() * ch;
    const a = r() * Math.PI * 2;
    const len = (6 + r() * 22) * R;
    x.strokeStyle = r() < 0.5 ? "rgba(120,104,80,0.05)" : "rgba(255,255,250,0.22)";
    x.lineWidth = 0.4 * R;
    x.beginPath();
    x.moveTo(px, py);
    x.quadraticCurveTo(px + Math.cos(a) * len * 0.5 + (r() - 0.5) * 6 * R, py + Math.sin(a) * len * 0.5 + (r() - 0.5) * 6 * R, px + Math.cos(a) * len, py + Math.sin(a) * len);
    x.stroke();
  }
  return cv;
}

// ---------------------------------------------------------------- sheet

function layoutSheet(W, H) {
  const SW = Math.round(clamp(W < 640 ? W * 0.74 : W * 0.52, 220, 660));
  const F = Math.round(SW / 13.6);
  const mx = Math.round(F * 0.8);
  const top = Math.round(F * 1.15);
  const rowH = Math.round(F * 1.64);
  const foot = Math.round(F * 1.2);
  const probe = document.createElement("canvas").getContext("2d");
  const wGlyph = weight("semibold", 600);
  probe.font = `${wGlyph} ${F}px ${FAMILY}`;
  const glyphs = [];
  ROWS.forEach((row, ri) => {
    const base = top + ri * rowH + F * 0.95;
    let x = mx;
    for (const ch of row) {
      const m = probe.measureText(ch);
      const adv = m.width;
      if (x + adv > SW - mx) break;
      glyphs.push({
        ch,
        row: ri,
        x,
        base,
        adv,
        l: x - m.actualBoundingBoxLeft,
        r: x + m.actualBoundingBoxRight,
        t: base - m.actualBoundingBoxAscent,
        b: base + m.actualBoundingBoxDescent,
        used: false,
      });
      x += adv + F * 0.36;
    }
  });
  const SH = top + ROWS.length * rowH + foot;
  return { SW, SH, F, mx, top, rowH, foot, glyphs, wGlyph, probe };
}

function printSheet(L, R) {
  const { SW, SH, F, mx, top, rowH, glyphs, wGlyph } = L;
  const cv = document.createElement("canvas");
  cv.width = Math.round(SW * R);
  cv.height = Math.round(SH * R);
  const x = cv.getContext("2d");
  x.scale(R, R);
  x.fillStyle = "#000";
  x.strokeStyle = "#000";
  x.font = `${wGlyph} ${F}px ${FAMILY}`;
  x.textBaseline = "alphabetic";
  const bar = Math.max(1.5, F * 0.04);
  for (const g of glyphs) {
    x.fillText(g.ch, g.x, g.base);
    // Spacing marks: one under each side of the letter's body.
    const my = g.base + F * 0.3;
    x.fillRect(g.x, my, F * 0.13, bar);
    x.fillRect(g.x + g.adv - F * 0.13, my, F * 0.13, bar);
  }
  // Crop marks around the printed field and a register mark.
  x.lineWidth = 0.75;
  const fx0 = mx * 0.45;
  const fx1 = SW - mx * 0.45;
  const fy0 = top * 0.42;
  const fy1 = top + ROWS.length * rowH + F * 0.1;
  const c = F * 0.32;
  for (const [cx, cy, sx, sy] of [[fx0, fy0, 1, 1], [fx1, fy0, -1, 1], [fx0, fy1, 1, -1], [fx1, fy1, -1, -1]]) {
    x.beginPath();
    x.moveTo(cx, cy + sy * c);
    x.lineTo(cx, cy);
    x.lineTo(cx + sx * c, cy);
    x.stroke();
  }
  const rx = SW / 2;
  const ry = fy0;
  x.beginPath();
  x.arc(rx, ry, F * 0.11, 0, Math.PI * 2);
  x.moveTo(rx - F * 0.22, ry);
  x.lineTo(rx + F * 0.22, ry);
  x.moveTo(rx, ry - F * 0.22);
  x.lineTo(rx, ry + F * 0.22);
  x.stroke();
  // Footer, set on the tracking law for its size.
  const fs = Math.max(9, Math.round(F * 0.21));
  x.font = `${weight("caption", 520)} ${fs}px ${FAMILY}`;
  x.letterSpacing = `${(-0.043 * (fs - 12)).toFixed(3)}px`;
  const fyB = SH - L.foot * 0.42;
  x.fillText(`Geist Semibold  ${F} pt`, mx, fyB);
  x.textAlign = "right";
  x.fillText("Sheet 6", SW - mx, fyB);
  return cv;
}

function makeFilm(SW, SH, R) {
  const cw = Math.round(SW * R);
  const ch = Math.round(SH * R);
  const cv = document.createElement("canvas");
  cv.width = cw;
  cv.height = ch;
  const x = cv.getContext("2d");
  const img = x.createImageData(cw, ch);
  const d = img.data;
  for (let j = 0; j < ch; j++) {
    for (let i = 0; i < cw; i++) {
      const k = (j * cw + i) * 4;
      // Matte polyethylene: milky, a little uneven, a fine frost.
      const m = (vnoise(i / (90 * R), j / (70 * R), 21) - 0.5) * 0.05 + (hash2(i, j, 22) - 0.5) * 0.035;
      d[k] = 249;
      d[k + 1] = 250;
      d[k + 2] = 252;
      d[k + 3] = 255 * clamp(0.22 + m, 0, 1);
    }
  }
  x.putImageData(img, 0, 0);
  return cv;
}

// ---------------------------------------------------------------- engine

export async function createLetraset(host, { embedded = false } = {}) {
  await loadFont();
  const stage = createStage(host, { dpr: 2, webgl: false, alpha: false });
  const ctx = stage.ctx;
  const params = new URLSearchParams(location.search);
  const tParam = params.has("t") ? clamp(parseFloat(params.get("t")) || 0, 0, 1) : (9.5 / LETTERS);

  let S = null; // everything sized to the box
  if (params.has("debug")) window.__letraset = () => S;

  const build = (W, H, R) => {
    const L = layoutSheet(W, H);
    const { SW, SH, F } = L;
    const sw = Math.round(SW * R);
    const sh = Math.round(SH * R);
    const n = sw * sh;

    const print = printSheet(L, R);
    const pd = print.getContext("2d").getImageData(0, 0, sw, sh).data;
    const inkA = new Uint8Array(n);
    for (let i = 0; i < n; i++) inkA[i] = pd[i * 4 + 3];

    // The adhesive's grip varies: patches let go early or late, and dust
    // leaves a few pinholes that will not take at all.
    const thr = new Float32Array(n);
    const crack = new Float32Array(n);
    const fs = 1 / (F * 0.16 * R);
    for (let j = 0; j < sh; j++) {
      for (let i = 0; i < sw; i++) {
        const k = j * sw + i;
        if (!inkA[k]) continue;
        let t = 0.42 + 1.25 * fbm(i * fs, j * fs, 31);
        if (vnoise(i / (1.6 * R), j / (1.6 * R), 33) > 0.94) t += 4;
        thr[k] = t;
      }
    }
    // Cracks: warped Voronoi edges inside each glyph; some glyphs barely
    // crack, a few crack across.
    const r = rng(1977);
    for (const g of L.glyphs) {
      const ns = 1 + Math.floor(Math.pow(r(), 1.5) * 4.6);
      if (ns < 2) continue;
      const x0 = Math.floor(g.l * R) - 2;
      const x1 = Math.ceil(g.r * R) + 2;
      const y0 = Math.floor(g.t * R) - 2;
      const y1 = Math.ceil(g.b * R) + 2;
      const seeds = [];
      for (let s = 0; s < ns; s++) seeds.push([x0 + r() * (x1 - x0), y0 + r() * (y1 - y0)]);
      const active = [];
      for (let a = 0; a < ns; a++) for (let b = 0; b < ns; b++) active[a * ns + b] = active[b * ns + a] ?? r() < 0.5;
      const warp = F * 0.12 * R;
      const w = 0.62 * R;
      const seed = Math.floor(r() * 1e6);
      for (let j = Math.max(0, y0); j < Math.min(sh, y1); j++) {
        for (let i = Math.max(0, x0); i < Math.min(sw, x1); i++) {
          const k = j * sw + i;
          if (!inkA[k]) continue;
          const qx = i + (vnoise(i / (6 * R), j / (6 * R), seed) - 0.5) * warp;
          const qy = j + (vnoise(i / (6 * R), j / (6 * R), seed + 9) - 0.5) * warp;
          let a = -1;
          let b = -1;
          let da = 1e9;
          let db = 1e9;
          for (let s = 0; s < ns; s++) {
            const dd = (qx - seeds[s][0]) ** 2 + (qy - seeds[s][1]) ** 2;
            if (dd < da) {
              db = da;
              b = a;
              da = dd;
              a = s;
            } else if (dd < db) {
              db = dd;
              b = s;
            }
          }
          if (b < 0 || !active[a * ns + b]) continue;
          const sep = Math.hypot(seeds[a][0] - seeds[b][0], seeds[a][1] - seeds[b][1]);
          const e = (db - da) / (2 * sep);
          crack[k] = 1 - smooth(0, w, e);
        }
      }
    }

    const ink = document.createElement("canvas");
    ink.width = sw;
    ink.height = sh;
    const inkCtx = ink.getContext("2d");
    const inkImg = inkCtx.createImageData(sw, sh);

    const scuff = document.createElement("canvas");
    scuff.width = sw;
    scuff.height = sh;
    const scuffCtx = scuff.getContext("2d");

    const paperInk = document.createElement("canvas");
    paperInk.width = Math.round(W * R);
    paperInk.height = Math.round(H * R);
    const paperInkCtx = paperInk.getContext("2d");

    S = {
      W, H, R, L, sw, sh, inkA, thr, crack,
      press: new Float32Array(n),
      gone: new Uint8Array(n),
      ink, inkCtx, inkImg, scuff, scuffCtx, paperInk, paperInkCtx,
      paper: makePaper(W, H, R),
      film: makeFilm(SW, SH, R),
      temp: document.createElement("canvas"),
      pose: { x: 0, y: 0, a: 0 },
    };
    paint(0, 0, sw, sh);
    preset();
    warm = 20;
  };

  // Writes the sheet's look for a block of pixels.
  const paint = (x0, y0, x1, y1) => {
    const { sw, inkA, thr, press, gone, crack, inkImg } = S;
    const d = inkImg.data;
    for (let j = y0; j < y1; j++) {
      for (let i = x0; i < x1; i++) {
        const k = j * sw + i;
        const o = k * 4;
        const a = inkA[k];
        if (!a) {
          d[o + 3] = 0;
          continue;
        }
        if (!gone[k]) {
          // Still on the carrier: greys as the bond starts to take.
          const g = smooth(0.2 * thr[k], thr[k], press[k]) * 0.55;
          d[o] = INK[0] + (178 - INK[0]) * g;
          d[o + 1] = INK[1] + (180 - INK[1]) * g;
          d[o + 2] = INK[2] + (186 - INK[2]) * g;
          d[o + 3] = a;
        } else {
          // Released: what is left is a silvery ghost of adhesive, plus any
          // sliver of a crack that stayed behind.
          const sl = (a / 255) * crack[k];
          const gh = (a / 255) * (1 - crack[k]) * (0.3 + 0.08 * (thr[k] - 1));
          const A = sl + gh * (1 - sl);
          const sheen = 206 + 18 * (thr[k] - 0.9);
          const cc = (gh * (1 - sl) * sheen + sl * INK[0]) / Math.max(1e-4, A);
          d[o] = cc;
          d[o + 1] = cc + 1;
          d[o + 2] = cc + 5;
          d[o + 3] = 255 * A;
        }
      }
    }
    S.inkCtx.putImageData(inkImg, 0, 0, x0, y0, x1 - x0, y1 - y0);
  };

  // Lets go of every pixel in the block that has passed its threshold and
  // lays it on the paper through the sheet's pose.
  const release = (x0, y0, x1, y1) => {
    const { sw, inkA, thr, press, gone, crack, R } = S;
    const w = x1 - x0;
    const h = y1 - y0;
    let out = null;
    for (let j = y0; j < y1; j++) {
      for (let i = x0; i < x1; i++) {
        const k = j * sw + i;
        if (!inkA[k] || gone[k] || crack[k] > 0.5 || press[k] < thr[k]) continue;
        gone[k] = 1;
        if (!out) out = new ImageData(w, h);
        const o = ((j - y0) * w + (i - x0)) * 4;
        out.data[o + 3] = inkA[k] * (1 - crack[k]);
      }
    }
    if (!out) return;
    const t = S.temp;
    if (t.width < w || t.height < h) {
      t.width = Math.max(t.width, w);
      t.height = Math.max(t.height, h);
    }
    const tc = t.getContext("2d");
    tc.clearRect(0, 0, w, h);
    tc.putImageData(out, 0, 0);
    tc.globalCompositeOperation = "source-in";
    tc.fillStyle = PAPER_INK;
    tc.fillRect(0, 0, w, h);
    tc.globalCompositeOperation = "source-over";
    const p = S.paperInkCtx;
    p.setTransform(R, 0, 0, R, 0, 0);
    p.translate(S.pose.x, S.pose.y);
    p.rotate(S.pose.a);
    p.drawImage(t, 0, 0, w, h, x0 / R, y0 / R, w / R, h / R);
  };

  // One burnisher stroke from a to b, in sheet units. Each pixel takes the
  // length of the stroke that passed over it, weighted toward the tip's
  // centre, so a stroke deposits the same however the pointer was sampled.
  const rub = (ax, ay, bx, by, gain) => {
    const { R, sw, sh, inkA, press, L } = S;
    const rad = L.F * 0.2;
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy);
    if (len < 0.01) return;
    const ux = dx / len;
    const uy = dy / len;
    const x0 = clamp(Math.floor((Math.min(ax, bx) - rad) * R), 0, sw);
    const x1 = clamp(Math.ceil((Math.max(ax, bx) + rad) * R), 0, sw);
    const y0 = clamp(Math.floor((Math.min(ay, by) - rad) * R), 0, sh);
    const y1 = clamp(Math.ceil((Math.max(ay, by) + rad) * R), 0, sh);
    if (x1 <= x0 || y1 <= y0) return;
    const r2 = rad * rad;
    for (let j = y0; j < y1; j++) {
      const py = (j + 0.5) / R - ay;
      for (let i = x0; i < x1; i++) {
        const k = j * sw + i;
        if (!inkA[k]) continue;
        const px = (i + 0.5) / R - ax;
        const s = px * ux + py * uy;
        const hh = px * uy - py * ux;
        const h2 = hh * hh;
        if (h2 >= r2) continue;
        const half = Math.sqrt(r2 - h2);
        const Lc = Math.min(len, s + half) - Math.max(0, s - half);
        if (Lc <= 0) continue;
        press[k] += gain * (Lc / rad) * (1 - h2 / r2);
      }
    }
    // The carrier takes a faint burnish where it was worked.
    const sc = S.scuffCtx;
    sc.setTransform(R, 0, 0, R, 0, 0);
    sc.strokeStyle = "rgba(255,255,255,0.014)";
    sc.lineCap = "round";
    sc.lineWidth = rad * 1.3;
    sc.beginPath();
    sc.moveTo(ax, ay);
    sc.lineTo(bx, by);
    sc.stroke();
    release(x0, y0, x1, y1);
    paint(x0, y0, x1, y1);
    dirty = true;
  };

  if (params.has("debug")) window.__letrasetRub = (...a) => rub(...a);

  const hatch = (g, { passes, gain, x0 = 0, x1 = 1, y0 = 0, y1 = 1 }, r) => {
    const rad = S.L.F * 0.2;
    const w = g.r - g.l + rad;
    const h = g.b - g.t + rad;
    const L0 = g.l - rad / 2 + w * x0;
    const L1 = g.l - rad / 2 + w * x1;
    const T0 = g.t - rad / 2 + h * y0;
    const T1 = g.t - rad / 2 + h * y1;
    for (let p = 0; p < passes; p++) {
      const pts = [];
      const step = rad * (0.75 + r() * 0.3);
      let left = true;
      const vert = p % 2 === 1;
      if (!vert) {
        for (let y = T0 + r() * step * 0.5; y <= T1; y += step) {
          pts.push(left ? [L0, y] : [L1, y + step * 0.5]);
          pts.push(left ? [L1, y + step * 0.5] : [L0, y + step]);
          left = !left;
        }
      } else {
        for (let x = L0 + r() * step * 0.5; x <= L1; x += step) {
          pts.push(left ? [x, T0] : [x + step * 0.5, T1]);
          pts.push(left ? [x + step * 0.5, T1] : [x + step, T0]);
          left = !left;
        }
      }
      for (let i = 1; i < pts.length; i++) {
        const jx = (r() - 0.5) * 2;
        const jy = (r() - 0.5) * 2;
        rub(pts[i - 1][0], pts[i - 1][1], pts[i][0] + jx, pts[i][1] + jy, gain * (0.8 + r() * 0.4));
      }
    }
  };

  // The lyric, rubbed down by hand: each letter placed by eye, so the
  // spacing and baseline wander a little, and each rubbed differently.
  const RUBS = [
    { passes: 4, gain: 0.3 },
    { passes: 3, gain: 0.26, x1: 0.8 },
    { passes: 4, gain: 0.3 },
    { passes: 3, gain: 0.28 },
    { passes: 4, gain: 0.3 },
    { passes: 2, gain: 0.22 },
    { passes: 4, gain: 0.32 },
    { passes: 3, gain: 0.3 },
    { passes: 3, gain: 0.26, y0: 0.15 },
    { passes: 4, gain: 0.3 },
    { passes: 3, gain: 0.28 },
    { passes: 4, gain: 0.3 },
    { passes: 3, gain: 0.26 },
  ];
  const BASE_A = -0.011;

  const preset = () => {
    const { L, W, H } = S;
    const { F, probe } = L;
    const r = rng(23);
    probe.font = `${L.wGlyph} ${F}px ${FAMILY}`;
    const track = -0.043 * (F - 12);
    // Paper positions relative to the line's start.
    const slots = [];
    let x = 0;
    for (const ch of LYRIC) {
      if (ch === " ") {
        x += F * 0.3 + (r() - 0.5) * F * 0.06;
        continue;
      }
      slots.push({ ch, x, dy: (r() - 0.5) * 1.6, da: (r() - 0.5) * 0.012 });
      x += probe.measureText(ch).width + track + (r() - 0.5) * F * 0.07;
    }
    const lineW = x;
    const doneN = Math.floor(tParam * LETTERS + 1e-6);
    const frac = tParam * LETTERS - doneN;
    const nextI = doneN < LETTERS ? doneN : -1;

    // The letter in hand is the sheet's leftmost of its kind, so the sheet
    // lies to the right of what is already down.
    const pick = (ch, leftmost) => {
      const pool = L.glyphs.filter((g) => g.ch === ch && !g.used);
      if (!pool.length) return null;
      const g = leftmost ? pool.reduce((a, b) => (b.x + b.row * 0.01 < a.x + a.row * 0.01 ? b : a)) : pool[Math.floor(r() * pool.length)];
      g.used = true;
      return g;
    };
    const nextG = nextI >= 0 ? pick(slots[nextI].ch, true) : null;

    // Compose: the line and the sheet together, centred in the box.
    const anchor = nextG || L.glyphs[0];
    const anchorX = nextI >= 0 ? slots[nextI].x : lineW + F * 0.4;
    const spanW = Math.max(lineW, anchorX - anchor.x + L.SW);
    const startX = Math.max(W * 0.06, (W - spanW) / 2);
    const capTop = F * 0.72;
    const spanH = capTop + (L.SH - anchor.base) + (nextI >= 0 ? 0 : F * 1.6);
    const lineY = Math.round(Math.max(capTop + H * 0.06, (H - spanH) / 2 + capTop));

    const place = (g, tx, ty, a) => {
      const c = Math.cos(a);
      const s = Math.sin(a);
      S.pose.a = a;
      S.pose.x = tx - (c * g.x - s * g.base);
      S.pose.y = ty - (s * g.x + c * g.base);
    };
    for (let i = 0; i < doneN; i++) {
      const sl = slots[i];
      const g = pick(sl.ch, false);
      if (!g) continue;
      place(g, startX + sl.x, lineY + sl.dy, BASE_A + sl.da);
      hatch(g, RUBS[i % RUBS.length], r);
    }
    if (nextG) {
      const sl = slots[nextI];
      place(nextG, startX + sl.x, lineY + sl.dy, BASE_A + sl.da);
      if (frac > 0.02) hatch(nextG, { passes: 3, gain: 0.3, y1: clamp(frac * 1.1, 0.1, 1) }, r);
      if (params.has("tip")) {
        // For stills: the burnisher resting where the rub stopped.
        const c = Math.cos(S.pose.a);
        const s = Math.sin(S.pose.a);
        const gx = (nextG.l + nextG.r) / 2 + F * 0.1;
        const gy = nextG.t + (nextG.b - nextG.t) * clamp(frac * 1.1, 0.1, 1);
        hover = [S.pose.x + c * gx - s * gy, S.pose.y + s * gx + c * gy, "rub"];
      }
    } else {
      place(L.glyphs[0], startX + lineW + F * 0.8, lineY + F * 1.8, BASE_A);
    }
    sheet.x = sheet.tx = S.pose.x;
    sheet.y = sheet.ty = S.pose.y;
    sheet.a = sheet.ta = S.pose.a;
    sheet.vx = sheet.vy = sheet.va = 0;
    dirty = true;
  };

  // ---------------------------------------------------------------- input

  const sheet = { x: 0, y: 0, a: 0, tx: 0, ty: 0, ta: 0, vx: 0, vy: 0, va: 0, lift: 0 };
  let mode = null; // "rub" | "drag"
  let grab = null;
  let last = null;
  let dirty = true;
  let hover = null;
  let warm = 0;

  const toSheet = (px, py) => {
    const c = Math.cos(-S.pose.a);
    const s = Math.sin(-S.pose.a);
    const dx = px - S.pose.x;
    const dy = py - S.pose.y;
    return [c * dx - s * dy, s * dx + c * dy];
  };
  const zone = (px, py) => {
    const [sx, sy] = toSheet(px, py);
    const { SW, SH, mx, top, rowH } = S.L;
    if (sx < 0 || sy < 0 || sx > SW || sy > SH) return [null, sx, sy];
    const inField = sx > mx * 0.5 && sx < SW - mx * 0.5 && sy > top * 0.6 && sy < top + ROWS.length * rowH;
    return [inField ? "rub" : "drag", sx, sy];
  };
  const setCursor = (z) => {
    const c = mode === "drag" ? "grabbing" : z === "rub" ? "none" : z === "drag" ? "grab" : "default";
    if (stage.canvas.style.cursor !== c) stage.canvas.style.cursor = c;
  };

  stage.on("down", (p) => {
    if (!S) return;
    const [z, sx, sy] = zone(p.x, p.y);
    if (z === "rub") {
      mode = "rub";
      last = [sx, sy];
    } else if (z === "drag") {
      mode = "drag";
      grab = { dx: sheet.tx - p.x, dy: sheet.ty - p.y, a: sheet.ta };
    }
    hover = [p.x, p.y, z];
    setCursor(z);
    dirty = true;
  });
  stage.on("move", (p) => {
    if (!S) return;
    if (mode === "rub") {
      const [sx, sy] = toSheet(p.x, p.y);
      const sp = Math.hypot(p.vx, p.vy);
      rub(last[0], last[1], sx, sy, 0.24 * clamp(1.25 - sp / 2600, 0.5, 1.25));
      last = [sx, sy];
    } else if (mode === "drag") {
      sheet.tx = p.x + grab.dx;
      sheet.ty = p.y + grab.dy;
      sheet.ta = grab.a + clamp(p.vx * 0.000016, -0.025, 0.025);
    }
    const z = mode ? (mode === "rub" ? "rub" : "drag") : zone(p.x, p.y)[0];
    hover = [p.x, p.y, z];
    setCursor(z);
    dirty = true;
  });
  stage.on("up", (p) => {
    if (mode === "drag") sheet.ta = grab.a;
    mode = null;
    grab = null;
    const z = S ? zone(p.x, p.y)[0] : null;
    hover = [p.x, p.y, z];
    setCursor(z);
    dirty = true;
  });
  stage.canvas.addEventListener("pointerleave", () => {
    hover = null;
    dirty = true;
  });

  stage.onResize((w, h, dpr) => {
    if (S && Math.abs(S.W - w) < 2 && Math.abs(S.H - h) < 2 && S.R === dpr) return;
    for (const g of S?.L.glyphs ?? []) g.used = false;
    build(w, h, dpr);
  });

  // ---------------------------------------------------------------- frame

  stage.onFrame((dt) => {
    if (!S) return;
    // The sheet follows the hand on a spring, a touch under-damped.
    const k = 420;
    const c = 2 * Math.sqrt(k) * 0.86;
    const moving = Math.abs(sheet.tx - sheet.x) + Math.abs(sheet.ty - sheet.y) + Math.abs(sheet.vx) + Math.abs(sheet.vy) > 0.02 || Math.abs(sheet.ta - sheet.a) > 1e-5;
    if (moving) {
      const steps = Math.ceil(dt / (1 / 240));
      const h = dt / steps;
      for (let i = 0; i < steps; i++) {
        sheet.vx += (k * (sheet.tx - sheet.x) - c * sheet.vx) * h;
        sheet.vy += (k * (sheet.ty - sheet.y) - c * sheet.vy) * h;
        sheet.va += (k * (sheet.ta - sheet.a) - c * sheet.va) * h;
        sheet.x += sheet.vx * h;
        sheet.y += sheet.vy * h;
        sheet.a += sheet.va * h;
      }
      dirty = true;
    }
    const lift = damp(sheet.lift, mode === "drag" ? 1 : 0, 14, dt);
    if (Math.abs(lift - sheet.lift) > 1e-4) dirty = true;
    sheet.lift = lift;
    S.pose.x = sheet.x;
    S.pose.y = sheet.y;
    S.pose.a = sheet.a;
    // A few frames after a build, keep drawing: freshly written canvases
    // can reach the compositor a frame late.
    if (warm > 0) {
      warm--;
      dirty = true;
    }
    if (!dirty) return;
    dirty = false;
    draw();
  });

  const draw = () => {
    const { W, H, R, L } = S;
    const dpr = stage.dpr;
    const { SW, SH } = L;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(S.paper, 0, 0, W, H);
    ctx.drawImage(S.paperInk, 0, 0, W, H);

    ctx.save();
    ctx.translate(S.pose.x, S.pose.y);
    ctx.rotate(S.pose.a);
    // Shadow only outside the film, so the sheet stays clear.
    ctx.save();
    ctx.beginPath();
    ctx.rect(-W * 2, -H * 2, W * 4, H * 4);
    ctx.rect(0, 0, SW, SH);
    ctx.clip("evenodd");
    const lf = sheet.lift;
    ctx.shadowColor = `rgba(70, 58, 40, ${0.16 + lf * 0.06})`;
    ctx.shadowBlur = (2.5 + lf * 14) * dpr;
    ctx.shadowOffsetY = (0.8 + lf * 6) * dpr;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, SW, SH);
    ctx.restore();

    ctx.drawImage(S.film, 0, 0, SW, SH);
    ctx.drawImage(S.scuff, 0, 0, SW, SH);
    ctx.drawImage(S.ink, 0, 0, SW, SH);
    // The cut edge catches light; the outside has a hair of dark.
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(255,255,255,0.75)";
    ctx.strokeRect(0.5, 0.5, SW - 1, SH - 1);
    ctx.strokeStyle = "rgba(60,50,40,0.14)";
    ctx.strokeRect(-0.25, -0.25, SW + 0.5, SH + 0.5);
    ctx.restore();

    // The burnisher's tip.
    if (hover && hover[2] === "rub") {
      const [hx, hy] = hover;
      const rad = L.F * 0.2;
      ctx.beginPath();
      ctx.arc(hx, hy, rad, 0, Math.PI * 2);
      ctx.strokeStyle = mode === "rub" ? "rgba(20,20,20,0.32)" : "rgba(20,20,20,0.2)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(hx, hy, mode === "rub" ? 1.6 : 2, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(20,20,20,0.8)";
      ctx.fill();
    }
    void R;
    void embedded;
  };

  return { destroy: () => stage.destroy() };
}
