import { createStage, clamp } from "../_kit/stage";

// Torn paper, after Willem Sandberg's Experimenta Typographica: letters torn
// by hand from coloured stock and laid on white.
//
// A sheet of coloured paper lies on the white. Press on it and drag: the path
// is the spine of a strip you tear out of it, a lowercase letter if you draw
// one. Everything lives in the sheet's pixel grid. Each torn piece keeps a
// distance field D (distance to its path minus the half width, which wobbles
// along the stroke the way a hand tear does). A fixed two-scale displacement
// field is added to D to get the torn edge e = D + n, so the piece and the
// hole it leaves share one edge and fit back together exactly.
//
// Tearing paper splits it through its thickness, so one side of a tear shows
// a band of the paper's white core and loose fibres. Which side gets the
// band flips slowly along the tear (it depends on which way the tear ran
// through the sheet), so the band moves between the piece and the hole.
//
// Two letters at most: a third tear sends the oldest back into its hole.

const FAMILY = '"Torn Geist", Geist, system-ui, sans-serif';
const GROUND = [251, 250, 247];
const INK = "rgb(22, 21, 20)";
const PAPERS = {
  red: [206, 40, 30],
  blue: [26, 60, 150],
  black: [26, 25, 24],
  ochre: [214, 154, 42],
};
const CORE = [248, 244, 235];

const PAD = 8; // css px of grid margin around the sheet, for fibres
const A1 = 2.4; // edge displacement, broad
const A2 = 0.85; // edge displacement, fine
const BW = 3.4; // white core band, widest
const DEG = Math.PI / 180;

const weight = (name, fallback) => {
  const v = parseInt(getComputedStyle(document.documentElement).getPropertyValue(`--font-weight-${name}`), 10);
  return Number.isFinite(v) ? v : fallback;
};

async function loadFont() {
  try {
    const face = new FontFace("Torn Geist", "url(/fonts/Geist-Variable.woff2)", { weight: "100 900" });
    await face.load();
    document.fonts.add(face);
  } catch {
    /* falls back to the page's Geist */
  }
  await document.fonts.ready;
}

function hash2(x, y, s) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s, 982451653)) | 0;
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
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// Two lowercase letters as single strokes, in sheet units (x of width,
// y of height). Retraced stretches vanish under the stroke's own width.
const SCRIPT = {
  n: [
    [0.3, 0.44], [0.3, 0.3], [0.3, 0.14], [0.3, 0.2], [0.33, 0.165], [0.42, 0.125], [0.53, 0.13], [0.62, 0.17], [0.665, 0.24], [0.67, 0.34], [0.67, 0.44],
  ],
  u: [
    [0.3, 0.55], [0.3, 0.66], [0.31, 0.75], [0.36, 0.82], [0.46, 0.85], [0.56, 0.83], [0.63, 0.78], [0.67, 0.7], [0.67, 0.55], [0.67, 0.7], [0.67, 0.86],
  ],
};

export async function createTorn(host, { embedded = false } = {}) {
  await loadFont();
  const stage = createStage(host, { dpr: 2 });
  const ctx = stage.ctx;
  const params = new URLSearchParams(location.search);
  const still = params.has("t") ? clamp(parseFloat(params.get("t")) || 0, 0, 1) : null;
  const PAPER = PAPERS[params.get("c")] || PAPERS.red;
  const CORE_T = CORE.map((v, i) => v + (PAPER[i] - v) * 0.1);

  let W = 1;
  let H = 1;
  let R = 2;
  // Sheet, in box css px.
  let SX = 0;
  let SY = 0;
  let SW = 1;
  let SH = 1;
  let STROKE = 50;
  // Grid.
  let GW = 1;
  let GH = 1;
  let nE = null; // edge displacement
  let side = null; // 1: band on the piece, 0: band on the hole
  let band = null; // band width variation
  let fib = null; // fibre streaks
  let tooth = null; // paper tooth
  let sheetCv = null;
  let sheetCtx = null;
  let sheetSh = null;

  let pieces = [];
  let nextId = 0;
  let tearing = null;
  let dragging = null;
  let dirty = true;
  let lastHairs = 0;
  let textY = 0;
  let portrait = false;

  const cov = (v) => {
    const c = 0.5 - v * R;
    return c < 0 ? 0 : c > 1 ? 1 : c;
  };

  // ------------------------------------------------------------ fields

  function buildFields() {
    GW = Math.ceil((SW + PAD * 2) * R);
    GH = Math.ceil((SH + PAD * 2) * R);
    const N = GW * GH;
    nE = new Float32Array(N);
    side = new Float32Array(N);
    band = new Float32Array(N);
    fib = new Float32Array(N);
    tooth = new Float32Array(N);
    for (let j = 0; j < GH; j++) {
      const y = (j + 0.5) / R - PAD;
      for (let i = 0; i < GW; i++) {
        const x = (i + 0.5) / R - PAD;
        const k = j * GW + i;
        nE[k] = (vnoise(x / 13, y / 13, 3) - 0.5) * 2 * A1 + (vnoise(x / 2.4, y / 2.4, 4) - 0.5) * 2 * A2 + (vnoise(x / 0.8, y / 0.8, 5) - 0.5) * 0.35;
        side[k] = smooth(0.36, 0.64, vnoise(x / 46, y / 46, 6));
        band[k] = 0.45 + vnoise(x / 6, y / 6, 7) * 0.75;
        fib[k] = vnoise(x / 0.9, y / 3.2, 8) * 0.6 + vnoise(x / 3.4, y / 0.8, 9) * 0.4;
        tooth[k] = (hash2(i, j, 10) - 0.5) * 3 + (vnoise(x / 40, y / 40, 11) - 0.5) * 3;
      }
    }
    sheetCv = document.createElement("canvas");
    sheetCv.width = GW;
    sheetCv.height = GH;
    sheetCtx = sheetCv.getContext("2d");
    sheetSh = silhouette(GW, GH);
  }

  // A flat dark copy of a mask, drawn a few times at small offsets for a
  // hairline contact shadow (cheaper than shadowBlur every frame).
  function silhouette(w, h) {
    const cv = document.createElement("canvas");
    cv.width = w;
    cv.height = h;
    return cv;
  }
  function writeShadow(cv, img, x0, y0) {
    const d = img.data;
    const c = cv.getContext("2d");
    const out = c.createImageData(img.width, img.height);
    const o = out.data;
    for (let n = 0; n < d.length; n += 4) {
      o[n] = 40;
      o[n + 1] = 30;
      o[n + 2] = 20;
      o[n + 3] = d[n + 3];
    }
    c.putImageData(out, x0, y0);
  }

  const rectSdf = (x, y) => Math.max(-x, x - SW, -y, y - SH);

  function exclAt(P, k) {
    let a = 1;
    for (const q of P.excl) a *= 1 - cov(q.D[k] + nE[k]) * q.self[k];
    return a;
  }

  function newPiece() {
    const N = GW * GH;
    const D = new Float32Array(N).fill(1e9);
    const sh = silhouette(GW, GH);
    const base = document.createElement("canvas");
    base.width = GW;
    base.height = GH;
    const hair = document.createElement("canvas");
    hair.width = GW;
    hair.height = GH;
    const hole = document.createElement("canvas");
    hole.width = GW;
    hole.height = GH;
    const P = {
      id: nextId++,
      pts: [],
      len: 0,
      D,
      // self: the piece's coverage before anyone excludes it (rect and excl), cached once torn.
      self: new Uint8Array(N),
      excl: pieces.filter((q) => q.state !== "healed"),
      bb: [GW, GH, -1, -1],
      base,
      hair,
      hole,
      sh,
      img: { cv: base, ox: 0, oy: 0 },
      shImg: { cv: sh, ox: 0, oy: 0 },
      hairImg: { cv: hair, ox: 0, oy: 0 },
      holeImg: { cv: hole, ox: 0, oy: 0 },
      state: "tearing",
      c: { x: 0, y: 0 },
      pose: { x: 0, y: 0, a: 0, l: 0 },
      vel: { x: 0, y: 0, a: 0, l: 0 },
      target: { x: 0, y: 0, a: 0 },
      rot: 0,
      placed: false,
      fade: 1,
      tear: { f: { x: 0, y: 0 }, th: 0, l: 0 },
    };
    return P;
  }

  const halfWidth = (s) => (STROKE / 2) * (1 + (vnoise(s / 70, 0.5, 21) - 0.5) * 0.28 + (vnoise(s / 19, 0.5, 22) - 0.5) * 0.08);

  function addPoint(P, x, y) {
    const last = P.pts[P.pts.length - 1];
    if (last) P.len += Math.hypot(x - last.x, y - last.y);
    const p = { x, y, hw: halfWidth(P.len), s: P.len };
    P.pts.push(p);
    if (!P.cap0 && last) {
      const l = Math.hypot(x - P.pts[0].x, y - P.pts[0].y) || 1;
      P.cap0 = { x: P.pts[0].x, y: P.pts[0].y, dx: (x - P.pts[0].x) / l, dy: (y - P.pts[0].y) / l };
    }
    if (last) stamp(P, last, p, P.pts.length > 2);
  }

  // On release the front becomes a straight torn end too: rebuild the field
  // with both ends clipped flat.
  function closeEnd(P) {
    const n = P.pts.length;
    if (n < 2) {
      // A tap tears out a dot.
      stamp(P, P.pts[0], P.pts[0], false);
      return;
    }
    const e = P.pts[n - 1];
    let k = n - 2;
    while (k > 0 && Math.hypot(e.x - P.pts[k].x, e.y - P.pts[k].y) < 8) k--;
    const l = Math.hypot(e.x - P.pts[k].x, e.y - P.pts[k].y) || 1;
    P.capN = { x: e.x, y: e.y, dx: (e.x - P.pts[k].x) / l, dy: (e.y - P.pts[k].y) / l };
    P.D.fill(1e9);
    for (let s = 1; s < n; s++) stamp(P, P.pts[s - 1], P.pts[s], s > 1, true);
    const [x0, y0, x1, y1] = P.bb;
    paintPiece(P, x0, y0, x1, y1);
    paintSheet(x0, y0, x1, y1);
  }

  // Burn one segment into the piece's field and repaint what it touched.
  function stamp(P, a, b, joint, quiet) {
    // Ends are clipped flat only near their own end of the path, so a path
    // that loops back past its start is not cut away.
    const reach = STROKE * 0.75;
    const c0 = P.cap0 && a.s < reach ? P.cap0 : null;
    const cN = P.capN && P.len - b.s < reach ? P.capN : null;
    const m = Math.max(a.hw, b.hw) + A1 + A2 + 1.5;
    const x0 = clamp(Math.floor((Math.min(a.x, b.x) - m + PAD) * R), 0, GW);
    const y0 = clamp(Math.floor((Math.min(a.y, b.y) - m + PAD) * R), 0, GH);
    const x1 = clamp(Math.ceil((Math.max(a.x, b.x) + m + PAD) * R), 0, GW);
    const y1 = clamp(Math.ceil((Math.max(a.y, b.y) + m + PAD) * R), 0, GH);
    if (x1 <= x0 || y1 <= y0) return;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const L2 = dx * dx + dy * dy;
    const D = P.D;
    for (let j = y0; j < y1; j++) {
      const py = (j + 0.5) / R - PAD;
      for (let i = x0; i < x1; i++) {
        const px = (i + 0.5) / R - PAD;
        let v;
        if (L2 > 0) {
          // Butt ends: a torn strip ends in a ragged straight tear, not a
          // round cap. Interior joints get a disc so turns stay whole.
          const L = Math.sqrt(L2);
          const t = ((px - a.x) * dx + (py - a.y) * dy) / L2;
          const tc = t < 0 ? 0 : t > 1 ? 1 : t;
          const perp = Math.abs((px - a.x) * dy - (py - a.y) * dx) / L - (a.hw + (b.hw - a.hw) * tc);
          const out = t < 0 ? -t * L : t > 1 ? (t - 1) * L : -1e9;
          v = Math.max(perp, out);
          if (joint) v = Math.min(v, Math.hypot(px - a.x, py - a.y) - a.hw);
        } else v = Math.hypot(px - a.x, py - a.y) - a.hw;
        if (c0) v = Math.max(v, -((px - c0.x) * c0.dx + (py - c0.y) * c0.dy));
        if (cN) v = Math.max(v, (px - cN.x) * cN.dx + (py - cN.y) * cN.dy);
        const k = j * GW + i;
        if (v < D[k]) D[k] = v;
      }
    }
    const bb = P.bb;
    bb[0] = Math.min(bb[0], x0);
    bb[1] = Math.min(bb[1], y0);
    bb[2] = Math.max(bb[2], x1);
    bb[3] = Math.max(bb[3], y1);
    if (quiet) return;
    paintPiece(P, x0, y0, x1, y1);
    paintSheet(x0, y0, x1, y1);
    dirty = true;
  }

  function paintPiece(P, x0, y0, x1, y1) {
    const w = x1 - x0;
    const h = y1 - y0;
    const ctxB = P.base.getContext("2d");
    const img = ctxB.createImageData(w, h);
    const d = img.data;
    const D = P.D;
    for (let j = y0; j < y1; j++) {
      const py = (j + 0.5) / R - PAD;
      for (let i = x0; i < x1; i++) {
        const k = j * GW + i;
        const o = ((j - y0) * w + (i - x0)) * 4;
        const e = D[k] + nE[k];
        if (e * R > 0.5) {
          P.self[k] = 0;
          d[o + 3] = 0;
          continue;
        }
        const px = (i + 0.5) / R - PAD;
        const rc = cov(rectSdf(px, py));
        P.self[k] = rc > 0.5 ? 1 : 0;
        const a = cov(e) * rc * exclAt(P, k);
        if (a <= 0) {
          d[o + 3] = 0;
          continue;
        }
        const bw = BW * side[k] * band[k];
        const t = bw > 0.05 ? clamp((bw + e) * R * 0.8 + (fib[k] - 0.5) * 1.6, 0, 1) : 0;
        const g = tooth[k];
        const lift = (fib[k] - 0.5) * 6 * t;
        d[o] = PAPER[0] + g + (CORE_T[0] + lift - PAPER[0] - g) * t;
        d[o + 1] = PAPER[1] + g + (CORE_T[1] + lift - PAPER[1] - g) * t;
        d[o + 2] = PAPER[2] + g + (CORE_T[2] + lift - PAPER[2] - g) * t;
        d[o + 3] = a * 255;
      }
    }
    ctxB.putImageData(img, x0, y0);
    writeShadow(P.sh, img, x0, y0);
  }

  function paintSheet(x0, y0, x1, y1) {
    const w = x1 - x0;
    const h = y1 - y0;
    const img = sheetCtx.createImageData(w, h);
    const d = img.data;
    const holes = pieces.filter((q) => q.state !== "healed");
    for (let j = y0; j < y1; j++) {
      const py = (j + 0.5) / R - PAD;
      for (let i = x0; i < x1; i++) {
        const k = j * GW + i;
        const o = ((j - y0) * w + (i - x0)) * 4;
        const px = (i + 0.5) / R - PAD;
        let a = cov(rectSdf(px, py));
        if (a <= 0) {
          d[o + 3] = 0;
          continue;
        }
        let near = 1e9;
        for (const q of holes) {
          const e = q.D[k] + nE[k];
          if (e * R > 0.5) {
            if (e < near) near = e;
            continue;
          }
          const c = cov(e) * q.self[k] * exclAt(q, k);
          a *= 1 - c;
          if (e > 0 && e < near) near = e;
        }
        let t = 0;
        if (near < BW + 1) {
          const bw = BW * 0.85 * (1 - side[k]) * band[k];
          if (bw > 0.05) t = clamp((bw - near) * R * 0.8 + (fib[k] - 0.5) * 1.6, 0, 1);
        }
        const g = tooth[k];
        const lift = (fib[k] - 0.5) * 6 * t;
        d[o] = PAPER[0] + g + (CORE_T[0] + lift - PAPER[0] - g) * t;
        d[o + 1] = PAPER[1] + g + (CORE_T[1] + lift - PAPER[1] - g) * t;
        d[o + 2] = PAPER[2] + g + (CORE_T[2] + lift - PAPER[2] - g) * t;
        d[o + 3] = a * 255;
      }
    }
    sheetCtx.putImageData(img, x0, y0);
    writeShadow(sheetSh, img, x0, y0);
  }

  // Loose fibres along the tear: short pale hairs standing off whichever
  // side carries the white core.
  function hairs(P) {
    const [x0, y0, x1, y1] = P.bb;
    const hc = P.hair.getContext("2d");
    const oc = P.hole.getContext("2d");
    hc.setTransform(1, 0, 0, 1, 0, 0);
    oc.setTransform(1, 0, 0, 1, 0, 0);
    hc.clearRect(0, 0, GW, GH);
    oc.clearRect(0, 0, GW, GH);
    if (x1 <= x0) return;
    const D = P.D;
    const lim = 0.5 / R;
    const pathP = new Path2D();
    const pathH = new Path2D();
    for (let j = Math.max(1, y0); j < Math.min(GH - 1, y1); j++) {
      const py = (j + 0.5) / R - PAD;
      for (let i = Math.max(1, x0); i < Math.min(GW - 1, x1); i++) {
        const k = j * GW + i;
        const e = D[k] + nE[k];
        if (e > lim || e < -lim) continue;
        const px = (i + 0.5) / R - PAD;
        if (rectSdf(px, py) > -1) continue;
        if (P.excl.length && exclAt(P, k) < 0.99) continue;
        const s = side[k];
        const hh = hash2(i, j, 91);
        const pPiece = (0.3 * s + 0.015) / R;
        const pHole = (0.26 * (1 - s) + 0.015) / R;
        let dir = 0;
        if (hh < pPiece) dir = 1;
        else if (hh > 1 - pHole) dir = -1;
        else continue;
        let gx = D[k + 1] + nE[k + 1] - (D[k - 1] + nE[k - 1]);
        let gy = D[k + GW] + nE[k + GW] - (D[k - GW] + nE[k - GW]);
        const gl = Math.hypot(gx, gy) || 1;
        gx /= gl;
        gy /= gl;
        const h2 = hash2(i, j, 92);
        const h3 = hash2(i, j, 93);
        const L = (0.7 + 3.2 * h2 * h2) * dir;
        const bend = (h3 - 0.5) * 1.6;
        const tx = -gy;
        const ty = gx;
        const sx = px - gx * 0.5 * dir;
        const sy = py - gy * 0.5 * dir;
        const ex = px + gx * L + tx * bend * Math.abs(L) * 0.5;
        const ey = py + gy * L + ty * bend * Math.abs(L) * 0.5;
        const cx = px + gx * L * 0.5 + tx * bend * 0.6;
        const cy = py + gy * L * 0.5 + ty * bend * 0.6;
        const path = dir > 0 ? pathP : pathH;
        path.moveTo(sx, sy);
        path.quadraticCurveTo(cx, cy, ex, ey);
      }
    }
    const col = `rgba(${CORE_T[0] | 0}, ${CORE_T[1] | 0}, ${CORE_T[2] | 0}, 0.95)`;
    for (const [c, path] of [
      [hc, pathP],
      [oc, pathH],
    ]) {
      c.setTransform(R, 0, 0, R, PAD * R, PAD * R);
      c.strokeStyle = col;
      c.lineWidth = 0.42;
      c.lineCap = "round";
      c.stroke(path);
    }
  }

  // Crop a finished piece to its bounds, base and fibres in one image.
  function finish(P) {
    hairs(P);
    const m = Math.ceil(5 * R);
    const x0 = Math.max(0, P.bb[0] - m);
    const y0 = Math.max(0, P.bb[1] - m);
    const x1 = Math.min(GW, P.bb[2] + m);
    const y1 = Math.min(GH, P.bb[3] + m);
    const w = Math.max(1, x1 - x0);
    const h = Math.max(1, y1 - y0);
    const cv = document.createElement("canvas");
    cv.width = w;
    cv.height = h;
    const c = cv.getContext("2d");
    c.drawImage(P.base, -x0, -y0);
    c.drawImage(P.hair, -x0, -y0);
    const hv = document.createElement("canvas");
    hv.width = w;
    hv.height = h;
    hv.getContext("2d").drawImage(P.hole, -x0, -y0);
    const sv = document.createElement("canvas");
    sv.width = w;
    sv.height = h;
    sv.getContext("2d").drawImage(P.sh, -x0, -y0);
    P.img = { cv, ox: x0, oy: y0 };
    P.shImg = { cv: sv, ox: x0, oy: y0 };
    P.sh = null;
    P.hairImg = null;
    P.holeImg = { cv: hv, ox: x0, oy: y0 };
    P.base = P.hair = P.hole = null;
    // Reference point: the middle of the piece, in sheet css px.
    P.c = { x: (P.bb[0] + P.bb[2]) / 2 / R - PAD, y: (P.bb[1] + P.bb[3]) / 2 / R - PAD };
    P.size = { w: (P.bb[2] - P.bb[0]) / R, h: (P.bb[3] - P.bb[1]) / R };
  }

  // ------------------------------------------------------------ poses

  const homePose = (P) => ({ x: SX + P.c.x, y: SY + P.c.y, a: 0 });

  function tearPose(P) {
    // The strip pivots on the tear front: the attached end stays put, the
    // free end swings up and off its hole.
    const { f, th } = P.tear;
    const fx = SX + f.x;
    const fy = SY + f.y;
    const hx = SX + P.c.x - fx;
    const hy = SY + P.c.y - fy;
    const cs = Math.cos(th);
    const sn = Math.sin(th);
    return { x: fx + hx * cs - hy * sn, y: fy + hx * sn + hy * cs, a: th };
  }

  function updateTear(P) {
    const last = P.pts[P.pts.length - 1];
    P.tear.f = { x: last.x, y: last.y };
    const k = smooth(0, 1, P.len / (SH * 0.9));
    P.tear.th = -8 * DEG * k;
    P.tear.l = 0.75 * smooth(0, 1, P.len / 90);
    P.c = { x: (P.bb[0] + P.bb[2]) / 2 / R - PAD, y: (P.bb[1] + P.bb[3]) / 2 / R - PAD };
  }

  function layout() {
    const outs = pieces.filter((q) => q.state === "out" && !q.placed);
    if (!outs.length) return;
    const gap = STROKE * 0.55;
    const total = outs.reduce((s, q) => s + q.size.w, 0) + gap * (outs.length - 1);
    let ax0;
    let ax1;
    let base;
    if (portrait) {
      ax0 = W * 0.08;
      ax1 = W * 0.92;
      const top = SY + SH + 24;
      const maxH = Math.max(...outs.map((q) => q.size.h));
      base = top + (H - top - 24 + maxH) / 2;
    } else {
      ax0 = Math.max(24, W * 0.07);
      ax1 = SX - W * 0.06;
      base = SY + SH * 0.62;
    }
    // Flush left, on the same edge as the catalogue line.
    let x = portrait ? Math.max(ax0, (ax0 + ax1) / 2 - total / 2) : ax0;
    for (const q of outs) {
      q.target = { x: x + q.size.w / 2, y: base - q.size.h / 2, a: q.rot };
      x += q.size.w + gap;
    }
  }

  // ------------------------------------------------------------ input

  function toSheet(px, py) {
    return { x: px - SX, y: py - SY };
  }

  function sheetAlive(x, y) {
    if (rectSdf(x, y) > -1) return false;
    const i = Math.floor((x + PAD) * R);
    const j = Math.floor((y + PAD) * R);
    const k = j * GW + i;
    for (const q of pieces) {
      if (q.state === "healed") continue;
      if (q.D[k] + nE[k] < 0 && q.self[k] && exclAt(q, k) > 0.5) return false;
    }
    return true;
  }

  function pieceAt(px, py) {
    for (let n = pieces.length - 1; n >= 0; n--) {
      const q = pieces[n];
      if (q.state !== "out") continue;
      const s = 1 + 0.018 * q.pose.l;
      const dx = px - q.pose.x;
      const dy = py - q.pose.y;
      const cs = Math.cos(-q.pose.a);
      const sn = Math.sin(-q.pose.a);
      const lx = (dx * cs - dy * sn) / s + q.c.x;
      const ly = (dx * sn + dy * cs) / s + q.c.y;
      if (rectSdf(lx, ly) > 0) continue;
      const k = Math.floor((ly + PAD) * R) * GW + Math.floor((lx + PAD) * R);
      if (q.D[k] + nE[k] < 2 && q.self[k]) return { q, ox: q.pose.x - px, oy: q.pose.y - py };
    }
    return null;
  }

  function startTear(x, y) {
    const live = pieces.filter((q) => q.state === "tearing" || q.state === "out").sort((a, b) => a.id - b.id);
    if (live.length >= 2) sendHome(live[0]);
    const P = newPiece();
    P.rot = (pieces.filter((q) => q.state === "out").length % 2 ? 1 : -1) * (2 + Math.random() * 2.5) * DEG;
    pieces.push(P);
    addPoint(P, x, y);
    updateTear(P);
    return P;
  }

  function extendTear(P, x, y) {
    const last = P.pts[P.pts.length - 1];
    const d = Math.hypot(x - last.x, y - last.y);
    if (d < 2.5) return;
    // Long jumps are split so the width wobble stays continuous.
    const n = Math.ceil(d / 10);
    for (let s = 1; s <= n; s++) addPoint(P, last.x + ((x - last.x) * s) / n, last.y + ((y - last.y) * s) / n);
    updateTear(P);
  }

  function release(P, vx = 0, vy = 0) {
    const tp = tearPose(P);
    const l = P.tear.l;
    closeEnd(P);
    finish(P);
    // Re-centre the tear pose on the cropped piece's centre.
    const fx = SX + P.tear.f.x;
    const fy = SY + P.tear.f.y;
    const hx = SX + P.c.x - fx;
    const hy = SY + P.c.y - fy;
    const cs = Math.cos(tp.a);
    const sn = Math.sin(tp.a);
    P.pose = { x: fx + hx * cs - hy * sn, y: fy + hx * sn + hy * cs, a: tp.a, l };
    P.vel = { x: vx * 0.25, y: vy * 0.25, a: 0, l: 0 };
    P.state = "out";
    layout();
    dirty = true;
  }

  function sendHome(P) {
    P.state = "returning";
    P.placed = false;
    P.target = homePose(P);
    layout();
  }

  function heal(P) {
    P.state = "healed";
    const [x0, y0, x1, y1] = P.bb;
    paintSheet(Math.max(0, x0 - 4), Math.max(0, y0 - 4), Math.min(GW, x1 + 4), Math.min(GH, y1 + 4));
  }

  stage.on("down", (p) => {
    if (tearing) return;
    for (const q of pieces) {
      if (q.frozen) {
        q.frozen = false;
        release(q);
      }
    }
    const hit = pieceAt(p.x, p.y);
    if (hit) {
      dragging = hit;
      hit.q.placed = true;
      // Bring it to the top.
      pieces = pieces.filter((q) => q !== hit.q).concat(hit.q);
      layout();
      dirty = true;
      return;
    }
    const s = toSheet(p.x, p.y);
    if (!sheetAlive(s.x, s.y)) return;
    tearing = startTear(s.x, s.y);
    stage.canvas.style.cursor = "grabbing";
  });
  stage.on("move", (p) => {
    if (tearing) {
      const s = toSheet(p.x, p.y);
      extendTear(tearing, s.x, s.y);
      return;
    }
    if (dragging) {
      dirty = true;
      return;
    }
    const hit = pieceAt(p.x, p.y);
    const s = toSheet(p.x, p.y);
    stage.canvas.style.cursor = hit ? "grab" : sheetAlive(s.x, s.y) ? "crosshair" : "";
  });
  stage.on("up", (p) => {
    if (tearing) {
      release(tearing, p.vx, p.vy);
      tearing = null;
    }
    if (dragging) {
      dragging.q.vel.x = p.vx * 0.15;
      dragging.q.vel.y = p.vy * 0.15;
      dragging.q.target = { x: dragging.q.pose.x + p.vx * 0.06, y: dragging.q.pose.y + p.vy * 0.06, a: dragging.q.rot };
      dragging = null;
    }
    stage.canvas.style.cursor = "";
  });

  // ------------------------------------------------------------ layout

  function scriptPiece(letter, upto) {
    const pts = SCRIPT[letter].map(([u, v]) => ({ x: u * SW, y: v * SH }));
    // Arc-length resample so t is a fraction of the path.
    let total = 0;
    for (let n = 1; n < pts.length; n++) total += Math.hypot(pts[n].x - pts[n - 1].x, pts[n].y - pts[n - 1].y);
    const stop = total * upto;
    let P = null;
    let run = 0;
    for (let n = 0; n < pts.length; n++) {
      if (!P) {
        P = startTear(pts[0].x, pts[0].y);
        continue;
      }
      const a = pts[n - 1];
      const b = pts[n];
      const L = Math.hypot(b.x - a.x, b.y - a.y);
      const steps = Math.max(1, Math.ceil(L / 4));
      for (let s = 1; s <= steps; s++) {
        if (run + (L * s) / steps > stop) return P;
        extendTear(P, a.x + ((b.x - a.x) * s) / steps, a.y + ((b.y - a.y) * s) / steps);
      }
      run += L;
    }
    return P;
  }

  function settle(P) {
    P.pose = { ...P.target, l: 0 };
    P.vel = { x: 0, y: 0, a: 0, l: 0 };
  }

  let built = "";
  let SWold = 1;
  let SHold = 1;
  stage.onResize((w, h, dpr) => {
    W = w;
    H = h;
    R = dpr;
    portrait = W < H * 0.95;
    if (portrait) {
      SW = Math.min(W * 0.78, H * 0.42);
      SH = SW / 0.78;
      if (SH > H * 0.52) {
        SH = H * 0.52;
        SW = SH * 0.78;
      }
      SX = Math.round(W - SW - W * 0.08);
      SY = Math.round(H * 0.08);
    } else {
      SH = Math.min(H * 0.64, W * 0.46);
      SW = SH * 0.78;
      SX = Math.round(W * 0.88 - SW);
      SY = Math.round((H - SH) / 2 - H * 0.02);
    }
    SW = Math.round(SW);
    SH = Math.round(SH);
    STROKE = SH * 0.105;
    textY = SY + SH;
    const key = `${SW}x${SH}@${R}`;
    if (key !== built) {
      built = key;
      // Replay what was torn on the new grid.
      const old = pieces.filter((q) => q.state === "out" || q.state === "tearing").map((q) => ({ pts: q.pts.map((p) => ({ u: p.x / SWold, v: p.y / SHold })), placed: false }));
      buildFields();
      pieces = [];
      tearing = null;
      dragging = null;
      paintSheet(0, 0, GW, GH);
      if (still != null) {
        const n = scriptPiece("n", 1);
        release(n);
        settle(n);
        const u = scriptPiece("u", still);
        if (still >= 1) {
          release(u);
          settle(u);
          layout();
          for (const q of pieces) if (q.state === "out") settle(q);
        } else {
          tearing = null;
          u.frozen = true;
          hairs(u);
        }
      } else {
        for (const o of old) {
          let P = null;
          for (const p of o.pts) {
            if (!P) P = startTear(p.u * SW, p.v * SH);
            else extendTear(P, p.u * SW, p.v * SH);
          }
          if (P) {
            release(P);
          }
        }
        for (const q of pieces) if (q.state === "out") settle(q);
      }
    } else {
      layout();
      for (const q of pieces) if (q.state === "out") settle(q);
    }
    SWold = SW;
    SHold = SH;
    dirty = true;
  });

  // ------------------------------------------------------------ frame

  const K = 150;
  const C = 2 * 0.86 * Math.sqrt(K);
  const KL = 220;
  const CL = 2 * Math.sqrt(KL);

  function step(P, dt) {
    const p = P.pose;
    const v = P.vel;
    const t = P.target;
    const far = Math.hypot(t.x - p.x, t.y - p.y);
    const lt = far > 14 ? 1 : 0;
    const n = 4;
    const h = dt / n;
    for (let s = 0; s < n; s++) {
      v.x += (K * (t.x - p.x) - C * v.x) * h;
      v.y += (K * (t.y - p.y) - C * v.y) * h;
      v.a += (K * (t.a - p.a) - C * v.a) * h;
      v.l += (KL * (lt - p.l) - CL * v.l) * h;
      p.x += v.x * h;
      p.y += v.y * h;
      p.a += v.a * h;
      p.l += v.l * h;
    }
    const still_ = far < 0.05 && Math.abs(t.a - p.a) < 0.0005 && Math.hypot(v.x, v.y) < 0.5 && Math.abs(v.l) < 0.01 && p.l < 0.01;
    if (still_) {
      p.x = t.x;
      p.y = t.y;
      p.a = t.a;
      p.l = 0;
      v.x = v.y = v.a = v.l = 0;
    }
    return !still_;
  }

  // While a piece is still being torn its images span the whole sheet grid;
  // only its bounds are drawn.
  function drawImg(im, bb) {
    if (bb && im.ox === 0 && im.oy === 0 && im.cv.width === GW) {
      const m = Math.ceil(6 * R);
      const x0 = Math.max(0, bb[0] - m);
      const y0 = Math.max(0, bb[1] - m);
      const w = Math.min(GW, bb[2] + m) - x0;
      const h = Math.min(GH, bb[3] + m) - y0;
      if (w > 0 && h > 0) ctx.drawImage(im.cv, x0, y0, w, h, x0, y0, w, h);
      return;
    }
    ctx.drawImage(im.cv, im.ox, im.oy);
  }

  // Four offset copies at low alpha read as a one-pixel blur.
  const TAPS = [
    [0, 0.45, 0.3],
    [-0.4, 0.8, 0.22],
    [0.4, 0.8, 0.22],
    [0, 1.25, 0.18],
  ];
  function shadow(drawFn, lift, strength) {
    const k = 0.7 + 1.6 * lift;
    for (const [dx, dy, a] of TAPS) {
      ctx.save();
      ctx.translate(dx * k, dy * k);
      ctx.globalAlpha = a * strength;
      drawFn();
      ctx.restore();
    }
  }

  function pieceTransform(P, pose, lift) {
    const s = 1 + 0.018 * lift;
    ctx.translate(pose.x, pose.y);
    ctx.rotate(pose.a);
    ctx.scale(s, s);
    ctx.translate(-P.c.x - PAD, -P.c.y - PAD);
    ctx.scale(1 / R, 1 / R);
  }

  function drawPiece(P, pose, lift) {
    // A healed piece is back in its hole: only its seams fade, no shadow.
    if (P.state !== "healed") shadow(
      () => {
        pieceTransform(P, pose, lift);
        ctx.globalAlpha *= P.fade;
        drawImg(P.shImg, P.bb);
      },
      lift,
      0.9,
    );
    ctx.save();
    pieceTransform(P, pose, lift);
    ctx.globalAlpha = P.fade;
    drawImg(P.img, P.bb);
    if (P.hairImg) drawImg(P.hairImg, P.bb);
    ctx.restore();
  }

  function draw() {
    ctx.setTransform(R, 0, 0, R, 0, 0);
    ctx.fillStyle = `rgb(${GROUND.join(",")})`;
    ctx.fillRect(0, 0, W, H);

    // Sheet and the fibres standing in its holes.
    shadow(
      () => {
        ctx.translate(SX - PAD, SY - PAD);
        ctx.scale(1 / R, 1 / R);
        ctx.drawImage(sheetSh, 0, 0);
      },
      0,
      0.75,
    );
    ctx.save();
    ctx.translate(SX - PAD, SY - PAD);
    ctx.scale(1 / R, 1 / R);
    ctx.drawImage(sheetCv, 0, 0);
    for (const q of pieces) if (q.state !== "healed") drawImg(q.holeImg, q.bb);
    ctx.restore();

    // A catalogue line, flush left on the sheet's foot.
    if (!portrait) {
      ctx.save();
      ctx.font = `${weight("body-sm", 490)} 13px ${FAMILY}`;
      ctx.letterSpacing = "-0.04px";
      ctx.fillStyle = INK;
      ctx.textBaseline = "alphabetic";
      ctx.fillText("experimenta typographica", Math.max(24, W * 0.07), Math.round(textY));
      ctx.restore();
    }

    for (const q of pieces) {
      if (q.state === "tearing") drawPiece(q, tearPose(q), q.tear.l);
      else drawPiece(q, q.pose, q.pose.l);
    }
  }

  stage.onFrame((dt) => {
    let moving = false;
    if (dragging) {
      const q = dragging.q;
      q.target = { x: stage.pointer.x + dragging.ox, y: stage.pointer.y + dragging.oy, a: q.rot };
    }
    if (tearing && performance.now() - lastHairs > 110) {
      lastHairs = performance.now();
      hairs(tearing);
      dirty = true;
    }
    for (const q of pieces) {
      if (q.state === "out" || q.state === "returning") {
        if (dragging && dragging.q === q) {
          q.pose.l += (1 - q.pose.l) * Math.min(1, dt * 14);
          const v = step(q, dt);
          moving = moving || v || true;
        } else if (step(q, dt)) moving = true;
      }
      if (q.state === "returning") {
        const t = q.target;
        if (Math.hypot(t.x - q.pose.x, t.y - q.pose.y) < 0.4 && Math.abs(q.pose.a) < 0.002) heal(q);
      }
      if (q.state === "healed") {
        q.fade -= dt / 0.3;
        moving = true;
      }
    }
    const before = pieces.length;
    pieces = pieces.filter((q) => q.state !== "healed" || q.fade > 0);
    if (pieces.length !== before) dirty = true;
    if (moving || dirty) {
      draw();
      dirty = false;
    }
  });

  return {
    destroy() {
      stage.destroy();
    },
  };
}
