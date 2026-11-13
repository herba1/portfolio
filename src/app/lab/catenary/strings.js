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
// Peak transverse give of a held wire, as a fraction of its visible run.
export const TAUT = 0.035;
const GAMMA = 0.55; // broadband damping, 1/s: the fundamental rings ~3.5 s
const VOIGT = 0.0045; // high modes die first (rate ~ VOIGT (n pi)^2 / 2)
export const STRUCT = { omega: 2 * Math.PI * 4.2, zeta: 0.3, gain: 0.8 };
// Bending stiffness, as the length over which a cable under tension rounds a
// load, l = sqrt(EI / T), in cable diameters. A stranded steel cable of
// diameter d at line tension comes out near 5 d (a 20 mm feeder: EI ~ 150
// N m^2, T ~ 15 kN, l ~ 0.1 m). The string's physics stays a string; the
// drawn shape takes the stiffness (see shapeDrawn).
export const STIFF = 5;

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
  // Where the photograph keeps its own wire (the feeder, across the mast's
  // steel by its insulator), the string is pinned mid-way along that handoff:
  // nodes up to j0 hold the support and the free string starts there. A taut
  // wire turns only at its clamp, so the live wire leaves the photographed one
  // inside the crossfade (a few px at a full pull, under a 40 px wire) and
  // runs out straight, with no long ease to bend it into an S. The feeder is
  // a heavy, stiff cable, so the turn at the clamp is a short fillet (see
  // drawnY), not a hinge.
  const ho = def.handoff || [0, 0];
  const j0 = ho[1] > ho[0] ? Math.round((ho[0] + ho[1]) / 2 / ds) : 0;
  const jExit = Math.min(N, Math.ceil(def.exit / ds) + 2);
  const knot = (arr, s) => {
    const f = clamp(s / def.span, 0, 1) * (arr.length - 1);
    const i = Math.min(arr.length - 2, Math.floor(f));
    return arr[i] + (arr[i + 1] - arr[i]) * (f - i);
  };
  const shade = new Float32Array(25 * 3);
  def.shade.forEach((c, i) => shade.set(c, i * 3));
  // The cable's diameter at its support, image px: the stiffness length.
  const dia = def.w.slice(0, 4).reduce((a, b) => a + b, 0) / Math.min(4, def.w.length);
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
    j0,
    // Fillet at the pin, image px (sigma of the smoothed turn).
    bend: j0 > 0 ? 1.1 * ds : 0,
    // Free length, image px: the string between its pin and the far support.
    L: def.span - j0 * ds,
    // First node a hand can take: clear of the pin.
    jGrip: j0 + 1.5,
    // Width of the fingertip pad, nodes: a fingertip, not a palm. A tensioned
    // wire pushed aside runs out in two straight legs to its supports and
    // rounds only over the few nodes under the pad, never a V, never a hose.
    pad: 1.2,
    // The most a hand can hold it aside, image px: a taut wire gives only a
    // few percent of its visible run before the tension wins.
    give: TAUT * (jExit - j0) * ds,
    knot,
    shade,
    jExit,
    // Stiffness length in nodes (see STIFF, shapeDrawn).
    stiff: (STIFF * dia) / ds,
    rev: 0, // bumped whenever y changes; the drawn shape follows it
    drawnRev: -1,
    yd: new Float64Array(N + 1), // drawn displacement at the nodes, image px
    m2: new Float64Array(N + 1), // its cubic spline's second differences
    tri: new Float64Array(N + 1), // scratch for the two solves
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
    const ya = w.y[j];
    const yb = w.y[j + 1];
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

// The drawn shape at the nodes, from the string's. Two steps, both solved
// along the free run (the pin j0 to the far support), with the ends held:
//  1. Stiffness. A cable with bending stiffness EI under tension T carries a
//     load as T y'' - EI y'''' = -q; the string's own shape y_s has T y_s'' =
//     -q, so the cable's is y_s filtered by (1 - l^2 D^2)^-1, l^2 = EI / T: an
//     exponential kernel of length l. Straight legs pass through unchanged;
//     the crown under a fingertip and the corners of a running pulse round
//     over l, as a steel cable's do, instead of over one node.
//  2. A natural cubic spline through those nodes (C2: the curvature is
//     continuous, so no node shows as a facet or a soft kink).
// Cheap: two tridiagonal solves of ~96 per wire, once per change of y.
export function shapeDrawn(w) {
  if (w.drawnRev === w.rev) return;
  w.drawnRev = w.rev;
  const { N, y, yd, m2, tri, j0 } = w;
  for (let j = 0; j <= j0; j++) yd[j] = y[j];
  yd[N] = y[N];
  // -L2 z_j-1 + (1 + 2 L2) z_j - L2 z_j+1 = y_j, z_j0 and z_N held (Thomas;
  // tri holds L2 / den, m2 the forward-swept right side).
  const L2 = w.stiff * w.stiff;
  const b = 1 + 2 * L2;
  let cp = 0;
  let dp = yd[j0];
  for (let j = j0 + 1; j < N; j++) {
    const den = b - L2 * cp;
    const rhs = y[j] + L2 * dp + (j === N - 1 ? L2 * yd[N] : 0);
    cp = L2 / den;
    dp = rhs / den;
    tri[j] = cp;
    m2[j] = dp;
  }
  // z_j = d'_j + c'_j z_j+1
  for (let j = N - 1; j > j0; j--) yd[j] = m2[j] + (j === N - 1 ? 0 : tri[j] * yd[j + 1]);
  // Natural spline over j0..N, unit spacing: m_j-1 + 4 m_j + m_j+1 =
  // 6 (z_j+1 - 2 z_j + z_j-1), m_j0 = m_N = 0.
  m2.fill(0);
  cp = 0;
  dp = 0;
  for (let j = j0 + 1; j < N; j++) {
    const den = 4 - cp;
    const rhs = 6 * (yd[j + 1] - 2 * yd[j] + yd[j - 1]) - dp;
    cp = 1 / den;
    dp = rhs / den;
    tri[j] = cp;
    m2[j] = dp;
  }
  for (let j = N - 2; j > j0; j--) m2[j] -= tri[j] * m2[j + 1];
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

const erf = (x) => {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const e = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x < 0 ? -e : e;
};

// The displacement as drawn: the stiff cable's shape through its spline (see
// shapeDrawn), with the turn at its pin rounded the way a stiff cable leaves
// its clamp. The spline runs from the pin, so there it is a clean hinge onto
// the first free segment; that slope a turns on over a Gaussian-smoothed ramp
// of width w.bend instead of a corner: y + a (R(x) - max(x, 0)), R the ramp
// max(x, 0) blurred by that Gaussian. The correction vanishes a few widths
// from the pin, so the legs stay straight and the crown is untouched.
export function drawnY(w, j) {
  shapeDrawn(w);
  const { N, j0, yd, m2 } = w;
  const jj = clamp(j, 0, N);
  let y;
  if (jj <= j0) {
    const i = Math.min(N - 1, Math.floor(jj));
    y = yd[i] + (yd[i + 1] - yd[i]) * (jj - i);
  } else {
    const i = Math.min(N - 1, Math.floor(jj));
    const t = jj - i;
    const u = 1 - t;
    y = u * yd[i] + t * yd[i + 1] + ((u * u * u - u) * m2[i] + (t * t * t - t) * m2[i + 1]) / 6;
  }
  if (!j0) return y;
  const x = ((j - j0) * w.ds) / w.bend;
  if (x < -4 || x > 4) return y;
  const a = (yd[j0 + 1] - yd[j0]) / w.ds;
  const R = x * 0.5 * (1 + erf(x / Math.SQRT2)) + Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
  return y + a * w.bend * (R - Math.max(x, 0));
}

// A wire drawn aside by a fingertip and held: the static shape of the string
// under a load spread over a narrow Gaussian pad (sigma = w.pad nodes) at node
// jc, y'' = -q with both ends where the supports hold them (the pin j0 and
// node N), scaled so the wire stands A image px off its rest line at jc. Two
// straight legs out to the supports and a small rounded crown under the pad:
// the shape of a tensioned wire pushed aside, smooth everywhere, so neither
// the held pull nor the two pulses it releases ever show a corner.
export function pullShape(w, jc, A) {
  const { N, y, j0 } = w;
  const pad = w.pad;
  for (let j = 0; j <= j0 + 1; j++) y[j] = 0;
  for (let j = j0 + 1; j < N; j++) y[j + 1] = 2 * y[j] - y[j - 1] - Math.exp(-((j - jc) ** 2) / (2 * pad * pad));
  const tilt = y[N] / (N - j0);
  for (let j = j0; j <= N; j++) y[j] -= tilt * (j - j0);
  const i = clamp(Math.floor(jc), 0, N - 1);
  const peak = y[i] + (y[i + 1] - y[i]) * (jc - i);
  const sc = Math.abs(peak) > 1e-9 ? A / peak : 0;
  for (let j = 0; j <= N; j++) y[j] *= sc;
  w.v.fill(0);
  w.rev++;
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
      for (const w of g.wires) pull += (w.y[w.j0 + 1] - w.y[w.j0]) * w.tune.coup;
      const om = STRUCT.omega;
      const a = -om * om * (g.m - STRUCT.gain * pull) - 2 * STRUCT.zeta * om * g.v;
      g.v += a * h;
      g.m += g.v * h;
    }
    for (const w of wires) {
      const { N, y, v, j0, L } = w;
      const c = 2 * L * w.tune.f1; // image px / s
      const c2 = (c * c) / (w.ds * w.ds);
      const visc = (VOIGT * (L * L)) / (w.ds * w.ds);
      // Breeze: a uniform push sized to give `sway` device px at mid span.
      const swayImg = w.tune.sway / Math.max(k, 0.05);
      const fw = ((wind * 8 * (c * c)) / (L * L)) * swayImg * windAt(simT, w.index * 0.35);
      const g = groups[w.def.group];
      for (let j = 0; j <= j0; j++) {
        y[j] = g.m;
        v[j] = g.v;
      }
      y[N] = 0;
      v[N] = 0;
      const cg = w.caught;
      // The hand is a pad, not a point: the wire rounds over it.
      const hs = 0.5 * w.pad;
      for (let j = j0 + 1; j < N; j++) {
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
      for (let j = j0 + 1; j < N; j++) y[j] += h * v[j];
      w.rev++;
    }
  };
  return { wires, groups, step, time: () => simT };
}
