import { createStage, clamp } from "../_kit/stage";
import { loadCover } from "../_kit/covers";

// A record sleeve set the way Reid Miles set Blue Note: two inks (black and
// one strong colour) printed on warm board, a photograph separated into
// those two plates, and the title set so big it runs off the square.
//
// Six finished layouts sit on a 3 x 2 torus. Dragging scrubs a playhead from
// one sleeve to the next, and nothing in between is ever a blend of two
// sleeves: the sleeve is re-set. The photograph's crop moves first, one pair
// of edges and then the other, so it always shares a line with one of the
// two layouts. Then each word of the outgoing sleeve slides off past its own
// edge of the square, a beat after the one before, and once the square holds
// only the picture the incoming words slide in from the edges nearest their
// new places. Every word's path is chosen so no two words ever cross, which
// makes each frame of the drag a sleeve someone could have printed. Each ink
// is drawn on its own plate and overprinted (multiply), the black plate a
// hair out of register with the colour.

const GROUND = "#f2f0eb";
const BOARD = [247, 244, 237];
const COLOUR = [30, 82, 196]; // the one strong ink
const BLACK = [24, 23, 22];
const WEIGHT = 700; // display weight, the top of the ladder
const CREDIT_WEIGHT = 600; // the credit is a second tier, not display

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

// The handoff, on a playhead u that runs 0 -> 1 from one sleeve to the next.
// At its own pace the playhead takes TOUR_S seconds per sleeve, so a stagger
// of STAGGER in u is about 40ms between words.
const TOUR_S = 1;
const STAGGER = 0.04 / TOUR_S;
const PHOTO_END = 0.42; // the crop moves first: x edges, then y (or y, then x)
const EXIT_AT = 0.03; // first word starts to leave
const EXIT_LEN = 0.24;
const BLOCK_OUT = [0.39, 0.46]; // a colour field leaves only once its words have
const BLOCK_IN = [0.42, 0.49]; // and arrives before any word that sits in it
const ENTER_AT = 0.5; // first word arrives once the square holds only the picture
const ENTER_LEN = 0.32;

const smoother = (u) => u * u * u * (u * (u * 6 - 15) + 10);
const span = (u, a, b) => clamp((u - a) / (b - a), 0, 1);
const lerp = (a, b, t) => a + (b - a) * t;
const easeOut = (t) => 1 - Math.pow(1 - t, 4);
const easeIn = (t) => t * t * t;
const tracking = (px) => -0.043 * (px - 12);

// ---------------------------------------------------------------- layouts
// All lengths are in sleeve widths. Words anchor at their baseline-left.
// k / c: whether the black / colour plate prints a word; a word neither
// plate prints is reversed out of whatever ink it sits on.
function layouts(adv) {
  const W = (x, y, s, o = {}) => ({ x, y, s, sx: 1, r: 0, k: 1, c: 0, ...o });
  const line = (x, y, s, o = {}, gap = 0.26) => {
    const a = W(x, y, s, o);
    const b = W(x + s * (adv.let + gap), y, s, o);
    const c = W(b.x + s * (adv.it + gap), y, s, o);
    return [a, b, c];
  };
  const photo = (x, y, w, h, p, fx = 0.5, fy = 0.5, z = 1) => ({ x, y, w, h, p, fx, fy, z });

  return [
    // 0. The plain one: picture on top, the title one line, cut by the edge.
    {
      photo: photo(0, 0, 1, 0.6, 0, 0.5, 0.42, 1.06),
      block: null,
      words: line(-0.012, 0.968, 0.38),
      credit: W(0.05, 0.672, 0.042, { k: 0, c: 1 }),
    },
    // 1. Unit Structures: the title stacked down the left, a tall portrait.
    {
      photo: photo(0.5, 0, 0.5, 1, 1, 0.47, 0.5, 1),
      block: null,
      words: [W(0.03, 0.43, 0.44), W(0.03, 0.75, 0.44, { k: 0, c: 1 }), W(0.03, 1.07, 0.44)],
      credit: W(0.04, 0.085, 0.042, { k: 0, c: 1 }),
    },
    // 2. Out to Lunch: one letter pair at the scale of the sleeve.
    {
      photo: photo(0.06, 0.06, 0.4, 0.4, 0, 0.4, 0.42, 1.55),
      block: null,
      words: [W(0.52, 0.205, 0.17), W(0.52 + 0.17 * (adv.let + 0.26), 0.205, 0.17), W(-0.1, 1.17, 1.22, { k: 0, c: 1 })],
      credit: W(0.522, 0.27, 0.042),
    },
    // 3. The title turned up the spine, the picture taking the rest.
    {
      photo: photo(0.33, 0, 0.67, 1, 3, 0.5, 0.5, 1),
      block: null,
      words: line(0.285, 0.985, 0.33, { r: -90, k: 0, c: 1 }).map((w) => ({ ...w, x: 0.285, y: 0.985 - (w.x - 0.285) })),
      credit: W(0.375, 0.955, 0.042, { k: 1, c: 0 }),
    },
    // 4. The Freedom Rider: a field of colour and the title on one baseline,
    // read left to right: "let", then "it" at the scale of the field and
    // reversed out of it, then "be". The small words overprint black.
    {
      photo: photo(0, 0.56, 1, 0.44, 2, 0.5, 0.36, 1.02),
      block: { x: 0, y: 0, w: 1, h: 0.56 },
      words: [
        W(0.05, 0.52, 0.15, { k: 1, c: 1 }),
        W(0.215, 0.52, 0.86, { k: 0, c: 0 }),
        W(0.215 + 0.86 * adv.it + 0.035, 0.52, 0.15, { k: 1, c: 1 }),
      ],
      credit: W(0.05, 0.075, 0.042, { k: 0, c: 0 }),
    },
    // 5. Hub-Tones: picture square in the corner, the title stretched wide
    // and the last word sitting on the bottom edge.
    {
      photo: photo(0.5, 0.04, 0.46, 0.46, 1, 0.55, 0.45, 1.25),
      block: null,
      words: [W(0.04, 0.705, 0.27, { sx: 1.3, k: 0, c: 1 }), W(0.04 + 0.27 * 1.3 * (adv.let + 0.22), 0.705, 0.27, { sx: 1.3, k: 0, c: 1 }), W(0.035, 1.0, 0.36, { sx: 1.3 })],
      credit: W(0.045, 0.1, 0.042),
    },
  ];
}

const TEXT = ["let", "it", "be", "the beatles"];
const weightOf = (i) => (i === 3 ? CREDIT_WEIGHT : WEIGHT);

// The box a word's ink covers, in sleeve units, from glyph metrics measured
// once at a reference size.
function wordBox(w, m) {
  const rad = (w.r * Math.PI) / 180;
  const cs = Math.cos(rad);
  const sn = Math.sin(rad);
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const lx of [-m.l * w.sx * w.s, m.r * w.sx * w.s])
    for (const ly of [-m.a * w.s, m.d * w.s]) {
      const X = w.x + lx * cs - ly * sn;
      const Y = w.y + lx * sn + ly * cs;
      x0 = Math.min(x0, X);
      x1 = Math.max(x1, X);
      y0 = Math.min(y0, Y);
      y1 = Math.max(y1, Y);
    }
  return [x0, y0, x1, y1];
}

// The four ways off the square, as the shift that carries a box clear of it.
const EXITS = [
  (b) => [-(b[2] + 0.02), 0],
  (b) => [1.02 - b[0], 0],
  (b) => [0, -(b[3] + 0.02)],
  (b) => [0, 1.02 - b[1]],
];
// Where word i of a sleeve sits, shifted along its way out, at progress e.
const shifted = (b, d, e) => [b[0] + d[0] * e, b[1] + d[1] * e, b[2] + d[0] * e, b[3] + d[1] * e];
// The part of a box that is on the square; null when none is.
const onSquare = (b) => {
  const c = [Math.max(0, b[0]), Math.max(0, b[1]), Math.min(1, b[2]), Math.min(1, b[3])];
  return c[2] > c[0] && c[3] > c[1] ? c : null;
};
// How much of two boxes share the square.
const shared = (a, b) => (a && b ? Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1])) : 0);

const exitProgress = (i, u) => easeIn(span(u, EXIT_AT + i * STAGGER, EXIT_AT + i * STAGGER + EXIT_LEN));
const enterProgress = (i, u) => 1 - easeOut(span(u, ENTER_AT + i * STAGGER, ENTER_AT + i * STAGGER + ENTER_LEN));

// Pick each word's way off so that no two words ever run into each other on
// the square, leaving or arriving, taking the shortest total travel among
// the ways that work. Leaving and arriving use the same way, reversed. Ink
// boxes of a tight stack can share a sliver at rest (an i's dot under the
// line above); a pair may never share more than that.
function chooseExits(boxes) {
  const n = boxes.length;
  const rest = boxes.map((a) => boxes.map((b) => shared(onSquare(a), onSquare(b)) + 1e-5));
  const clean = (dirs) => {
    for (const phase of [exitProgress, enterProgress])
      for (let s = 0; s <= 60; s++) {
        const u = phase === exitProgress ? (s / 60) * 0.5 : 0.5 + (s / 60) * 0.5;
        const at = boxes.map((b, i) => onSquare(shifted(b, dirs[i], phase(i, u))));
        for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (shared(at[i], at[j]) > rest[i][j]) return false;
      }
    return true;
  };
  let best = null;
  let bestCost = Infinity;
  for (let code = 0; code < 4 ** n; code++) {
    const dirs = [];
    let cost = 0;
    for (let i = 0, c = code; i < n; i++, c >>= 2) {
      const d = EXITS[c & 3](boxes[i]);
      dirs.push(d);
      cost += Math.abs(d[0]) + Math.abs(d[1]);
    }
    if (cost < bestCost && clean(dirs)) {
      best = dirs;
      bestCost = cost;
    }
  }
  return best || boxes.map((b) => EXITS.map((f) => f(b)).sort((p, q) => Math.abs(p[0] + p[1]) - Math.abs(q[0] + q[1]))[0]);
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
    Promise.race([
      Promise.all([document.fonts.load(`${WEIGHT} 100px ${family}`), document.fonts.load(`${CREDIT_WEIGHT} 100px ${family}`)]),
      new Promise((r) => setTimeout(r, 1500)),
    ]).catch(() => null),
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

  // Advance widths and ink boxes per unit size, with the tracking law at a
  // large size.
  const REF = 400;
  const meas = document.createElement("canvas").getContext("2d");
  const metric = (i) => {
    meas.font = `${weightOf(i)} ${REF}px ${family}`;
    meas.letterSpacing = `${tracking(REF)}px`;
    const t = meas.measureText(TEXT[i]);
    return { w: t.width / REF, l: t.actualBoundingBoxLeft / REF, r: t.actualBoundingBoxRight / REF, a: t.actualBoundingBoxAscent / REF, d: t.actualBoundingBoxDescent / REF };
  };
  const metrics = TEXT.map((_, i) => metric(i));
  const adv = { let: metrics[0].w, it: metrics[1].w, be: metrics[2].w };
  const sleeves = layouts(adv).map((L) => {
    const words = [...L.words, L.credit];
    const boxes = words.map((w, i) => wordBox(w, metrics[i]));
    return { ...L, words, boxes, exits: chooseExits(boxes) };
  });
  // Which pair of crop edges moves first: the order whose first move runs
  // the picture under less of the outgoing words, which are still there.
  const firstEdges = (A, B) => {
    const a = A.photo;
    const b = B.photo;
    const under = (x, y, w, h) => A.boxes.reduce((n, box) => n + shared(onSquare(box), [x, y, x + w, y + h]), 0);
    const ux = under(b.x, a.y, b.w, a.h);
    const uy = under(a.x, b.y, a.w, b.h);
    return Math.abs(ux - uy) < 1e-4 ? axis : ux < uy ? "x" : "y";
  };

  // ------------------------------------------------------------ playhead
  // The sleeve the playhead counts from, the axis it runs along, and how far
  // along it is (in sleeves) now and where it is headed.
  const base = { x: 0, y: 0 };
  let axis = "x";
  let P = 0;
  let Q = 0;
  const held = params.get("t");
  if (params.has("c")) {
    const c = +params.get("c") | 0;
    base.x = c % COLS;
    base.y = Math.floor(c / COLS) % ROWS;
  }
  if (held != null) {
    const [tx, ty = "0"] = held.split(",").map((v) => +v || 0);
    axis = Math.abs(ty) > Math.abs(tx) ? "y" : "x";
    P = Q = axis === "x" ? tx : ty;
  }
  const mod = (a, n) => ((a % n) + n) % n;
  const sleeveAt = (x, y) => sleeves[mod(y, ROWS) * COLS + mod(x, COLS)];
  const atRest = () => Math.abs(P - Q) < 1e-4 && Math.abs(Q - Math.round(Q)) < 1e-6;
  // Count from wherever the playhead has landed, along a new axis.
  const rebase = (next) => {
    const n = Math.round(Q);
    if (axis === "x") base.x += n;
    else base.y += n;
    P = Q = 0;
    axis = next;
  };

  // The sleeve as printed at playhead p: which two sleeves, and how far
  // through the handoff from the first to the second.
  const frameAt = (p) => {
    const dir = p < 0 ? -1 : 1;
    const whole = Math.floor(Math.abs(p) + 1e-6);
    const u = Math.abs(p) - whole;
    const step = (k) => (axis === "x" ? sleeveAt(base.x + dir * k, base.y) : sleeveAt(base.x, base.y + dir * k));
    return { A: step(whole), B: step(whole + 1), u: u < 1e-5 ? 0 : u };
  };

  // ------------------------------------------------------------ layers
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
    // Grab the playhead where it is; only a landed sleeve can turn the axis.
    const free = atRest();
    if (free) rebase(axis);
    drag = { x: p.x, y: p.y, from: P, free };
    Q = P;
    canvas.style.cursor = "grabbing";
  });
  stage.on("move", (p) => {
    if (drag) {
      const dx = p.x - drag.x;
      const dy = p.y - drag.y;
      if (drag.free && Math.hypot(dx, dy) > 6) {
        axis = Math.abs(dx) >= Math.abs(dy) ? "x" : "y";
        drag.free = false;
      }
      if (!drag.free) Q = drag.from - (axis === "x" ? dx : dy) / (S * STEP);
    } else canvas.style.cursor = inside(p) ? "grab" : "";
  });
  stage.on("up", (p) => {
    if (!drag) return;
    // Throw: project the release velocity, then land on a sleeve at most one
    // away from where the drag started... unless dragged far.
    const v = axis === "x" ? p.vx : p.vy;
    const r = Math.round(Q - (v * 0.16) / (S * STEP));
    const start = Math.round(drag.from);
    Q = Math.abs(Q - drag.from) < 1.2 ? clamp(r, start - 1, start + 1) : r;
    drag = null;
    canvas.style.cursor = inside(p) ? "grab" : "";
  });

  // Left alone for five seconds, it keeps setting new sleeves.
  let nextIdle = 5;
  const TOUR = [
    ["x", 1],
    ["x", 1],
    ["y", 1],
    ["x", -1],
    ["x", -1],
    ["y", -1],
  ];
  let tourAt = 0;

  // ------------------------------------------------------------ draw
  const drawPhoto = (l, ph) => {
    const { x, y, w, h, fx, fy, z, p } = ph;
    if (w < 0.002 || h < 0.002) return;
    const s = Math.max(w, h) * Math.max(1, z);
    const uw = Math.min(1, w / s);
    const uh = Math.min(1, h / s);
    const u0 = clamp(fx - uw / 2, 0, 1 - uw);
    const v0 = clamp(fy - uh / 2, 0, 1 - uh);
    l.drawImage(plates[p], u0 * PLATE, v0 * PLATE, uw * PLATE, uh * PLATE, x * S, y * S, w * S, h * S);
  };
  const drawWord = (l, which, i, w, d, e) => {
    const px = w.s * S;
    if (px < 1) return;
    // A plate prints a word or knocks it out; a word neither plate prints is
    // reversed out of the ink beneath it.
    const on = which === "k" ? w.k : w.c;
    l.save();
    l.translate((w.x + d[0] * e) * S, (w.y + d[1] * e) * S);
    l.rotate((w.r * Math.PI) / 180);
    l.scale(w.sx, 1);
    l.font = `${weightOf(i)} ${px}px ${family}`;
    l.letterSpacing = `${tracking(px)}px`;
    l.fillStyle = !on ? "#fff" : which === "k" ? `rgb(${BLACK.join(",")})` : `rgb(${COLOUR.join(",")})`;
    l.fillText(TEXT[i], 0, 0);
    l.restore();
  };
  // A field of colour wipes off toward the edge it hangs from.
  const drawBlock = (l, which, b, f) => {
    if (!b || f <= 0) return;
    const h = b.h * f;
    const y = b.y + b.h > 0.999 ? b.y + b.h - h : b.y;
    l.fillStyle = which === "c" ? `rgb(${COLOUR.join(",")})` : "#fff";
    l.fillRect(b.x * S, y * S, b.w * S, h * S);
  };
  // The crop moves first, one pair of edges at a time, so the picture always
  // shares a line with one of the two sleeves; the portrait on the press
  // changes as the second pair starts to move.
  const photoAt = (A, B, u) => {
    const a = A.photo;
    const b = B.photo;
    const pu = span(u, 0, PHOTO_END);
    const first = smoother(clamp(pu * 2, 0, 1));
    const second = smoother(clamp(pu * 2 - 1, 0, 1));
    const [m1, m2] = firstEdges(A, B) === "x" ? [first, second] : [second, first];
    const src = pu < 0.5 ? a : b;
    return {
      x: lerp(a.x, b.x, m1),
      w: lerp(a.w, b.w, m1),
      y: lerp(a.y, b.y, m2),
      h: lerp(a.h, b.h, m2),
      fx: src.fx,
      fy: src.fy,
      z: src.z,
      p: src.p,
    };
  };
  const drawPlate = (l, which, dpr, { A, B, u }) => {
    l.setTransform(dpr, 0, 0, dpr, 0, 0);
    l.globalAlpha = 1;
    l.fillStyle = "#fff";
    l.fillRect(0, 0, S, S);
    if (u === 0) {
      drawBlock(l, which, A.block, 1);
      if (which === "c") drawPhoto(l, A.photo);
      A.words.forEach((w, i) => drawWord(l, which, i, w, A.exits[i], 0));
      return;
    }
    if (A.block === B.block) drawBlock(l, which, A.block, 1);
    else {
      drawBlock(l, which, A.block, 1 - smoother(span(u, ...BLOCK_OUT)));
      drawBlock(l, which, B.block, smoother(span(u, ...BLOCK_IN)));
    }
    if (which === "c") drawPhoto(l, photoAt(A, B, u));
    A.words.forEach((w, i) => {
      const e = exitProgress(i, u);
      if (e < 1) drawWord(l, which, i, w, A.exits[i], e);
    });
    B.words.forEach((w, i) => {
      const e = enterProgress(i, u);
      if (e < 1) drawWord(l, which, i, w, B.exits[i], e);
    });
  };

  stage.onFrame((dt, t) => {
    const { width: w, height: h, dpr } = stage;
    // Idle tour.
    if (!drag && held == null && stage.idleFor() > 5000) {
      if (t > nextIdle && atRest()) {
        const [ax, d] = TOUR[tourAt++ % TOUR.length];
        rebase(ax);
        Q = d;
        nextIdle = t + 3.2;
      }
    } else nextIdle = Math.max(nextIdle, t + 1.2);

    // The playhead walks toward where it is headed at the handoff's own pace,
    // easing in over the last few hundredths so a held drag stops softly.
    const P0 = P;
    if (held == null) {
      const vmax = dt / TOUR_S;
      P += clamp((Q - P) * Math.min(1, dt * 16), -vmax, vmax);
      if (Math.abs(Q - P) < 1e-4) P = Q;
    }

    // Lift while held.
    const liftGoal = drag ? 1 : 0;
    liftV += ((liftGoal - lift) * 300 - liftV * 2 * Math.sqrt(300)) * dt;
    lift += liftV * dt;

    // Nothing moving: the last frame is still the sleeve.
    const moving = P !== P0 || Math.abs(liftV) > 1e-3 || Math.abs(lift - liftGoal) > 1e-4;
    if (!moving && !dirty) return;
    dirty = false;

    const F = frameAt(P);
    drawPlate(lc, "c", dpr, F);
    drawPlate(lk, "k", dpr, F);

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
