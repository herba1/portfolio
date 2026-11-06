import { clamp } from "../_kit/stage";

// The strings of Catenary, kept free of the page so they can be checked in
// Node. Units are image px of the 6000 x 4000 photograph and seconds.

export const NODES = 96; // segments; the offline polyline has NODES + 1 points

// Per wire: fundamental (Hz), pluck reach (css px at a 1280 box), breeze sway
// (device px at mid span), coupling into its structure.
export const TUNE = {
  feeder: { f1: 1.05, reach: 18, sway: 2.6, coup: 1 },
  low: { f1: 1.35, reach: 16, sway: 1.8, coup: 1 },
  east1: { f1: 1.7, reach: 12, sway: 1.1, coup: 1 },
  east2: { f1: 1.8, reach: 12, sway: 1.1, coup: 1 },
  east3: { f1: 1.55, reach: 12, sway: 1.3, coup: 1 },
  east4: { f1: 1.6, reach: 12, sway: 1.3, coup: 1 },
};
const GAMMA = 0.55; // broadband damping, 1/s: the fundamental rings ~3.5 s
const VOIGT = 0.0045; // high modes die first (rate ~ VOIGT (n pi)^2 / 2)
export const STRUCT = { omega: 2 * Math.PI * 4.2, zeta: 0.3, gain: 0.8 };

// ---------------------------------------------------------------- strings

export function makeString(def, index) {
  const tune = TUNE[def.id] || TUNE.east1;
  const P = def.pts;
  const N = NODES;
  const ds = def.span / N; // image px per node
  // Rest frame per node: position and unit normal (image px).
  const px = new Float64Array(N + 1);
  const py = new Float64Array(N + 1);
  const nx = new Float64Array(N + 1);
  const ny = new Float64Array(N + 1);
  for (let j = 0; j <= N; j++) {
    // The fit puts pixel centres on integers; the page works in pixel edges.
    px[j] = P[j][0] + 0.5;
    py[j] = P[j][1] + 0.5;
    const a = P[Math.max(0, j - 1)];
    const b = P[Math.min(N, j + 1)];
    const tx = b[0] - a[0];
    const ty = b[1] - a[1];
    const l = Math.hypot(tx, ty) || 1;
    nx[j] = -ty / l;
    ny[j] = tx / l;
  }
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
    const ax = w.px[j] + w.nx[j] * w.y[j];
    const ay = w.py[j] + w.ny[j] * w.y[j];
    const bx = w.px[j + 1] + w.nx[j + 1] * w.y[j + 1];
    const by = w.py[j + 1] + w.ny[j + 1] * w.y[j + 1];
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
  // Hand on the wire: a stiff damped spring under a fingertip a node wide.
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
      for (let j = 1; j < N; j++) {
        const lap = y[j + 1] - 2 * y[j] + y[j - 1];
        const lapv = v[j + 1] - 2 * v[j] + v[j - 1];
        const gust = 1 + 0.25 * Math.sin((Math.PI * 3 * j) / N + simT * 0.6 + w.phase);
        let hand = 0;
        if (cg && Math.abs(j - cg.j) < 2.5) {
          const kern = Math.exp(-((j - cg.j) ** 2) / (2 * 0.55 * 0.55));
          hand = kern * (HK * (cg.target - y[j]) - HC * v[j]);
        }
        v[j] += h * (c2 * lap + visc * lapv - GAMMA * v[j] + fw * gust + hand);
      }
      for (let j = 1; j < N; j++) y[j] += h * v[j];
    }
  };
  return { wires, groups, step, time: () => simT };
}
