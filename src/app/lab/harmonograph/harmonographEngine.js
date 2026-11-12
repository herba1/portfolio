import { createStage, clamp } from "../_kit/stage";
import { createNib } from "./penAudio";

// A three-pendulum harmonograph, the machine behind Whitney's Vertigo
// spirals. Two lateral pendulums swing a pen arm in x and y from a gimbal
// beside the table; a third, free to swing in any direction, carries the
// table and its paper in a slow circle underneath. Each is a damped harmonic
// oscillator stepped exactly (no integration drift), and the line is the
// pen's position relative to the moving paper.
//
// The pen is a thing on the table: take the nib and pull it out and let go,
// and the arm swings from where you dropped it; take the paper and throw it,
// and the table circles. Lifting the nib starts a new figure, and the old one
// is pulled into the sheet as an impression in a spot ink, the next of a
// small fixed set each time. The impression is a plate, not a second pen
// line: the figure's path is turned into a density field, and the plate is
// solid where its turns crowd and screened away to open paper where they
// spread, printed one fixed misregistration off the key. The sheet builds up
// as a riso or letterpress print with the pen's near-black key, the only
// linework on it, always on top. The pen lifts itself once the swing has
// wound in, so the centre of every figure stays open.
//
// Ink is laid opaque on a transparent layer, so one continuous line never
// beads where its segments meet. Width and density follow the pen's speed:
// thin and a little grey where it races, wider and blacker where it slows.
// They also follow how far the swing has wound in: the inner winds, where
// the pen is slowest and the loops crowd closest, fine down to a hairline
// instead of swelling, so the core resolves into moire over the flat plate.

const TAU = Math.PI * 2;
const H = 1 / 1600; // physics substep, seconds
const U = TAU * 0.9; // one ratio unit, rad/s

// Ratio sets, alternating per sheet. Detuning is what makes the figure
// precess as it winds in, instead of retracing one closed curve. ax and ay
// are each sheet's opening swing as a share of the pen's reach: the pair
// that runs near unison with the table adds to it in quadrature, so it takes
// the fuller swing, and the first loops come to within about 8% of the
// sheet's edges either way.
const SETS = [
  { x: 2, y: 3 * 1.0021, p: 2 * 0.9984, gx: 0.03, gy: 0.034, gp: 0.026, ax: 1, ay: 0.92 },
  { x: 3, y: 4 * 1.0018, p: 4 * 0.9986, gx: 0.031, gy: 0.035, gp: 0.027, ax: 0.92, ay: 1 },
];

const GROUND = "#ebe8e1";
const PAPER = [250, 248, 243];
const INK_DARK = [20, 23, 36];
const INK_FAST = [52, 56, 72];

function osc(w, g) {
  const o = { x: 0, v: 0, w, g, E: 0, C: 0, S: 0, wd: w };
  retune(o, w, g);
  return o;
}
function retune(o, w, g) {
  o.w = w;
  o.g = g;
  o.wd = Math.sqrt(Math.max(1e-6, w * w - g * g));
  o.E = Math.exp(-g * H);
  o.C = Math.cos(o.wd * H);
  o.S = Math.sin(o.wd * H);
}
function step(o) {
  const { x, v, g, wd, w, E, C, S } = o;
  o.x = E * (x * C + ((v + g * x) / wd) * S);
  o.v = E * (v * C - ((w * w * x + g * v) / wd) * S);
}
const amp = (o) => Math.hypot(o.x, (o.v + o.g * o.x) / o.wd);
const scaleOsc = (o, k) => {
  o.x *= k;
  o.v *= k;
};

function makePaperTexture(wPx, hPx, seed = 7) {
  const c = document.createElement("canvas");
  c.width = wPx;
  c.height = hPx;
  const g = c.getContext("2d");
  const img = g.createImageData(wPx, hPx);
  const d = img.data;
  let s = seed >>> 0;
  const rnd = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  // Low-frequency cloud (the formation of the sheet) plus fine tooth.
  const cw = 48;
  const ch = Math.ceil((hPx / wPx) * cw);
  const cloud = new Float32Array((cw + 1) * (ch + 1)).map(() => rnd());
  for (let y = 0; y < hPx; y++) {
    const fy = (y / hPx) * ch;
    const iy = fy | 0;
    const ty = fy - iy;
    for (let x = 0; x < wPx; x++) {
      const fx = (x / wPx) * cw;
      const ix = fx | 0;
      const tx = fx - ix;
      const a = cloud[iy * (cw + 1) + ix];
      const b = cloud[iy * (cw + 1) + ix + 1];
      const c2 = cloud[(iy + 1) * (cw + 1) + ix];
      const e = cloud[(iy + 1) * (cw + 1) + ix + 1];
      const n = (a * (1 - tx) + b * tx) * (1 - ty) + (c2 * (1 - tx) + e * tx) * ty;
      const k = (n - 0.5) * 3.2 + (rnd() - 0.5) * 3.4;
      const i = (y * wPx + x) * 4;
      d[i] = PAPER[0] + k;
      d[i + 1] = PAPER[1] + k;
      d[i + 2] = PAPER[2] + k * 1.1;
      d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

// The ink film's own unevenness, as a density multiplier per device pixel:
// a slow mottle across the sheet (the drum or the block never inks quite
// flat), a finer one, tooth, and the odd pinhole where the paper didn't take
// the ink. Made once per sheet size and shared by every plate.
let grainCache = null;
function inkGrain(n, seed = 31) {
  if (grainCache && grainCache.n === n) return grainCache.g;
  let s = seed >>> 0;
  const rnd = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const field = (cells) => {
    const v = new Float32Array((cells + 1) * (cells + 1)).map(() => rnd());
    return (x, y) => {
      const fx = (x / n) * cells;
      const fy = (y / n) * cells;
      const ix = fx | 0;
      const iy = fy | 0;
      let tx = fx - ix;
      let ty = fy - iy;
      tx = tx * tx * (3 - 2 * tx);
      ty = ty * ty * (3 - 2 * ty);
      const o = iy * (cells + 1) + ix;
      return (v[o] * (1 - tx) + v[o + 1] * tx) * (1 - ty) + (v[o + cells + 1] * (1 - tx) + v[o + cells + 2] * tx) * ty;
    };
  };
  const slow = field(5);
  const mid = field(40);
  const g = new Float32Array(n * n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let v = 0.8 + 0.16 * slow(x, y) + 0.08 * mid(x, y) + (rnd() - 0.5) * 0.12;
      if (rnd() < 0.0025) v *= 0.35;
      g[y * n + x] = Math.min(1, v);
    }
  }
  grainCache = { n, g };
  return g;
}

// The pen lifts when the swing has wound in to this share of the reach, and
// comes down again on a push past DROP. The line tapers over the last stretch.
const LIFT = 0.16;
const DROP = 0.24;
const TAPER = 1.8;
// The table's share of the reach.
const TABLE = 0.24;
const SETTLE_S = 1.6;
const PLATE_IN = 0.55; // share of the pull over which the plate inks up
// The sheet is a two-colour (then three-, four-colour) print. The pen draws
// the key in near-black; when it comes down on a new figure, the one it
// finished is pulled into the sheet as an impression in the next spot ink,
// at full strength and overprinted (multiply), each plate about a
// millimetre out of register with the key, as a riso or a jobbing
// letterpress lays it, and each tint screened at its own angle so stacked
// plates rosette instead of beating. The key always prints last, over every
// spot.
const SPOTS = [
  { rgb: [232, 78, 44], mx: 3.5, my: -2.6, screen: 15 }, // vermilion
  { rgb: [0, 112, 186], mx: -3, my: 3.3, screen: 75 }, // process blue
  { rgb: [255, 76, 150], mx: 2.8, my: 3.5, screen: 45 }, // fluorescent pink
  { rgb: [0, 128, 120], mx: -3.7, my: -2.8, screen: 0 }, // teal
];
const NIB_GRAB = 26; // CSS px around the nib ring
const ROD_GRAB = 12; // CSS px either side of the rod
// The pen arm is drawn as a hairline from the nib toward its gimbal, and
// fades out over its last third long before it gets there.
const ROD_LEN = 0.3; // share of the sheet's side
const ROD_MIN = 0.14;
const RING = 4.5; // CSS px

const ease = (t) => 1 - (1 - t) ** 3;
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const layer = (w, h) => {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
};

export async function createHarmonograph(host) {
  // Three layers. The ground and the sheet are DOM: the sheet is two
  // canvases the table moves together with a compositor transform, the
  // printed sheet (paper and the spot impressions) and over it the key plate
  // the pen is inking now, a stroke at a time, which the compositor
  // overprints (multiply) so the sheet never has to be recomposed for it.
  // Over them the stage canvas carries the pen arm (repainted in its own
  // small rectangle) and a sheet being torn. The arm is only a hairline and
  // a ring at the nib: the drawing is the only figure on the sheet.
  const stage = createStage(host, { dpr: 2, alpha: true });
  const ctx = stage.ctx;
  const deck = document.createElement("div");
  deck.className = "kit-canvas";
  deck.style.background = GROUND;
  const pad = document.createElement("div");
  Object.assign(pad.style, {
    position: "absolute",
    left: "0px",
    top: "0px",
    isolation: "isolate",
    boxShadow: "0 1px 2px rgba(40,32,20,0.07), 0 1px 0 rgba(60,48,30,0.05), 0 2px 0 rgba(60,48,30,0.035)",
    willChange: "transform",
  });
  const fill = { position: "absolute", left: "0px", top: "0px", width: "100%", height: "100%", display: "block" };
  const comp = document.createElement("canvas");
  Object.assign(comp.style, fill, { background: `rgb(${PAPER.join(",")})` });
  const key = document.createElement("canvas");
  Object.assign(key.style, fill, { mixBlendMode: "multiply" });
  pad.append(comp, key);
  deck.appendChild(pad);
  host.insertBefore(deck, stage.canvas);
  const compCtx = comp.getContext("2d");
  let shownOff = "";
  const params = new URLSearchParams(window.location.search);
  const preT = params.has("t") ? clamp(parseFloat(params.get("t")) || 0, 0, 1) : null;
  const preGhost = params.has("ghost");
  const preHold = params.has("hold");
  const nib = createNib();

  let setIndex = params.get("set") === "1" ? 1 : 0;
  const S0 = SETS[setIndex];
  const px = osc(S0.x * U, S0.gx);
  const py = osc(S0.y * U, S0.gy);
  const qx = osc(S0.p * U, S0.gp); // the table's rotary pendulum
  const qy = osc(S0.p * U, S0.gp);
  const all = [px, py, qx, qy];

  const applySet = (i) => {
    const s = SETS[i];
    retune(px, s.x * U, s.gx);
    retune(py, s.y * U, s.gy);
    retune(qx, s.p * U, s.gp);
    retune(qy, s.p * U, s.gp);
  };

  // Geometry, CSS px. sheetX/Y is the sheet at rest; the table carries it
  // by (qx, qy) from there.
  let W = 1;
  let Hh = 1;
  let side = 1;
  let R = 1;
  let sheetX = 0;
  let sheetY = 0;
  let pivotX = 0;
  let pivotY = 0;
  let dpr = 2;
  let paperTex = null;
  // The sheet in layers: the impressions already pulled, baked into the
  // paper; the figure now being pulled (its key, and its impression in
  // spot ink); and the live key on its own canvas. The printed sheet is
  // composed only while a figure is being pulled; a steady frame is the pen
  // inking the key.
  let base = null;
  let baseCtx = null;
  let prev = null;
  let prevCtx = null;
  let spot = null;
  let spotCtx = null;
  const cur = key;
  const curCtx = key.getContext("2d");
  let settleT = 1; // 0..1 while the previous figure is pulled into the sheet
  let prevInk = false;
  let curInk = false;
  let pull = 0; // impressions pulled so far; the next takes SPOTS[pull % n]
  let pulling = SPOTS[0];
  // The figure as the pen laid it: every point the key was inked through, as
  // a share of the sheet's side (so it survives a resize), NaN between
  // strokes. A finished figure is pulled into its plate from this, not from
  // the key's raster.
  let curPath = [];
  let prevPath = [];

  // Pen.
  let pen = "down"; // down | up
  let lift = 0; // 0 on the paper .. 1 lifted, eased
  let last = null; // last drawn point, paper coords
  let speedAvg = 0;
  let penSpeed = 0;

  // The hand: holding the pen arm, or the table.
  let hold = null; // { kind: "pen" | "table", ... }
  // After a lift, the nib comes down again for a hand's push, or on its own
  // only for a strong swing: a fresh sheet never gets a stray scrap.
  let armed = false;

  // Tear.
  let leaving = null; // { canvas, t, ox, oy }

  const preset = (i = setIndex) => {
    const s = R;
    const k = 1 - TABLE;
    px.x = 0;
    px.v = SETS[i].ax * k * s * px.wd;
    py.x = SETS[i].ay * k * s;
    py.v = 0;
    qx.x = TABLE * s;
    qx.v = 0;
    qy.x = 0;
    qy.v = TABLE * s * qy.wd;
  };

  const penPos = () => [side / 2 + px.x - qx.x, side / 2 + py.x - qy.x];
  const nibScreen = () => [sheetX + side / 2 + px.x, sheetY + side / 2 + py.x];
  const tableOff = () => [Math.round(qx.x * dpr) / dpr, Math.round(qy.x * dpr) / dpr];

  const wipe = (c) => {
    c.globalCompositeOperation = "source-over";
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, c.canvas.width, c.canvas.height);
  };
  const clearSheet = () => {
    baseCtx.setTransform(1, 0, 0, 1, 0, 0);
    baseCtx.globalAlpha = 1;
    baseCtx.drawImage(paperTex, 0, 0);
    wipe(prevCtx);
    wipe(curCtx);
    prevInk = false;
    curInk = false;
    settleT = 1;
    last = null;
    compose();
  };
  // The printed sheet: paper and pulled impressions, then the figure being
  // pulled. Its key lets go as its spot ink comes up and slips the last
  // fraction of a millimetre out of register.
  const compose = () => {
    compCtx.setTransform(1, 0, 0, 1, 0, 0);
    compCtx.globalCompositeOperation = "source-over";
    compCtx.globalAlpha = 1;
    compCtx.drawImage(base, 0, 0);
    if (prevInk) {
      const e = ease(settleT);
      compCtx.globalCompositeOperation = "multiply";
      const k = 1 - smooth(0.2, 1, settleT);
      if (k > 0) {
        compCtx.globalAlpha = k;
        compCtx.drawImage(prev, 0, 0);
      }
      // The plate comes up to full strength (alpha 1, multiplied) over the
      // first half of the pull and stays there; it is never faded.
      compCtx.globalAlpha = smooth(0, PLATE_IN, settleT);
      compCtx.drawImage(spot, pulling.mx * e * dpr, pulling.my * e * dpr);
      compCtx.globalAlpha = 1;
      compCtx.globalCompositeOperation = "source-over";
    }
  };
  const inks = () => [curCtx];

  // The key of a finished figure, as a plate in spot ink. The plate is not
  // a second pen line: it is the figure's density. The path is replayed into
  // a coarse field as ink laid per unit of paper (line length per square
  // pixel, so its reciprocal is the spacing between turns), averaged over a
  // few millimetres, and the plate is cut from that field the way a printer
  // would make it from a drawing: solid where the turns crowd closer than
  // SOLID, open paper where they spread past OPEN, and between the two a
  // coarse halftone screen at the ink's own angle, so the tint fades into
  // the sheet as dots, not as a wash. Nothing of the line survives in it;
  // the near-black key is the only linework on the sheet.
  const CELL = 2; // CSS px per field cell
  const SPREAD = 4; // CSS px, the radius the density is averaged over
  const SOLID = 0.0022; // turn spacing, share of the sheet's side, for solid
  const OPEN = 0.0075; // ... and for open paper
  const SCREEN = 3.2; // CSS px, the halftone's pitch
  const field = () => {
    const g = Math.max(8, Math.round(side / CELL));
    const cell = side / g; // CSS px
    const F = new Float32Array(g * g);
    let lx = NaN;
    let ly = NaN;
    for (let i = 0; i < prevPath.length; i += 2) {
      const x = prevPath[i] * g;
      const y = prevPath[i + 1] * g;
      if (Number.isNaN(x) || Number.isNaN(lx)) {
        lx = x;
        ly = y;
        continue;
      }
      const L = Math.hypot(x - lx, y - ly);
      const k = Math.max(1, Math.ceil(L * 2));
      const w = (L * cell) / k; // CSS px of line per sample
      for (let j = 0; j < k; j++) {
        const t = (j + 0.5) / k;
        const sx = lx + (x - lx) * t - 0.5;
        const sy = ly + (y - ly) * t - 0.5;
        const ix = Math.floor(sx);
        const iy = Math.floor(sy);
        if (ix < 0 || iy < 0 || ix >= g - 1 || iy >= g - 1) continue;
        const fx = sx - ix;
        const fy = sy - iy;
        const o = iy * g + ix;
        F[o] += w * (1 - fx) * (1 - fy);
        F[o + 1] += w * fx * (1 - fy);
        F[o + g] += w * (1 - fx) * fy;
        F[o + g + 1] += w * fx * fy;
      }
      lx = x;
      ly = y;
    }
    // Three box passes each way: close to a gaussian of radius SPREAD.
    const r = Math.max(1, Math.round(SPREAD / cell / 1.7));
    const tmp = new Float32Array(g * g);
    const box = (src, dst, stride, step) => {
      for (let l = 0; l < g; l++) {
        const o = l * stride;
        let acc = 0;
        for (let i = -r; i <= r; i++) acc += src[o + clamp(i, 0, g - 1) * step];
        for (let i = 0; i < g; i++) {
          dst[o + i * step] = acc / (2 * r + 1);
          acc += src[o + Math.min(g - 1, i + r + 1) * step] - src[o + Math.max(0, i - r) * step];
        }
      }
    };
    for (let p = 0; p < 3; p++) {
      box(F, tmp, g, 1);
      box(tmp, F, 1, g);
    }
    // Line per square pixel.
    const area = cell * cell;
    for (let i = 0; i < F.length; i++) F[i] /= area;
    return { F, g };
  };

  const tint = () => {
    const n = spot.width;
    const { F, g } = field();
    const lo = 1 / (OPEN * side);
    const out = spotCtx.createImageData(n, n);
    const d = out.data;
    const [r, gr, bl] = pulling.rgb;
    const grain = inkGrain(n);
    const ang = (pulling.screen * Math.PI) / 180;
    const pitch = SCREEN * dpr;
    const cu = (Math.cos(ang) * TAU) / pitch;
    const su = (Math.sin(ang) * TAU) / pitch;
    // The screen's two waves, cos(x cu + y su) and cos(y cu - x su), split
    // into per-row and per-column tables so a pixel costs no trig.
    const wave = (k) => {
      const c = new Float32Array(n);
      const sn = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        c[i] = Math.cos(i * k);
        sn[i] = Math.sin(i * k);
      }
      return [c, sn];
    };
    const [cXu, sXu] = wave(cu);
    const [cXs, sXs] = wave(su);
    const aa = 1.2 / pitch; // the spot function's slope: about one device px of edge
    const fs = g / n;
    for (let y = 0, p = 0; y < n; y++) {
      const gy = clamp((y + 0.5) * fs - 0.5, 0, g - 1.001);
      const iy = gy | 0;
      const ty = gy - iy;
      for (let x = 0; x < n; x++, p++) {
        const gx = clamp((x + 0.5) * fs - 0.5, 0, g - 1.001);
        const ix = gx | 0;
        const tx = gx - ix;
        const o = iy * g + ix;
        const dens = (F[o] * (1 - tx) + F[o + 1] * tx) * (1 - ty) + (F[o + g] * (1 - tx) + F[o + g + 1] * tx) * ty;
        if (dens <= lo) continue;
        // Tone on the reciprocal (spacing) scale, so the edge of the solid
        // follows the turns, not the raw sum.
        const tone = smooth(OPEN * side, SOLID * side, 1 / dens);
        let ink;
        if (tone >= 0.985) ink = 1;
        else {
          // A round-dot screen: dots in the light tint, a chequer at half,
          // holes in the shadow.
          const cosU = cXu[x] * cXs[y] - sXu[x] * sXs[y];
          const cosV = cXu[y] * cXs[x] + sXu[y] * sXs[x];
          const spotFn = 0.5 + 0.25 * (cosU + cosV);
          ink = clamp((spotFn - (1 - tone)) / aa + 0.5, 0, 1);
        }
        const al = Math.min(1, 0.94 * ink * grain[p]);
        const i = p * 4;
        d[i] = r;
        d[i + 1] = gr;
        d[i + 2] = bl;
        d[i + 3] = al * 255;
      }
    }
    spotCtx.setTransform(1, 0, 0, 1, 0, 0);
    spotCtx.putImageData(out, 0, 0);
  };

  // The impression goes into the sheet for good, overprinting whatever was
  // pulled before it.
  const bake = () => {
    if (!prevInk) return;
    baseCtx.setTransform(1, 0, 0, 1, 0, 0);
    baseCtx.globalCompositeOperation = "multiply";
    baseCtx.drawImage(spot, pulling.mx * dpr, pulling.my * dpr);
    baseCtx.globalCompositeOperation = "source-over";
    wipe(prevCtx);
    prevInk = false;
    settleT = 1;
    compose();
  };
  // A new figure begins: the live one is pulled into the sheet in the next
  // ink, and the key is clean for the pen.
  const settle = () => {
    if (!curInk) return;
    bake();
    wipe(prevCtx);
    prevCtx.drawImage(cur, 0, 0);
    wipe(curCtx);
    prevPath = curPath;
    curPath = [];
    pulling = SPOTS[pull % SPOTS.length];
    pull++;
    tint();
    prevInk = true;
    curInk = false;
    settleT = 0;
    compose();
  };

  const layout = (w, h, d) => {
    const prevR = R;
    W = w;
    Hh = h;
    dpr = d;
    side = Math.round(Math.min(h * 0.78, w * 0.54));
    sheetX = Math.round((w - side) / 2);
    sheetY = Math.round((h - side) / 2);
    R = side * 0.45;
    // The gimbal stands on the frame to the right of the table. It is never
    // drawn; the arm's hairline points toward it and fades out first.
    pivotX = Math.min(w - 24, sheetX + side + Math.max(36, (w - sheetX - side) * 0.5));
    pivotY = sheetY + side * 0.62;
    const n = Math.round(side * dpr);
    let keep = null;
    if (base) {
      const k = layer(cur.width, cur.height);
      k.getContext("2d").drawImage(cur, 0, 0);
      keep = [base, prev, k];
    }
    base = layer(n, n);
    baseCtx = base.getContext("2d");
    prev = layer(n, n);
    prevCtx = prev.getContext("2d");
    spot = layer(n, n);
    spotCtx = spot.getContext("2d");
    comp.width = n;
    comp.height = n;
    key.width = n;
    key.height = n;
    Object.assign(pad.style, { width: `${side}px`, height: `${side}px`, left: `${sheetX}px`, top: `${sheetY}px` });
    shownOff = "";
    dirtyAll = true;
    paperTex = makePaperTexture(n, n);
    inkGrain(n); // made now, so the first pull doesn't wait on it
    const ink = { prevInk, curInk, settleT };
    clearSheet();
    if (keep) {
      baseCtx.drawImage(keep[0], 0, 0, n, n);
      prevCtx.drawImage(keep[1], 0, 0, n, n);
      curCtx.drawImage(keep[2], 0, 0, n, n);
      ({ prevInk, curInk, settleT } = ink);
      if (prevInk) tint();
      compose();
      for (const o of all) scaleOsc(o, R / prevR);
    }
  };

  const reach = () => Math.max(amp(px) + amp(qx), amp(py) + amp(qy));

  // Keep the figure on the sheet after a release: the hand sets where the
  // pendulum is; only its speed is trimmed if the swing would run off.
  const fit = (o, room) => {
    room = Math.max(0, room);
    if (Math.abs(o.x) > room) o.x = Math.sign(o.x) * room;
    const a = amp(o);
    if (a <= room) return;
    // amp^2 = x^2 + ((v + g x)/wd)^2; solve for v.
    const u = Math.sqrt(Math.max(0, room * room - o.x * o.x)) * o.wd;
    const s = Math.sign(o.v + o.g * o.x) || 1;
    o.v = s * u - o.g * o.x;
  };

  // One pen line. The ink is batched into runs of a single width and tone,
  // and a run only changes when the pen has really changed pace: the tone is
  // smoothed, must move well past its level (hysteresis) after the level has
  // been held for a stretch, then walks there a level at a time. A run that
  // continues (a new frame, a new level)
  // starts one segment back with a butt cap, so the overlap hides the join
  // and no round cap is dropped mid-line as a bead.
  const LEVELS = 5;
  const HYSTERESIS = 1.5; // levels the tone must move before the width steps
  const HOLD = 40; // segments a level is held at least
  const RAMP = 10; // ... or, once it is moving, per step of a swell
  // Pen speed in reaches per second.
  const PACE_SLOW = 6; // and slower: the full, darkest line
  const PACE_FAST = 13; // and faster: the hairline
  const PRESS = 0.6; // reach (share of R) inside which the nib presses less
  // Reach (share of R) inside which the line fines toward the hairline, on
  // an eased curve so the middle third of the figure is already fine: at the
  // lift it is HAIR wide in the fast ink whatever the pen's pace, and the
  // slow inner turns no longer swell into a blot.
  const WIND = 0.7;
  const HAIR = 0.5; // CSS px
  const WIND_STEPS = 6; // the wind-in is quantised too, so runs stay batched
  let runLevel = -1; // quantised tone of the run, 0..LEVELS
  let runTaper = -1; // quantised lift taper, 0..3
  let runWind = -1; // quantised wind-in, 0..WIND_STEPS
  let runSegs = 0;
  let ramping = false;
  let runOpen = false;
  let firstRun = true; // the line's first run keeps its round start
  let tone = -1; // smoothed 0 (fast, fine) .. 1 (slow, full)
  let back = null; // the point before `last`, where a continuing run starts
  const flush = () => {
    if (runOpen) for (const c of inks()) c.stroke();
    runOpen = false;
  };
  const deposit = (x, y, speed, taper, rch) => {
    if (!last) {
      last = { x, y };
      curPath.push(NaN, NaN, x / side, y / side);
      back = null;
      firstRun = true;
      runLevel = -1;
      ramping = false;
      tone = -1;
      return;
    }
    const dx = x - last.x;
    const dy = y - last.y;
    if (dx * dx + dy * dy < 1.1) return;
    speedAvg += (speed - speedAvg) * 0.5;
    // Fast pen: a 0.45px hairline, slightly grey. Slow pen: up to 1.8px,
    // near black. Pace is read against the swing's own reach, so each loop
    // swells where it turns and runs fine through its middle, at any sheet
    // size. As the swing winds in, the loops crowd together and the nib
    // presses less, so the centre stays open; near the lift it eases off
    // the paper and the line fines away.
    const reachNow = Math.max(rch, 1);
    const pace = Math.log((PACE_FAST * reachNow) / Math.max(1e-3, speedAvg)) / Math.log(PACE_FAST / PACE_SLOW);
    const press = 0.3 + 0.7 * smooth(LIFT * R, PRESS * R, reachNow);
    const f0 = clamp(pace, 0, 1) * press * (0.35 + 0.65 * taper);
    tone = tone < 0 ? f0 : tone + (f0 - tone) * 0.12;
    const want = tone * LEVELS;
    const tq = Math.round(taper * 3);
    const wq = Math.round(smooth(LIFT, WIND, reachNow / R) * WIND_STEPS);
    let change = !runOpen || tq !== runTaper || wq !== runWind;
    if (runLevel < 0) {
      runLevel = Math.round(want);
      change = true;
    } else {
      // Past the hysteresis the width walks one level at a time toward the
      // pen's pace, so a swell reads as a swell, not a step.
      const gap = want - runLevel;
      if (Math.abs(gap) <= 0.5) ramping = false;
      else if (runSegs >= (ramping ? RAMP : HOLD) && (ramping || Math.abs(gap) > HYSTERESIS)) {
        runLevel += Math.sign(gap);
        runSegs = 0;
        ramping = true;
        change = true;
      }
    }
    if (change) {
      flush();
      runTaper = tq;
      runWind = wq;
      const f = runLevel / LEVELS;
      const wind = (wq / WIND_STEPS) ** 1.6;
      const full = (0.45 + 1.35 * Math.pow(f, 1.3)) * (0.4 + 0.6 * (tq / 3));
      const width = Math.min(full, HAIR) + (full - Math.min(full, HAIR)) * wind;
      const k = Math.min(1, f * 1.6) * wind;
      const r = INK_FAST[0] + (INK_DARK[0] - INK_FAST[0]) * k;
      const g = INK_FAST[1] + (INK_DARK[1] - INK_FAST[1]) * k;
      const b = INK_FAST[2] + (INK_DARK[2] - INK_FAST[2]) * k;
      const from = !firstRun && back ? back : last;
      for (const c of inks()) {
        c.strokeStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
        c.lineWidth = width * dpr;
        c.lineCap = firstRun ? "round" : "butt";
        c.beginPath();
        c.moveTo(from.x * dpr, from.y * dpr);
        if (from !== last) c.lineTo(last.x * dpr, last.y * dpr);
      }
      firstRun = false;
      runOpen = true;
    }
    for (const c of inks()) c.lineTo(x * dpr, y * dpr);
    curPath.push(x / side, y / side);
    runSegs++;
    curInk = true;
    if (back) {
      back.x = last.x;
      back.y = last.y;
    } else back = { x: last.x, y: last.y };
    last.x = x;
    last.y = y;
  };

  const simulate = (seconds) => {
    const n = Math.max(1, Math.round(seconds / H));
    curCtx.setTransform(1, 0, 0, 1, 0, 0);
    curCtx.globalAlpha = 1;
    curCtx.lineCap = "round";
    curCtx.lineJoin = "round";
    const inking = pen === "down" && lift < 0.06;
    const held = hold && (hold.kind === "pen" || hold.taken) ? hold.kind : null;
    let [x0, y0] = penPos();
    let travelled = 0;
    for (let i = 0; i < n; i++) {
      if (held !== "pen") {
        step(px);
        step(py);
      }
      if (held !== "table") {
        step(qx);
        step(qy);
      }
      const [x, y] = penPos();
      const d = Math.hypot(x - x0, y - y0);
      travelled += d;
      x0 = x;
      y0 = y;
      if (!inking) continue;
      const rch = reach();
      deposit(x, y, d / H, smooth(LIFT * R, TAPER * LIFT * R, rch), rch);
    }
    flush();
    penSpeed = travelled / Math.max(1e-6, n * H);

    // The swing has wound in: lift the nib and leave the centre open.
    const rch = reach();
    if (pen === "down" && (rch < LIFT * R || held === "pen" || leaving)) {
      pen = "up";
      last = null;
    } else if (pen === "up" && !held && !leaving && rch > DROP * R && (armed || rch > 0.45 * R)) {
      // Coming back down after a lift is a new figure.
      pen = "down";
      armed = false;
      last = null;
      settle();
    }
  };

  // The hand. Near the nib it takes the pen arm; anywhere on the sheet it
  // takes the table. Either way the pendulum follows the hand while held and
  // keeps the hand's velocity when let go.
  // Near the collar, or on the outer part of the rod: a swinging pen is
  // hard to catch, so the whole arm is a handle.
  // The arm as drawn: from the nib toward the gimbal, for as far as it runs
  // before it would leave the sheet (never shorter than ROD_MIN).
  const arm = () => {
    const [nx, ny] = nibScreen();
    const dx = pivotX - nx;
    const dy = pivotY - ny;
    const d = Math.hypot(dx, dy) || 1;
    const ux = dx / d;
    const uy = dy / d;
    const [ox, oy] = tableOff();
    const x0 = sheetX + ox;
    const y0 = sheetY + oy;
    const tx = ux > 0 ? (x0 + side - nx) / ux : ux < 0 ? (x0 - nx) / ux : Infinity;
    const ty = uy > 0 ? (y0 + side - ny) / uy : uy < 0 ? (y0 - ny) / uy : Infinity;
    const len = Math.min(d, side * ROD_LEN, Math.max(side * ROD_MIN, Math.min(tx, ty) - 8));
    return { nx, ny, ux, uy, len };
  };
  const onPen = (x, y) => {
    const { nx, ny, ux, uy, len } = arm();
    if (Math.hypot(x - nx, y - ny) < NIB_GRAB) return true;
    const f = (x - nx) * ux + (y - ny) * uy;
    if (f < 0 || f > len) return false;
    return Math.hypot(x - (nx + ux * f), y - (ny + uy * f)) < ROD_GRAB;
  };

  stage.on("down", (p) => {
    if (!params.has("nosound")) nib.unlock();
    const [nx, ny] = nibScreen();
    const [ox, oy] = tableOff();
    if (onPen(p.x, p.y)) {
      hold = { kind: "pen", dx: nx - p.x, dy: ny - p.y };
    } else if (p.x > sheetX + ox && p.x < sheetX + ox + side && p.y > sheetY + oy && p.y < sheetY + oy + side) {
      // The table is only taken once the hand moves, so a click (or the
      // double-click that tears the sheet) leaves its swing alone.
      hold = { kind: "table", taken: false, gx: p.x, gy: p.y, qx0: 0, qy0: 0 };
    }
    stage.canvas.style.cursor = hold?.kind === "pen" ? "grabbing" : "";
  });
  stage.on("move", (p) => {
    if (hold) return;
    stage.canvas.style.cursor = onPen(p.x, p.y) ? "grab" : "";
  });
  stage.on("up", (p) => {
    if (!hold) return;
    if (hold.kind === "table" && !hold.taken) {
      hold = null;
      return;
    }
    armed = true;
    if (hold.kind === "pen") {
      px.v = p.vx;
      py.v = p.vy;
      fit(px, R - amp(qx));
      fit(py, R - amp(qy));
    } else {
      qx.v = p.vx;
      qy.v = p.vy;
      fit(qx, R * 0.42);
      fit(qy, R * 0.42);
      fit(px, R - amp(qx));
      fit(py, R - amp(qy));
    }
    hold = null;
    stage.canvas.style.cursor = "";
  });

  const follow = (dt) => {
    if (!hold) return;
    const p = stage.pointer;
    const k = 1 - Math.exp(-36 * dt);
    if (hold.kind === "pen") {
      const reachX = R - amp(qx);
      const reachY = R - amp(qy);
      const tx = clamp(p.x + hold.dx - sheetX - side / 2, -reachX, reachX);
      const ty = clamp(p.y + hold.dy - sheetY - side / 2, -reachY, reachY);
      px.x += (tx - px.x) * k;
      py.x += (ty - py.x) * k;
      px.v = p.vx;
      py.v = p.vy;
    } else {
      if (!hold.taken) {
        if (Math.hypot(p.x - hold.gx, p.y - hold.gy) < 4) return;
        Object.assign(hold, { taken: true, gx: p.x, gy: p.y, qx0: qx.x, qy0: qy.x });
        stage.canvas.style.cursor = "grabbing";
      }
      const lim = R * 0.42;
      const tx = clamp(hold.qx0 + p.x - hold.gx, -lim, lim);
      const ty = clamp(hold.qy0 + p.y - hold.gy, -lim, lim);
      qx.x += (tx - qx.x) * k;
      qy.x += (ty - qy.x) * k;
      qx.v = p.vx;
      qy.v = p.vy;
    }
  };

  const tear = () => {
    if (leaving) return;
    const snap = layer(comp.width, comp.height);
    const sc = snap.getContext("2d");
    sc.drawImage(comp, 0, 0);
    sc.globalCompositeOperation = "multiply";
    sc.drawImage(cur, 0, 0);
    const [ox, oy] = tableOff();
    leaving = { canvas: snap, t: 0, ox, oy };
    clearSheet();
    curPath = [];
    prevPath = [];
    pen = "up";
    setIndex = (setIndex + 1) % SETS.length;
    applySet(setIndex);
  };
  stage.canvas.addEventListener("dblclick", tear);

  let dirtyAll = true;
  let box = null; // the overlay rectangle painted last frame, CSS px
  const drawSheet = (layers, liftAmt) => {
    ctx.save();
    ctx.shadowColor = `rgba(40,32,20,${0.07 + 0.05 * liftAmt})`;
    ctx.shadowBlur = (2 + 26 * liftAmt) * dpr;
    ctx.shadowOffsetY = (1 + 14 * liftAmt) * dpr;
    ctx.fillStyle = `rgb(${PAPER.join(",")})`;
    ctx.fillRect(0, 0, side, side);
    ctx.restore();
    for (const [img, a] of layers) {
      if (a <= 0) continue;
      ctx.globalAlpha = a;
      ctx.drawImage(img, 0, 0, side, side);
    }
    ctx.globalAlpha = 1;
  };

  // The pen, seen from above: a ring of ink round the nib, and the arm as a
  // half-pixel hairline in the same ink that fades out over its last third.
  // The ring opens a touch as the nib lifts, and the dot of the nib on the
  // paper goes with it.
  const INK = `rgb(${INK_DARK.join(",")})`;
  const PAPER_INK = `rgb(${PAPER.join(",")})`;
  const drawPen = (a) => {
    const { nx, ny, ux, uy, len } = a;
    const r = RING + 0.75 * lift;
    const sx = nx + ux * r;
    const sy = ny + uy * r;
    const ex = nx + ux * len;
    const ey = ny + uy * len;
    const grad = ctx.createLinearGradient(sx, sy, ex, ey);
    const [ir, ig, ib] = INK_DARK;
    grad.addColorStop(0, `rgba(${ir},${ig},${ib},1)`);
    grad.addColorStop(0.667, `rgba(${ir},${ig},${ib},1)`);
    grad.addColorStop(1, `rgba(${ir},${ig},${ib},0)`);
    ctx.lineCap = "butt";
    ctx.strokeStyle = grad;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(ex, ey);
    ctx.stroke();

    // A paper knockout either side of the ring, as a printer would leave
    // round a mark laid over a dense tint, so it reads over the figure.
    ctx.beginPath();
    ctx.arc(nx, ny, r, 0, TAU);
    ctx.strokeStyle = PAPER_INK;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 0.75;
    ctx.stroke();
    if (lift < 0.98) {
      ctx.fillStyle = INK;
      ctx.globalAlpha = 1 - lift;
      ctx.beginPath();
      ctx.arc(nx, ny, 0.9, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  };

  stage.onResize((w, h, d) => {
    const first = !base;
    layout(w, h, d);
    if (first) {
      if (preGhost) {
        // A figure already drawn and settled into the sheet.
        applySet(1);
        preset(1);
        for (let t = 0; t < 70; t += 1 / 30) simulate(1 / 30);
        applySet(setIndex);
        settle();
        bake();
        pen = "up";
        for (const o of all) scaleOsc(o, 0);
      }
      preset();
      if (pen === "up") {
        pen = "down";
        last = null;
      }
      if (preT != null) {
        // Hold the figure partway into its decay, to the lift.
        const target = preT * (Math.log(reach() / R / LIFT) / 0.03);
        for (let t = 0; t < target; t += 1 / 30) simulate(1 / 30);
      }
      if (preHold) lift = 1;
    }
  });

  if (params.has("debug")) window.__harmonograph = { nib: () => nibScreen(), state: () => ({ pen, lift, reach: reach() / R, settleT }) };
  stage.onFrame((dt) => {
    follow(dt);
    simulate(dt);
    lift += ((pen === "up" ? 1 : 0) - lift) * (1 - Math.exp(-dt / (pen === "up" ? 0.06 : 0.09)));
    if (preHold) lift = 1;
    if (settleT < 1) {
      settleT = Math.min(1, settleT + dt / SETTLE_S);
      if (settleT >= 1) bake();
      else compose();
    }
    nib.level(pen === "down" && lift < 0.2 ? clamp(penSpeed / 2600, 0, 1) * (1 - lift * 4) : 0);

    if (leaving) {
      leaving.t += dt / 0.85;
      if (leaving.t >= 1) leaving = null;
    }

    // The pad rides the table.
    const [ox, oy] = tableOff();
    const off = `translate3d(${ox}px, ${oy}px, 0)`;
    if (off !== shownOff) {
      pad.style.transform = off;
      shownOff = off;
    }

    // The overlay: clear what was painted last frame, then the pen.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    if (dirtyAll || leaving) ctx.clearRect(0, 0, W, Hh);
    else if (box) ctx.clearRect(box[0], box[1], box[2] - box[0], box[3] - box[1]);
    dirtyAll = !!leaving;
    const a = arm();
    const ex = a.nx + a.ux * a.len;
    const ey = a.ny + a.uy * a.len;
    const m = 12;
    box = [Math.floor(Math.min(a.nx, ex) - m), Math.floor(Math.min(a.ny, ey) - m), Math.ceil(Math.max(a.nx, ex) + m), Math.ceil(Math.max(a.ny, ey) + m)];
    drawPen(a);

    // The torn sheet leaving: lifts, then is pulled up and away, over the pen.
    if (leaving) {
      const t = clamp(leaving.t, 0, 1);
      const l = Math.min(1, t / 0.25);
      const liftE = 1 - (1 - l) * (1 - l);
      const u = clamp((t - 0.08) / 0.92, 0, 1);
      const e = u * u * u * (u * (u * 6 - 15) + 10);
      const dy = -(sheetY + leaving.oy + side * 1.25) * e;
      const dx = side * 0.16 * e;
      const rot = ((-7 * Math.PI) / 180) * e;
      ctx.save();
      ctx.translate(sheetX + leaving.ox + side / 2 + dx, sheetY + leaving.oy + side / 2 + dy);
      ctx.rotate(rot);
      ctx.scale(1 + 0.012 * liftE, 1 + 0.012 * liftE);
      ctx.translate(-side / 2, -side / 2);
      drawSheet([[leaving.canvas, 1]], liftE);
      ctx.restore();
    }
  });

  return {
    destroy: () => {
      stage.canvas.removeEventListener("dblclick", tear);
      nib.close();
      stage.destroy();
      deck.remove();
    },
  };
}
