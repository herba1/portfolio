const DRAW = { vmax: 1.35, accel: 11, deviation: 0.0016 };
const TRAVEL = { vmax: 2.6, accel: 16 };
const DWELL = 0.16;

export function planPlot(strokes, { start = [0.5, -0.08], target = 55, minT = 38, maxT = 70 } = {}) {
  const xs = [];
  const ys = [];
  const downs = [];
  const dwell = [];
  const push = (x, y) => {
    xs.push(x);
    ys.push(y);
  };
  push(start[0], start[1]);
  const seg = (down, hold = 0) => {
    downs.push(down ? 1 : 0);
    dwell.push(hold);
  };
  for (const stroke of strokes) {
    const pts = stroke;
    if (pts.length < 2) continue;
    push(pts[0], pts[1]);
    seg(false);
    push(pts[0], pts[1]);
    seg(false, DWELL);
    for (let i = 2; i < pts.length; i += 2) {
      push(pts[i], pts[i + 1]);
      seg(true);
    }
    push(pts[pts.length - 2], pts[pts.length - 1]);
    seg(false, DWELL * 0.8);
  }
  const n = downs.length;
  const L = new Float32Array(n);
  const dx = new Float32Array(n);
  const dy = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const ax = xs[i + 1] - xs[i];
    const ay = ys[i + 1] - ys[i];
    const l = Math.hypot(ax, ay);
    L[i] = l;
    dx[i] = l > 0 ? ax / l : 0;
    dy[i] = l > 0 ? ay / l : 0;
  }
  const vj = new Float32Array(n + 1);
  for (let i = 1; i < n; i += 1) {
    const a = i - 1;
    const b = i;
    if (downs[a] !== downs[b] || L[a] === 0 || L[b] === 0 || dwell[a] || dwell[b]) {
      vj[i] = 0;
      continue;
    }
    const prm = downs[b] ? DRAW : TRAVEL;
    const cos = -(dx[a] * dx[b] + dy[a] * dy[b]);
    if (cos > 0.9999) {
      vj[i] = 0;
      continue;
    }
    if (cos < -0.9999) {
      vj[i] = prm.vmax;
      continue;
    }
    const sh = Math.sqrt(0.5 * (1 - cos));
    const dev = downs[b] ? DRAW.deviation : DRAW.deviation * 4;
    vj[i] = Math.min(prm.vmax, Math.sqrt((prm.accel * dev * sh) / (1 - sh)));
  }
  vj[0] = 0;
  vj[n] = 0;
  for (let i = n - 1; i >= 0; i -= 1) {
    const prm = downs[i] ? DRAW : TRAVEL;
    vj[i] = Math.min(vj[i], Math.sqrt(vj[i + 1] * vj[i + 1] + 2 * prm.accel * L[i]));
  }
  for (let i = 0; i < n; i += 1) {
    const prm = downs[i] ? DRAW : TRAVEL;
    vj[i + 1] = Math.min(vj[i + 1], Math.sqrt(vj[i] * vj[i] + 2 * prm.accel * L[i]));
  }
  const t0 = new Float64Array(n + 1);
  const ta = new Float32Array(n);
  const tc = new Float32Array(n);
  const td = new Float32Array(n);
  const vp = new Float32Array(n);
  const acc = new Float32Array(n);
  let t = 0;
  for (let i = 0; i < n; i += 1) {
    t0[i] = t;
    if (dwell[i]) {
      tc[i] = dwell[i];
      t += dwell[i];
      continue;
    }
    const prm = downs[i] ? DRAW : TRAVEL;
    const a = prm.accel;
    const u = vj[i];
    const w = vj[i + 1];
    const l = L[i];
    if (l <= 0) continue;
    const peak = Math.min(prm.vmax, Math.sqrt(Math.max(0, (2 * a * l + u * u + w * w) / 2)));
    const p = Math.max(peak, u, w);
    const dA = Math.max(0, (p * p - u * u) / (2 * a));
    const dD = Math.max(0, (p * p - w * w) / (2 * a));
    const dC = Math.max(0, l - dA - dD);
    ta[i] = (p - u) / a;
    td[i] = (p - w) / a;
    tc[i] = p > 0 ? dC / p : 0;
    vp[i] = p;
    acc[i] = a;
    t += ta[i] + tc[i] + td[i];
  }
  t0[n] = t;
  const total = Math.max(minT, Math.min(maxT, target));
  const scale = total / t;
  for (let i = 0; i <= n; i += 1) t0[i] *= scale;
  const events = [];
  for (let i = 0; i < n; i += 1) {
    if (dwell[i] && i + 1 < n && downs[i + 1]) events.push({ t: t0[i] + dwell[i] * scale * 0.6, type: "down", x: xs[i], y: ys[i] });
    if (dwell[i] && i > 0 && downs[i - 1]) events.push({ t: t0[i] + dwell[i] * scale * 0.3, type: "up", x: xs[i], y: ys[i] });
  }
  const width = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    if (!downs[i]) continue;
    const dur = t0[i + 1] - t0[i];
    const mean = dur > 0 ? L[i] / dur / (DRAW.vmax / scale) : 1;
    const slow = Math.max(0, 1 - Math.min(1, mean));
    width[i] = 1 + 0.75 * slow * slow * slow;
  }
  const pool = [];
  for (let i = 1; i < n; i += 1) {
    if (downs[i - 1] && downs[i] && vj[i] < DRAW.vmax * 0.06) pool.push(i);
  }
  return {
    n,
    xs: Float32Array.from(xs),
    ys: Float32Array.from(ys),
    downs: Uint8Array.from(downs),
    L,
    dx,
    dy,
    vj,
    t0,
    ta,
    tc,
    td,
    vp,
    acc,
    dwell: Float32Array.from(dwell),
    scale,
    duration: t0[n],
    events,
    width,
    pool: Int32Array.from(pool),
    vmax: DRAW.vmax,
  };
}

export function locate(plan, time) {
  const { t0, n } = plan;
  if (time <= 0) return 0;
  if (time >= t0[n]) return n - 1;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (t0[mid] <= time) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function sample(plan, i, time, out) {
  const { xs, ys, dx, dy, L, ta, tc, td, vp, vj, acc, scale, dwell } = plan;
  const local = Math.max(0, (time - plan.t0[i]) / scale);
  let s = 0;
  let v = 0;
  if (dwell[i] || L[i] === 0) {
    s = 0;
    v = 0;
  } else {
    const a = acc[i];
    const u = vj[i];
    const p = vp[i];
    const dA = (p * p - u * u) / (2 * a);
    if (local < ta[i]) {
      s = u * local + 0.5 * a * local * local;
      v = u + a * local;
    } else if (local < ta[i] + tc[i]) {
      s = dA + p * (local - ta[i]);
      v = p;
    } else {
      const q = Math.min(td[i], local - ta[i] - tc[i]);
      s = dA + p * tc[i] + p * q - 0.5 * a * q * q;
      v = p - a * q;
    }
    s = Math.min(L[i], Math.max(0, s));
  }
  out.x = xs[i] + dx[i] * s;
  out.y = ys[i] + dy[i] * s;
  out.v = Math.max(0, v) / scale;
  out.vx = Math.abs(dx[i]) * out.v;
  out.vy = Math.abs(dy[i]) * out.v;
  out.down = plan.downs[i] === 1;
  return out;
}
