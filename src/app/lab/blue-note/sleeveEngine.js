import { createStage, clamp } from "../_kit/stage";
import { loadCover } from "../_kit/covers";

// A record sleeve set the way Reid Miles set Blue Note: two inks (black and
// one strong colour) printed on warm board, a photograph separated into
// those two plates, and the title set so big it runs off the square.
//
// Six finished layouts sit on a 3 x 2 torus. Dragging moves a point across
// that torus; the layout is the bilinear blend of the four nearest sleeves,
// with the blend weight pushed through a detent so the point dwells on each
// sleeve and moves between them quickly. Every number in the layout then
// chases its target on its own spring, so the pieces re-compose a beat
// apart. Each ink is drawn on its own plate and overprinted (multiply), the
// black plate a hair out of register with the colour.

const GROUND = "#f2f0eb";
const BOARD = [247, 244, 237];
const COLOUR = [30, 82, 196]; // the one strong ink
const BLACK = [24, 23, 22];
const WEIGHT = 700; // display weight, the top of the ladder

// Let It Be's four portraits, in source pixels (480 square).
const PANELS = [
  [53, 52, 177, 177], // John at the microphone
  [246, 52, 177, 177], // Paul at the microphone
  [53, 244, 177, 177], // Ringo
  [246, 244, 177, 177], // George
];

const COLS = 3;
const ROWS = 2;
const STEP = 0.42; // sleeve widths of drag per layout

const smoother = (u) => u * u * u * (u * (u * 6 - 15) + 10);
const tracking = (px) => -0.043 * (px - 12);

// ---------------------------------------------------------------- layouts
// All lengths are in sleeve widths. Words anchor at their baseline-left.
// k / c: how much black / colour ink a word carries; neither is a knockout.
function layouts(adv) {
  const W = (x, y, s, o = {}) => ({ x, y, s, sx: 1, r: 0, k: 1, c: 0, ...o });
  const line = (x, y, s, o = {}, gap = 0.26) => {
    const a = W(x, y, s, o);
    const b = W(x + s * (adv.let + gap), y, s, o);
    const c = W(b.x + s * (adv.it + gap), y, s, o);
    return [a, b, c];
  };
  const photo = (x, y, w, h, p, fx = 0.5, fy = 0.5, z = 1) => ({ x, y, w, h, p, fx, fy, z });
  const none = { x: 0, y: 0, w: 0, h: 0 };

  return [
    // 0. The plain one: picture on top, the title one line, cut by the edge.
    {
      photo: photo(0, 0, 1, 0.6, 0, 0.5, 0.42, 1.06),
      block: { x: 0, y: 0.6, w: 0, h: 0.4 },
      words: line(-0.012, 0.968, 0.38),
      credit: W(0.05, 0.672, 0.042, { k: 0, c: 1 }),
    },
    // 1. Unit Structures: the title stacked down the left, a tall portrait.
    {
      photo: photo(0.5, 0, 0.5, 1, 1, 0.47, 0.5, 1),
      block: none,
      words: [W(0.03, 0.43, 0.44), W(0.03, 0.75, 0.44, { k: 0, c: 1 }), W(0.03, 1.07, 0.44)],
      credit: W(0.04, 0.085, 0.042, { k: 0, c: 1 }),
    },
    // 2. Out to Lunch: one letter pair at the scale of the sleeve.
    {
      photo: photo(0.06, 0.06, 0.4, 0.4, 0, 0.4, 0.42, 1.55),
      block: none,
      words: [W(0.52, 0.205, 0.17), W(0.52 + 0.17 * (adv.let + 0.26), 0.205, 0.17), W(-0.1, 1.17, 1.22, { k: 0, c: 1 })],
      credit: W(0.522, 0.27, 0.042),
    },
    // 3. The title turned up the spine, the picture taking the rest.
    {
      photo: photo(0.33, 0, 0.67, 1, 3, 0.5, 0.5, 1),
      block: none,
      words: line(0.285, 0.985, 0.33, { r: -90, k: 0, c: 1 }).map((w, i) => ({ ...w, x: 0.285, y: 0.985 - (w.x - 0.285) })),
      credit: W(0.375, 0.955, 0.042, { k: 1, c: 0 }),
    },
    // 4. The Freedom Rider: a field of colour, one word reversed out of it.
    {
      photo: photo(0, 0.56, 1, 0.44, 2, 0.5, 0.36, 1.02),
      block: { x: 0, y: 0, w: 1, h: 0.56 },
      words: [W(0.05, 0.25, 0.2, { k: 0, c: 0 }), W(0.47, 0.52, 0.86, { k: 1, c: 0 }), W(0.05, 0.45, 0.2, { k: 0, c: 0 })],
      credit: W(0.05, 0.075, 0.042, { k: 0, c: 0 }),
    },
    // 5. Hub-Tones: picture square in the corner, the title stretched wide
    // and the last word sitting on the bottom edge.
    {
      photo: photo(0.5, 0.04, 0.46, 0.46, 1, 0.55, 0.45, 1.25),
      block: none,
      words: [W(0.04, 0.705, 0.27, { sx: 1.3, k: 0, c: 1 }), W(0.04 + 0.27 * 1.3 * (adv.let + 0.22), 0.705, 0.27, { sx: 1.3, k: 0, c: 1 }), W(0.035, 1.0, 0.36, { sx: 1.3 })],
      credit: W(0.045, 0.1, 0.042),
    },
  ];
}

// Flatten a layout to numbers so the springs can treat it as a vector.
const WORD_KEYS = ["x", "y", "s", "sx", "r", "k", "c"];
function flatten(L) {
  const p = L.photo;
  const out = [p.x, p.y, p.w, p.h, p.fx, p.fy, p.z];
  for (let i = 0; i < 4; i++) out.push(p.p === i ? 1 : 0);
  out.push(L.block.x, L.block.y, L.block.w, L.block.h);
  for (const w of [...L.words, L.credit]) for (const key of WORD_KEYS) out.push(w[key]);
  return out;
}
// Which spring each number rides: photo first and firm, the words looser and
// a little later, so a re-composition reads as moves, not a morph.
// Inks and which photograph is on the press don't morph: they cut over at
// the halfway point, quickly, like a different plate going on.
const isDiscrete = (i) => (i >= 7 && i < 11) || (i >= 15 && (i - 15) % WORD_KEYS.length >= 5);
function stiffnessFor(i) {
  if (isDiscrete(i)) return 900;
  if (i < 11) return 230;
  if (i < 15) return 210;
  const word = Math.floor((i - 15) / WORD_KEYS.length);
  return [170, 190, 150, 240][word] ?? 200;
}

// ---------------------------------------------------------------- plates
function noiseCanvas(w, h, draw) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  draw(g, w, h);
  return c;
}

// Separate one portrait into two screened plates and print them, multiplied,
// onto one canvas. The source panels are only 177px square, so a smooth
// enlargement goes soft; instead each plate is broken into a halftone screen
// whose cell spans just over one source pixel. Every dot is drawn at device
// resolution, so the picture carries all the detail the scan has and none it
// doesn't. Colour screen at 75 degrees, black at 45, the duotone standard.
const SRC = 177;
const CELL_SRC = 1.1; // source pixels per halftone cell
function separate(pixels, stride, rect, px) {
  // Luminance of the panel at its native resolution.
  const [rx, ry, rw, rh] = rect;
  const lumS = new Float32Array(rw * rh);
  const hist = new Uint32Array(256);
  for (let y = 0; y < rh; y++)
    for (let x = 0; x < rw; x++) {
      const o = ((ry + y) * stride + rx + x) * 4;
      const l = (0.2126 * pixels[o] + 0.7152 * pixels[o + 1] + 0.0722 * pixels[o + 2]) / 255;
      lumS[y * rw + x] = l;
      hist[Math.min(255, (l * 255) | 0)]++;
    }
  const pct = (q) => {
    let acc = 0;
    for (let i = 0; i < 256; i++) if ((acc += hist[i]) >= rw * rh * q) return i / 255;
    return 1;
  };
  const lo = pct(0.015);
  const hi = pct(0.985);
  // Bilinear sampling coordinates, per column and per row.
  const axis = (len) => {
    const i0 = new Int32Array(px);
    const f = new Float32Array(px);
    for (let j = 0; j < px; j++) {
      const sxy = clamp(((j + 0.5) * len) / px - 0.5, 0, len - 1.001);
      i0[j] = sxy | 0;
      f[j] = sxy - i0[j];
    }
    return [i0, f];
  };
  const [xi, xf] = axis(rw);
  const [yi, yf] = axis(rh);
  const cell = (px / SRC) * CELL_SRC;
  const aa = (cell / Math.PI) * 0.7; // spot-function slope, about one pixel wide
  // Tone curves and the cosine, as tables: this runs over a million pixels.
  const LV = 1024;
  const covT = new Float32Array(LV);
  const kT = new Float32Array(LV);
  for (let i = 0; i < LV; i++) {
    const l = i / (LV - 1);
    covT[i] = 1 - 2 * Math.pow(clamp((1 - l) * 1.12, 0, 1), 0.85);
    kT[i] = 1 - 2 * Math.pow(clamp((0.5 - l) / 0.46, 0, 1), 1.35) * 0.96;
  }
  const CS = 4096;
  const cosT = new Float32Array(CS);
  for (let i = 0; i < CS; i++) cosT[i] = Math.cos((2 * Math.PI * i) / CS) / 2;
  const cosF = (u) => cosT[((u - Math.floor(u)) * CS) | 0];
  // Screen axes per pixel: colour at 75 degrees, black at 45.
  const axes = (deg) => {
    const r = (deg * Math.PI) / 180;
    return [Math.cos(r) / cell, Math.sin(r) / cell];
  };
  const [cc, cs] = axes(75);
  const [kc, ks] = axes(45);
  const ink = (spot, t) => {
    if (t >= 0.996) return 0;
    if (t <= -0.996) return 1;
    const v = (spot - t) * aa + 0.5;
    return v <= 0 ? 0 : v >= 1 ? 1 : v;
  };
  const span = Math.max(0.05, hi - lo);
  const out = new ImageData(px, px);
  const d = out.data;
  const kInk = 1 - BLACK[0] / 255;
  for (let y = 0; y < px; y++) {
    const yy = y + 0.5;
    const r0 = yi[y] * rw;
    const r1 = r0 + rw;
    const fy = yf[y];
    for (let x = 0; x < px; x++) {
      const xx = x + 0.5;
      const i = y * px + x;
      const c0 = xi[x];
      const fx = xf[x];
      const top = lumS[r0 + c0] + (lumS[r0 + c0 + 1] - lumS[r0 + c0]) * fx;
      const bot = lumS[r1 + c0] + (lumS[r1 + c0 + 1] - lumS[r1 + c0]) * fx;
      let l = (top + (bot - top) * fy - lo) / span;
      l = l < 0 ? 0 : l > 1 ? 1 : l;
      const li = (l * (LV - 1)) | 0;
      const dc = ink(cosF(xx * cc + yy * cs) + cosF(-xx * cs + yy * cc), covT[li]);
      const dk = ink(cosF(xx * kc + yy * ks) + cosF(-xx * ks + yy * kc), kT[li]);
      const kv = 1 - dk * kInk;
      const o = i * 4;
      d[o] = (255 - dc * (255 - COLOUR[0])) * kv;
      d[o + 1] = (255 - dc * (255 - COLOUR[1])) * kv;
      d[o + 2] = (255 - dc * (255 - COLOUR[2])) * kv;
      d[o + 3] = 255;
    }
  }
  return noiseCanvas(px, px, (g) => g.putImageData(out, 0, 0));
}

// Board: warm white with fibre and tooth.
function makeBoard(px) {
  return noiseCanvas(px, px, (g, w, h) => {
    const img = g.createImageData(w, h);
    let seed = 11;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < w * h; i++) {
      const v = (rnd() - 0.5) * 7;
      img.data[i * 4] = BOARD[0] + v;
      img.data[i * 4 + 1] = BOARD[1] + v;
      img.data[i * 4 + 2] = BOARD[2] + v * 0.9;
      img.data[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    // Fibres: short, faint, mostly along the grain.
    for (let i = 0; i < (w * h) / 900; i++) {
      const x = rnd() * w;
      const y = rnd() * h;
      const len = (4 + rnd() * 14) * (w / 1000);
      const a = (rnd() - 0.5) * 0.7;
      g.strokeStyle = rnd() < 0.5 ? "rgba(120,100,70,0.06)" : "rgba(255,255,255,0.35)";
      g.lineWidth = Math.max(0.6, w / 1600);
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
      g.stroke();
    }
  });
}

// Ink wear: blotchy density plus pinholes where the board's tooth broke the
// ink film. Screened over the print, so it only lifts the inks.
function makeWear(px) {
  const small = noiseCanvas(48, 48, (g) => {
    const img = g.createImageData(48, 48);
    let seed = 3;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 48 * 48; i++) {
      const v = rnd() * 22;
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  });
  return noiseCanvas(px, px, (g, w, h) => {
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = "high";
    g.filter = `blur(${w / 160}px)`;
    g.drawImage(small, -w * 0.05, -h * 0.05, w * 1.1, h * 1.1);
    g.filter = "none";
    let seed = 5;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < (w * h) / 260; i++) {
      const v = 40 + rnd() * 90;
      g.fillStyle = `rgb(${v},${v},${v})`;
      const r = (0.4 + rnd() * 0.9) * (w / 1200);
      g.fillRect(rnd() * w, rnd() * h, r, r);
    }
  });
}

// ---------------------------------------------------------------- engine
export async function createSleeve(host) {
  const stage = createStage(host, { dpr: 2 });
  const { ctx, canvas } = stage;
  const params = new URLSearchParams(location.search);

  const family = getComputedStyle(document.body).getPropertyValue("--font-geist-sans").trim() || "Geist, sans-serif";
  const [img] = await Promise.all([
    loadCover("let-it-be"),
    Promise.race([document.fonts.load(`${WEIGHT} 100px ${family}`), new Promise((r) => setTimeout(r, 1500))]).catch(() => null),
  ]);
  // Plates are screened at the size they print, so they are rebuilt when the
  // sleeve changes size. The largest crop any layout takes is 1.06 sleeves.
  const pixels = noiseCanvas(img.naturalWidth, img.naturalHeight, (g) => g.drawImage(img, 0, 0))
    .getContext("2d")
    .getImageData(0, 0, img.naturalWidth, img.naturalHeight).data;
  let plates = [];
  let PLATE = 0;
  const buildPlates = (px) => {
    if (px === PLATE) return;
    PLATE = px;
    plates = PANELS.map((r) => separate(pixels, img.naturalWidth, r, px));
  };

  // Advance widths per unit size, with the tracking law at a large size.
  const meas = document.createElement("canvas").getContext("2d");
  meas.font = `${WEIGHT} 400px ${family}`;
  meas.letterSpacing = `${tracking(400)}px`;
  const adv = Object.fromEntries(["let", "it", "be"].map((w) => [w, meas.measureText(w).width / 400]));
  const targets = layouts(adv).map(flatten);
  const N = targets[0].length;
  const discrete = Array.from({ length: N }, (_, i) => isDiscrete(i));
  const stiff = Float32Array.from({ length: N }, (_, i) => stiffnessFor(i));
  const pos = new Float32Array(N);
  const vel = new Float32Array(N);
  const goal = new Float32Array(N);

  // The point on the torus of layouts.
  const g = { x: 0, y: 0 };
  const held = params.get("t");
  if (params.has("c")) {
    const c = +params.get("c") | 0;
    g.x = c % COLS;
    g.y = Math.floor(c / COLS) % ROWS;
  }
  let detent = true;
  if (held != null) {
    const [tx, ty = "0"] = held.split(",");
    g.x += +tx || 0;
    g.y += +ty || 0;
    detent = false;
  }
  const mod = (a, n) => ((a % n) + n) % n;
  // The sleeve whose inks are on the press right now.
  let inkLayout = 0;
  const blendInto = (out, gx, gy, useDetent) => {
    const ix = Math.floor(gx);
    const iy = Math.floor(gy);
    let fx = gx - ix;
    let fy = gy - iy;
    if (useDetent) {
      fx = smoother(fx);
      fy = smoother(fy);
    }
    const at = (i, j) => targets[mod(j, ROWS) * COLS + mod(i, COLS)];
    const a = at(ix, iy);
    const b = at(ix + 1, iy);
    const c = at(ix, iy + 1);
    const d = at(ix + 1, iy + 1);
    const cx = fx < 0.5 ? 0 : 1;
    const cy = fy < 0.5 ? 0 : 1;
    inkLayout = mod(iy + cy, ROWS) * COLS + mod(ix + cx, COLS);
    for (let n = 0; n < N; n++) {
      const ux = discrete[n] ? cx : fx;
      const uy = discrete[n] ? cy : fy;
      const top = a[n] + (b[n] - a[n]) * ux;
      const bot = c[n] + (d[n] - c[n]) * ux;
      out[n] = top + (bot - top) * uy;
    }
  };
  blendInto(goal, g.x, g.y, detent);
  pos.set(goal);

  // Layers: one per ink, sleeve-sized.
  const layerC = document.createElement("canvas");
  const layerK = document.createElement("canvas");
  const lc = layerC.getContext("2d");
  const lk = layerK.getContext("2d");
  let S = 1;
  let ox = 0;
  let oy = 0;
  let board = null;
  let wear = null;
  let dirty = true;
  stage.onResize((w, h, dpr) => {
    S = Math.round(Math.min(w * 0.82, h * 0.74, 720));
    ox = Math.round((w - S) / 2);
    oy = Math.round((h - S) / 2);
    const px = Math.round(S * dpr);
    for (const c of [layerC, layerK]) {
      c.width = px;
      c.height = px;
    }
    board = makeBoard(px);
    wear = makeWear(px);
    buildPlates(Math.min(1600, Math.ceil(px * 1.06)));
    dirty = true;
  });

  // ------------------------------------------------------------ input
  let drag = null;
  let lift = 0;
  let liftV = 0;
  const inside = (p) => p.x >= ox && p.x <= ox + S && p.y >= oy && p.y <= oy + S;
  stage.on("down", (p) => {
    if (!inside(p)) return;
    drag = { x: p.x, y: p.y, gx: Math.round(g.x), gy: Math.round(g.y), sx: g.x, sy: g.y };
    detent = true;
    canvas.style.cursor = "grabbing";
  });
  stage.on("move", (p) => {
    if (drag) {
      g.x = drag.sx - (p.x - drag.x) / (S * STEP);
      g.y = drag.sy - (p.y - drag.y) / (S * STEP);
    } else canvas.style.cursor = inside(p) ? "grab" : "";
  });
  stage.on("up", (p) => {
    if (!drag) return;
    // Throw: project the release velocity, then settle on a layout at most
    // one away from where the drag started on each axis... unless dragged far.
    const px = g.x - (p.vx * 0.16) / (S * STEP);
    const py = g.y - (p.vy * 0.16) / (S * STEP);
    const rx = Math.round(px);
    const ry = Math.round(py);
    g.x = Math.abs(g.x - drag.sx) < 1.2 ? clamp(rx, drag.gx - 1, drag.gx + 1) : rx;
    g.y = Math.abs(g.y - drag.sy) < 1.2 ? clamp(ry, drag.gy - 1, drag.gy + 1) : ry;
    drag = null;
    canvas.style.cursor = inside(p) ? "grab" : "";
  });

  // Left alone, it keeps setting new sleeves.
  let nextIdle = 0;
  const TOUR = [
    [1, 0],
    [1, 0],
    [0, 1],
    [-1, 0],
    [-1, 0],
    [0, -1],
  ];
  let tourAt = 0;

  // ------------------------------------------------------------ draw
  const drawPlatePhoto = (l, which, v, dpr) => {
    const [x, y, w, h, fx, fy, z] = v;
    if (which !== "c" || w < 0.002 || h < 0.002) return;
    const s = Math.max(w, h) * Math.max(1, z);
    const uw = Math.min(1, w / s);
    const uh = Math.min(1, h / s);
    const u0 = clamp(fx - uw / 2, 0, 1 - uw);
    const v0 = clamp(fy - uh / 2, 0, 1 - uh);
    const order = [0, 1, 2, 3].map((i) => [i, v[7 + i]]).filter(([, a]) => a > 0.004).sort((a, b) => b[1] - a[1]);
    l.save();
    l.beginPath();
    l.rect(x * S, y * S, w * S, h * S);
    l.clip();
    let acc = 0;
    for (const [i, a] of order) {
      acc += a;
      l.globalAlpha = acc === a ? 1 : a / acc;
      l.drawImage(plates[i], u0 * PLATE, v0 * PLATE, uw * PLATE, uh * PLATE, x * S, y * S, w * S, h * S);
    }
    l.restore();
  };
  const inkStyle = (which, k, c) => {
    // Each plate either prints this word or is knocked out under it.
    if (which === "k") {
      const a = clamp(k, 0, 1);
      const v = Math.round(255 - a * (255 - BLACK[0]));
      return `rgb(${v},${v},${v})`;
    }
    const a = clamp(c, 0, 1);
    return `rgb(${COLOUR.map((ch) => Math.round(255 - a * (255 - ch))).join(",")})`;
  };
  const drawWord = (l, which, text, base) => {
    const x = pos[base];
    const y = pos[base + 1];
    const s = pos[base + 2];
    const sx = pos[base + 3];
    const r = pos[base + 4];
    // Inks never tint: a plate prints a word or it doesn't. A knockout only
    // works where it sits wholly inside ink, which is true only once the word
    // is home on the sleeve that knocks it out; anywhere in between it would
    // half vanish into bare board, so in transit it prints black instead.
    let k = pos[base + 5] >= 0.5 ? 1 : 0;
    const c = pos[base + 6] >= 0.5 ? 1 : 0;
    if (!k && !c) {
      const home = targets[inkLayout];
      let off = Math.abs(r - home[base + 4]) / 90;
      for (let j = 0; j < 4; j++) off = Math.max(off, Math.abs(pos[base + j] - home[base + j]));
      if (off > 0.006) k = 1;
    }
    const px = s * S;
    if (px < 1) return;
    l.save();
    l.translate(x * S, y * S);
    l.rotate((r * Math.PI) / 180);
    l.scale(sx, 1);
    l.font = `${WEIGHT} ${px}px ${family}`;
    l.letterSpacing = `${tracking(px)}px`;
    l.fillStyle = inkStyle(which, k, c);
    l.fillText(text, 0, 0);
    l.restore();
  };
  const drawPlate = (l, which, dpr) => {
    l.setTransform(dpr, 0, 0, dpr, 0, 0);
    l.globalAlpha = 1;
    l.fillStyle = "#fff";
    l.fillRect(0, 0, S, S);
    // A solid of colour, knocked out of the black plate.
    const [bx, by, bw, bh] = [pos[11], pos[12], pos[13], pos[14]];
    if (bw > 0.002 && bh > 0.002) {
      l.fillStyle = which === "c" ? `rgb(${COLOUR.join(",")})` : "#fff";
      l.fillRect(bx * S, by * S, bw * S, bh * S);
    }
    drawPlatePhoto(l, which, pos, dpr);
    const words = ["let", "it", "be", "the beatles"];
    for (let i = 0; i < 4; i++) drawWord(l, which, words[i], 15 + i * WORD_KEYS.length);
  };

  stage.onFrame((dt, t) => {
    const { width: w, height: h, dpr } = stage;
    // Idle tour.
    if (!drag && held == null && stage.idleFor() > 5000) {
      if (t > nextIdle) {
        const [dx, dy] = TOUR[tourAt++ % TOUR.length];
        g.x = Math.round(g.x) + dx;
        g.y = Math.round(g.y) + dy;
        nextIdle = t + 3.2;
      }
    } else nextIdle = Math.max(nextIdle, t + 1.2);

    blendInto(goal, g.x, g.y, detent);
    if (held == null) {
      const steps = 3;
      const h1 = dt / steps;
      for (let sI = 0; sI < steps; sI++)
        for (let i = 0; i < N; i++) {
          const k = stiff[i];
          const damp = 2 * Math.sqrt(k) * 0.86;
          vel[i] += ((goal[i] - pos[i]) * k - vel[i] * damp) * h1;
          pos[i] += vel[i] * h1;
        }
    } else pos.set(goal);

    // Lift while held.
    const liftGoal = drag ? 1 : 0;
    liftV += ((liftGoal - lift) * 300 - liftV * 2 * Math.sqrt(300)) * dt;
    lift += liftV * dt;

    // Nothing moving: the last frame is still the sleeve.
    let moving = Math.abs(liftV) > 1e-3 || Math.abs(lift - liftGoal) > 1e-4;
    for (let i = 0; i < N && !moving; i++) if (Math.abs(vel[i]) > 1e-4 || Math.abs(goal[i] - pos[i]) > 1e-5) moving = true;
    if (!moving && !dirty) return;
    dirty = false;

    drawPlate(lc, "c", dpr);
    drawPlate(lk, "k", dpr);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.fillStyle = GROUND;
    ctx.fillRect(0, 0, w, h);

    const grow = 1 + lift * 0.006;
    ctx.save();
    ctx.translate(ox + S / 2, oy + S / 2);
    ctx.scale(grow, grow);
    ctx.translate(-S / 2, -S / 2);

    // Shadows: a wide soft one that grows with lift, and a tight contact one.
    ctx.save();
    ctx.fillStyle = GROUND;
    ctx.shadowColor = `rgba(60,45,25,${0.16 + lift * 0.04})`;
    ctx.shadowBlur = S * (0.07 + lift * 0.03);
    ctx.shadowOffsetY = S * (0.03 + lift * 0.015);
    ctx.fillRect(2, 2, S - 4, S - 4);
    ctx.shadowColor = "rgba(40,30,20,0.22)";
    ctx.shadowBlur = 2.5;
    ctx.shadowOffsetY = 1;
    ctx.fillRect(0, 0, S, S);
    ctx.restore();

    if (board) ctx.drawImage(board, 0, 0, S, S);
    ctx.globalCompositeOperation = "multiply";
    ctx.drawImage(layerC, 0, 0, S, S);
    // The black plate, a hair out of register.
    ctx.drawImage(layerK, 0.35, 0.25, S, S);
    ctx.globalCompositeOperation = "screen";
    if (wear) ctx.drawImage(wear, 0, 0, S, S);

    // Board edge: a lit top edge, a slightly dirty perimeter.
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0.5, 0.5);
    ctx.lineTo(S - 0.5, 0.5);
    ctx.stroke();
    ctx.strokeStyle = "rgba(70,55,35,0.12)";
    ctx.strokeRect(0.25, 0.25, S - 0.5, S - 0.5);
    ctx.restore();
  });

  return { destroy: () => stage.destroy() };
}
