import { clamp } from "../_kit/stage";

// The strings of Catenary, kept free of the page so they can be checked in
// Node. Units are image px of the 6000 x 4000 photograph and seconds.

export const NODES = 96; // segments; the offline polyline has NODES + 1 points

// Per wire: fundamental (Hz), pluck reach (css px at a 1280 box), breeze sway
// (device px at mid span), coupling into its structure.
export const TUNE = {
  feeder: { f1: 1.05, reach: 36, sway: 2.6, coup: 1 },
  low: { f1: 1.35, reach: 32, sway: 1.8, coup: 1 },
  east1: { f1: 1.7, reach: 24, sway: 1.1, coup: 1 },
  east2: { f1: 1.8, reach: 24, sway: 1.1, coup: 1 },
  east3: { f1: 1.55, reach: 24, sway: 1.3, coup: 1 },
  east4: { f1: 1.6, reach: 24, sway: 1.3, coup: 1 },
};
const GAMMA = 0.55; // broadband damping, 1/s: the fundamental rings ~3.5 s
const VOIGT = 0.0045; // high modes die first (rate ~ VOIGT (n pi)^2 / 2)
export const STRUCT = { omega: 2 * Math.PI * 4.2, zeta: 0.3, gain: 0.8 };

// ---------------------------------------------------------------- the view

// The camera turned further up about its own centre. A pinhole camera
// rotated about its centre sees the same rays, only re-projected, so the
// new frame is exactly a homography of the photograph, H = K R K^-1, with no
// depth needed: verticals that already lean toward a vanishing point above
// the frame lean harder, and the whole scene drops toward the bottom edge.
// The photograph carries no EXIF; K assumes the a7 IV's full-frame sensor
// (35.9 mm wide, 6000 px) behind a 24 mm lens, principal point at the centre.
// "View" px are image px of that turned camera (identical at pitch 0).
export const LENS = { mm: 24, sensor: 35.9 };

const mul3 = (A, B) => {
  const C = new Array(9);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) C[r * 3 + c] = A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c];
  }
  return C;
};

export function pitchView(IW, IH, pitchDeg, { mm = LENS.mm, sensor = LENS.sensor } = {}) {
  const f = (mm / sensor) * IW;
  const cx = IW / 2;
  const cy = IH / 2;
  const t = (pitchDeg * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  const K = [f, 0, cx, 0, f, cy, 0, 0, 1];
  const Ki = [1 / f, 0, -cx / f, 0, 1 / f, -cy / f, 0, 0, 1];
  // R_x(t): the turned camera's axis, (0, 0, 1) in its own frame, is
  // (0, -sin t, cos t) in the photograph's (image y runs down, so up).
  const R = [1, 0, 0, 0, c, -s, 0, s, c];
  const Rt = [1, 0, 0, 0, c, s, 0, -s, c];
  const toImg = mul3(K, mul3(R, Ki)); // view px -> image px
  const toView = mul3(K, mul3(Rt, Ki)); // image px -> view px
  const apply = (M, x, y) => {
    const w = M[6] * x + M[7] * y + M[8];
    return [(M[0] * x + M[1] * y + M[2]) / w, (M[3] * x + M[4] * y + M[5]) / w, w];
  };
  const M = toView;
  return {
    pitch: pitchDeg,
    f,
    toImg,
    toView,
    // Each returns [x, y, w]; w is the homogeneous divisor, positive in view.
    img: (x, y) => apply(toImg, x, y),
    view: (x, y) => apply(toView, x, y),
    // d view / d image at an image point, row-major [a, b, c, d].
    jac(x, y) {
      const w = M[6] * x + M[7] * y + M[8];
      const px = (M[0] * x + M[1] * y + M[2]) / w;
      const py = (M[3] * x + M[4] * y + M[5]) / w;
      return [(M[0] - px * M[6]) / w, (M[1] - px * M[7]) / w, (M[3] - py * M[6]) / w, (M[4] - py * M[7]) / w];
    },
  };
}

// ---------------------------------------------------------------- strings

// The rest shape of a wire, as a function of s (image px along its chord
// from the support; node j sits at s = j ds). The bake fitted each wire as a
// catenary across that chord, p(s) = a0 + a1 s + g (cosh((s - m) / c) -
// cosh(m / c)), and its 97 points are that curve sampled; here it is
// evaluated exactly, so the wire is a true catenary at any resolution, not a
// polyline through the nodes. Without the fit (an older bake) it falls back
// to a Catmull-Rom through the points. Returns [x, y, nx, ny], pixel edges.
export function restOf(def) {
  const C = def.cat;
  if (C) {
    const ch = Math.cosh(C.m / C.c);
    const [tx, ty] = C.t;
    const [mx, my] = C.n;
    return (s) => {
      const u = (s - C.m) / C.c;
      const p = C.a0 + C.a1 * s + C.g * (Math.cosh(u) - ch);
      const dp = C.a1 + (C.g / C.c) * Math.sinh(u);
      const dx = tx + dp * mx;
      const dy = ty + dp * my;
      const l = Math.hypot(dx, dy) || 1;
      return [C.P0[0] + s * tx + p * mx + 0.5, C.P0[1] + s * ty + p * my + 0.5, -dy / l, dx / l];
    };
  }
  const P = def.pts;
  const N = P.length - 1;
  const ds = def.span / N;
  return (s) => {
    const f = clamp(s / ds, 0, N);
    const i = Math.min(N - 1, Math.floor(f));
    const t = f - i;
    const a = P[Math.max(0, i - 1)];
    const b = P[i];
    const c = P[i + 1];
    const d = P[Math.min(N, i + 2)];
    const cr = (k) => {
      const p0 = a[k];
      const p1 = b[k];
      const p2 = c[k];
      const p3 = d[k];
      const v = 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
      const dv = 0.5 * (-p0 + p2 + 2 * (2 * p0 - 5 * p1 + 4 * p2 - p3) * t + 3 * (-p0 + 3 * p1 - 3 * p2 + p3) * t * t);
      return [v, dv];
    };
    const [x, dx] = cr(0);
    const [y, dy] = cr(1);
    const l = Math.hypot(dx, dy) || 1;
    return [x + 0.5, y + 0.5, -dy / l, dx / l];
  };
}

export function makeString(def, index) {
  const tune = TUNE[def.id] || TUNE.east1;
  const N = NODES;
  const ds = def.span / N; // image px per node
  const rest = restOf(def);
  // Rest frame per node: position and unit normal (image px).
  const px = new Float64Array(N + 1);
  const py = new Float64Array(N + 1);
  const nx = new Float64Array(N + 1);
  const ny = new Float64Array(N + 1);
  for (let j = 0; j <= N; j++) [px[j], py[j], nx[j], ny[j]] = rest(j * ds);
  // Where the photograph keeps its own wire (the feeder's clamp), the drawn
  // displacement eases in from nothing with zero slope and curvature, so the
  // live wire leaves the photographed one tangentially instead of hinging off
  // it, the way a heavy cable stiffened at its clamp does. The ease is long
  // (~30% of the visible run): a short one has to overshoot to catch up with
  // the string, and bends nearly as hard as the corner it replaces. The hand
  // works in drawn space (see `lead` in the engine), so the wire stays under
  // it.
  const ho = def.handoff || [0, 0];
  const lead0 = ho[1] > ho[0] ? ho[0] : 0;
  const lead1 = ho[1] > ho[0] ? ho[0] + 0.3 * def.exit : 0;
  const lead = (s) => {
    if (lead1 <= lead0) return 1;
    const u = clamp((s - lead0) / (lead1 - lead0), 0, 1);
    return u * u * u * (u * (u * 6 - 15) + 10);
  };
  const knot = (arr, s) => {
    const f = clamp(s / def.span, 0, 1) * (arr.length - 1);
    const i = Math.min(arr.length - 2, Math.floor(f));
    return arr[i] + (arr[i + 1] - arr[i]) * (f - i);
  };
  const shade = new Float32Array(25 * 3);
  def.shade.forEach((c, i) => shade.set(c, i * 3));
  return {
    def,
    index,
    tune,
    N,
    ds,
    px,
    py,
    nx,
    ny,
    rest,
    lead,
    // First node a hand can take: where the drawn wire carries a fifth of
    // the string's displacement.
    jGrip: lead1 > lead0 ? (lead0 + 0.35 * (lead1 - lead0)) / ds : 0.6,
    // Width of the fingertip pad, nodes: a pull rounds over this, never a V.
    pad: Math.max(1.6, 0.09 * Math.min(N, Math.ceil(def.exit / ds) + 2)),
    knot,
    shade,
    jExit: Math.min(N, Math.ceil(def.exit / ds) + 2),
    y: new Float64Array(N + 1), // displacement along the rest normal, image px
    v: new Float64Array(N + 1),
    f: new Float64Array(N + 1), // external force this step
    phase: index * 1.7 + 0.4,
    caught: null,
    energy: 0,
  };
}

// Fractional node index and signed offset of an image point from the wire's
// current (displaced) line, over the visible run only.
export function locate(w, x, y) {
  let best = null;
  for (let j = 0; j < w.jExit; j++) {
    const ya = w.y[j] * w.lead(j * w.ds);
    const yb = w.y[j + 1] * w.lead((j + 1) * w.ds);
    const ax = w.px[j] + w.nx[j] * ya;
    const ay = w.py[j] + w.ny[j] * ya;
    const bx = w.px[j + 1] + w.nx[j + 1] * yb;
    const by = w.py[j + 1] + w.ny[j + 1] * yb;
    const ex = bx - ax;
    const ey = by - ay;
    const L2 = ex * ex + ey * ey;
    const t = clamp(((x - ax) * ex + (y - ay) * ey) / L2, 0, 1);
    const qx = ax + ex * t;
    const qy = ay + ey * t;
    const d = Math.hypot(x - qx, y - qy);
    if (!best || d < best.dist) {
      const nxx = w.nx[j] + (w.nx[j + 1] - w.nx[j]) * t;
      const nyy = w.ny[j] + (w.ny[j + 1] - w.ny[j]) * t;
      const side = (x - qx) * nxx + (y - qy) * nyy;
      best = { j: j + t, dist: d, side, ok: t > 0 || j > 0 };
    }
  }
  return best;
}

// Rest-relative offset of an image point along the wire's normal at node j.
export function offsetAt(w, j, x, y) {
  const i = Math.min(w.N - 1, Math.floor(j));
  const t = j - i;
  const rx = w.px[i] + (w.px[i + 1] - w.px[i]) * t;
  const ry = w.py[i] + (w.py[i + 1] - w.py[i]) * t;
  const nxx = w.nx[i] + (w.nx[i + 1] - w.nx[i]) * t;
  const nyy = w.ny[i] + (w.ny[i + 1] - w.ny[i]) * t;
  return (x - rx) * nxx + (y - ry) * nyy;
}

export function sampleY(w, j) {
  // Catmull-Rom through the nodes: smooth enough to draw at 4 px a segment.
  const i = clamp(Math.floor(j), 0, w.N - 1);
  const t = j - i;
  const y0 = w.y[Math.max(0, i - 1)];
  const y1 = w.y[i];
  const y2 = w.y[i + 1];
  const y3 = w.y[Math.min(w.N, i + 2)];
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * y1 + (-y0 + y2) * t + (2 * y0 - 5 * y1 + 4 * y2 - y3) * t2 + (-y0 + 3 * y1 - 3 * y2 + y3) * t3);
}

// A wire drawn aside by a fingertip and held: the static shape of the string
// under a load spread over a Gaussian pad (sigma = w.pad nodes) at node jc,
// y'' = -q with both ends where the supports hold them, scaled so the wire
// stands A image px off its rest line at jc. Straight runs out to the
// supports, a rounded crown under the pad: smooth everywhere, so neither the
// held pull nor the two pulses it releases ever show a corner.
export function pullShape(w, jc, A) {
  const { N, y } = w;
  const pad = w.pad;
  y[0] = 0;
  y[1] = 0;
  for (let j = 1; j < N; j++) y[j + 1] = 2 * y[j] - y[j - 1] - Math.exp(-((j - jc) ** 2) / (2 * pad * pad));
  const tilt = y[N] / N;
  for (let j = 0; j <= N; j++) y[j] -= tilt * j;
  const i = clamp(Math.floor(jc), 0, N - 1);
  const peak = y[i] + (y[i + 1] - y[i]) * (jc - i);
  const sc = Math.abs(peak) > 1e-9 ? A / peak : 0;
  for (let j = 0; j <= N; j++) y[j] *= sc;
  w.v.fill(0);
}

// All the wires, and the two structures they hang from (the mast with its
// lattice, the far pole). Each structure is a stiff damped mass the wires'
// end slopes pull on; its motion moves every support on it, which is how a
// hard pluck reaches the neighbours.
export function createWorld(defs) {
  const wires = defs.map((d, i) => makeString(d, i));
  const groups = {};
  for (const w of wires) groups[w.def.group] ??= { m: 0, v: 0, wires: [] };
  for (const w of wires) groups[w.def.group].wires.push(w);
  let simT = 0;
  const windAt = (t, lag) => {
    const u = t - lag;
    return 0.58 * Math.sin(2 * Math.PI * 0.071 * u + 0.3) + 0.3 * Math.sin(2 * Math.PI * 0.163 * u + 2.1) + 0.12 * Math.sin(2 * Math.PI * 0.41 * u + 4.0);
  };
  // Hand on the wire: a stiff damped spring under a fingertip pad.
  const HK = (2 * Math.PI * 22) ** 2;
  const HC = 2 * 0.8 * 2 * Math.PI * 22;

  const step = (h, { wind = 0, k = 1 } = {}) => {
    simT += h;
    for (const g of Object.values(groups)) {
      let pull = 0;
      for (const w of g.wires) pull += (w.y[1] - w.y[0]) * w.tune.coup;
      const om = STRUCT.omega;
      const a = -om * om * (g.m - STRUCT.gain * pull) - 2 * STRUCT.zeta * om * g.v;
      g.v += a * h;
      g.m += g.v * h;
    }
    for (const w of wires) {
      const { N, y, v } = w;
      const c = 2 * w.def.span * w.tune.f1; // image px / s
      const c2 = (c * c) / (w.ds * w.ds);
      const visc = (VOIGT * (w.def.span * w.def.span)) / (w.ds * w.ds);
      // Breeze: a uniform push sized to give `sway` device px at mid span.
      const swayImg = w.tune.sway / Math.max(k, 0.05);
      const fw = ((wind * 8 * (c * c)) / (w.def.span * w.def.span)) * swayImg * windAt(simT, w.index * 0.35);
      const g = groups[w.def.group];
      y[0] = g.m;
      v[0] = g.v;
      y[N] = 0;
      v[N] = 0;
      const cg = w.caught;
      // The hand is a pad, not a point: the wire rounds over it.
      const hs = 0.5 * w.pad;
      for (let j = 1; j < N; j++) {
        const lap = y[j + 1] - 2 * y[j] + y[j - 1];
        const lapv = v[j + 1] - 2 * v[j] + v[j - 1];
        const gust = 1 + 0.25 * Math.sin((Math.PI * 3 * j) / N + simT * 0.6 + w.phase);
        let hand = 0;
        if (cg && Math.abs(j - cg.j) < 3 * hs) {
          const kern = Math.exp(-((j - cg.j) ** 2) / (2 * hs * hs));
          hand = kern * (HK * (cg.target - y[j]) - HC * v[j]);
        }
        v[j] += h * (c2 * lap + visc * lapv - GAMMA * v[j] + fw * gust + hand);
      }
      for (let j = 1; j < N; j++) y[j] += h * v[j];
    }
  };
  return { wires, groups, step, time: () => simT };
}
