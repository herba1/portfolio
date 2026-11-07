// Wind in the grass: a small stable-fluids velocity field (Stam 1999) that
// the pointer authors, the idle breeze laid over it, and the grass answering
// it as damped springs.
//
// The camera lies in the grass looking up, so the grid covers the whole frame
// in screen space: a sheet of air just above the seed heads, seen from below.
// The velocity it carries is the air's, in metres per second, at a fixed
// scale of CX cells per metre (the stalks nearest the lens are about a metre
// from it, and everything in frame is within a few metres of that).
//
// Per cell, the grass is a damped spring (natural frequency ~0.75 Hz, damping
// ratio 0.3) pulled toward a bend that grows with dynamic pressure (∝ |w|²)
// and saturates: stalks lie over and spring back with a little overshoot,
// which is what makes the wave behind a gust read as a wave.

export const GX = 96;
export const GY = 64;
export const GY0 = 0; // grid top, image uv (y down): the grid covers the frame

// Cells per metre, the same both ways: no ground plane to foreshorten.
const CX = 5.6;
const cx = () => CX;
const cy = () => CX;

const N = GX * GY;
const idx = (i, j) => j * GX + i;

function hash(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function vnoise(x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export function createWind() {
  // Every cell carries air; P is the (uniform) scale kept per cell so the
  // advection and the stroke read the same way they would with perspective.
  const P = new Float32Array(N).fill(1);
  const ground = new Float32Array(N).fill(1);

  const U = new Float32Array(N); // air velocity on the ground, m/s (across)
  const V = new Float32Array(N); // m/s, toward the camera (screen down)
  const U0 = new Float32Array(N);
  const V0 = new Float32Array(N);
  const pr = new Float32Array(N);
  const dv = new Float32Array(N);
  const curl = new Float32Array(N);
  const bx = new Float32Array(N); // bend, across (+ right)
  const bz = new Float32Array(N); // bend, into the field (+ away)
  const sx = new Float32Array(N); // bend velocity
  const sz = new Float32Array(N);
  const wx = new Float32Array(N); // total wind, m/s
  const wz = new Float32Array(N);
  const out = new Float32Array(N * 4);

  // Breeze: a light air from the left, lifting a little as it comes over the
  // seed heads (2-4 m/s, Beaufort 2-3), with gust cells ~9 m across drifting
  // with it.
  const BDIR = [0.96, 0.28];
  let breeze = 1;
  let time = 0;
  let gustMean = 0; // smoothed lateral wind of the gusts, for the clouds
  const dir = [BDIR[0], BDIR[1]]; // smoothed mean wind direction

  const sample = (A, x, y) => {
    x = Math.min(GX - 1.001, Math.max(0, x));
    y = Math.min(GY - 1.001, Math.max(0, y));
    const i = x | 0;
    const j = y | 0;
    const fx = x - i;
    const fy = y - j;
    const k = idx(i, j);
    return (A[k] * (1 - fx) + A[k + 1] * fx) * (1 - fy) + (A[k + GX] * (1 - fx) + A[k + GX + 1] * fx) * fy;
  };

  const advect = (dt) => {
    U0.set(U);
    V0.set(V);
    for (let j = 0; j < GY; j++) {
      for (let i = 0; i < GX; i++) {
        const k = idx(i, j);
        const p = P[k];
        // World velocity is what is carried; it moves across the screen at
        // the perspective scale of where it is.
        const x = i - dt * U0[k] * cx(p);
        const y = j - dt * V0[k] * cy(p);
        U[k] = sample(U0, x, y) * ground[k];
        V[k] = sample(V0, x, y) * ground[k];
      }
    }
  };

  // A little viscosity: relax each cell toward its neighbours, which also
  // keeps the collocated grid from growing a checkerboard.
  const diffuse = (a) => {
    for (const A of [U, V]) {
      U0.set(A);
      for (let j = 1; j < GY - 1; j++) {
        for (let i = 1; i < GX - 1; i++) {
          const k = idx(i, j);
          A[k] = U0[k] + a * (U0[k - 1] + U0[k + 1] + U0[k - GX] + U0[k + GX] - 4 * U0[k]);
        }
      }
    }
  };

  const vorticity = (dt, eps) => {
    for (let j = 1; j < GY - 1; j++) {
      for (let i = 1; i < GX - 1; i++) {
        const k = idx(i, j);
        curl[k] = 0.5 * (V[k + 1] - V[k - 1] - (U[k + GX] - U[k - GX]));
      }
    }
    for (let j = 2; j < GY - 2; j++) {
      for (let i = 2; i < GX - 2; i++) {
        const k = idx(i, j);
        const gx = 0.5 * (Math.abs(curl[k + 1]) - Math.abs(curl[k - 1]));
        const gy = 0.5 * (Math.abs(curl[k + GX]) - Math.abs(curl[k - GX]));
        const l = Math.hypot(gx, gy) + 1e-5;
        U[k] += dt * eps * (gy / l) * curl[k];
        V[k] -= dt * eps * (gx / l) * curl[k];
      }
    }
  };

  const project = (iters) => {
    for (let j = 1; j < GY - 1; j++) {
      for (let i = 1; i < GX - 1; i++) {
        const k = idx(i, j);
        dv[k] = -0.5 * (U[k + 1] - U[k - 1] + V[k + GX] - V[k - GX]);
      }
    }
    pr.fill(0);
    for (let it = 0; it < iters; it++) {
      for (let j = 1; j < GY - 1; j++) {
        for (let i = 1; i < GX - 1; i++) {
          const k = idx(i, j);
          pr[k] = (dv[k] + pr[k - 1] + pr[k + 1] + pr[k - GX] + pr[k + GX]) * 0.25;
        }
      }
    }
    for (let j = 1; j < GY - 1; j++) {
      for (let i = 1; i < GX - 1; i++) {
        const k = idx(i, j);
        U[k] -= 0.5 * (pr[k + 1] - pr[k - 1]);
        V[k] -= 0.5 * (pr[k + GX] - pr[k - GX]);
      }
    }
    // Open edges: air leaves the frame freely.
    for (let i = 0; i < GX; i++) {
      U[idx(i, 0)] = U[idx(i, 1)];
      V[idx(i, 0)] = V[idx(i, 1)];
      U[idx(i, GY - 1)] = U[idx(i, GY - 2)];
      V[idx(i, GY - 1)] = V[idx(i, GY - 2)];
    }
    for (let j = 0; j < GY; j++) {
      U[idx(0, j)] = U[idx(1, j)];
      V[idx(0, j)] = V[idx(1, j)];
      U[idx(GX - 1, j)] = U[idx(GX - 2, j)];
      V[idx(GX - 1, j)] = V[idx(GX - 2, j)];
    }
  };

  // A stroke from (x0,y0) to (x1,y1) in image uv, at screen speed (vx, vy) in
  // uv/s: the air under the brush is pulled toward the stroke's ground
  // velocity, capped at 17 m/s (Beaufort 7).
  const stroke = (x0, y0, x1, y1, vx, vy, gain = 1) => {
    const gx0 = x0 * GX - 0.5;
    const gy0 = ((y0 - GY0) / (1 - GY0)) * GY - 0.5;
    const gx1 = x1 * GX - 0.5;
    const gy1 = ((y1 - GY0) / (1 - GY0)) * GY - 0.5;
    const su = vx * GX; // cells / s
    const sv = (vy / (1 - GY0)) * GY;
    const len = Math.hypot(gx1 - gx0, gy1 - gy0);
    const steps = Math.max(1, Math.ceil(len / 0.75));
    const R = 4.2;
    const R2 = R * R;
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const cxp = gx0 + (gx1 - gx0) * t;
      const cyp = gy0 + (gy1 - gy0) * t;
      const i0 = Math.max(0, Math.floor(cxp - R * 1.6));
      const i1 = Math.min(GX - 1, Math.ceil(cxp + R * 1.6));
      const j0 = Math.max(0, Math.floor(cyp - R * 1.6));
      const j1 = Math.min(GY - 1, Math.ceil(cyp + R * 1.6));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const d2 = (i - cxp) ** 2 + (j - cyp) ** 2;
          if (d2 > R2 * 2.6) continue;
          const k = idx(i, j);
          const p = P[k];
          // ground speed of the stroke under this cell, capped
          let gu = su / cx(p);
          let gv = sv / cy(p);
          const m = Math.hypot(gu, gv);
          const cap = 17;
          if (m > cap) {
            gu *= cap / m;
            gv *= cap / m;
          }
          const w = Math.exp(-d2 / R2) * gain * (0.35 / steps + 0.08);
          U[k] += (gu - U[k]) * Math.min(1, w) * ground[k];
          V[k] += (gv - V[k]) * Math.min(1, w) * ground[k];
        }
      }
    }
  };

  const OMEGA = 2 * Math.PI * 0.75;
  const ZETA = 0.3;
  const S0 = 6.5; // m/s where the bend reaches half its limit
  const BMAX = 1.0;
  const DISSIPATE = 3.6; // s

  const step = (dt) => {
    time += dt;
    advect(dt);
    diffuse(0.05);
    vorticity(dt, 2.5);
    project(22);
    const fade = Math.exp(-dt / DISSIPATE);
    let mean = 0;
    let cnt = 0;
    let mx = 0;
    let mz = 0;
    for (let j = 0; j < GY; j++) {
      for (let i = 0; i < GX; i++) {
        const k = idx(i, j);
        U[k] *= fade;
        V[k] *= fade;
        const p = P[k];
        // gust air, m/s (V is screen-down; the second component is screen-up)
        let gu = U[k];
        let gv = -V[k];
        const gm = Math.hypot(gu, gv);
        if (gm > 20) {
          gu *= 20 / gm;
          gv *= 20 / gm;
        }
        if (ground[k]) {
          mean += gu;
          cnt++;
        }
        // breeze at this cell's position in the air sheet, metres
        const X = (i - GX / 2) / cx(p);
        const Z = (j - GY / 2) / cy(p);
        const a = X * BDIR[0] + Z * BDIR[1] - time * 3.2;
        const c = -X * BDIR[1] + Z * BDIR[0];
        const n = vnoise(a / 9, c / 14) * 0.65 + vnoise(a / 4.2 + 7.1, c / 6 + 3.3) * 0.35;
        const bs = breeze * (1.6 + (4.6 * Math.max(0, n - 0.32)) / 0.68);
        const w0 = gu + BDIR[0] * bs;
        const w1 = gv + BDIR[1] * bs;
        wx[k] = w0;
        wz[k] = w1;
        mx += w0 * ground[k];
        mz += w1 * ground[k];
        const s2 = w0 * w0 + w1 * w1;
        const s = Math.sqrt(s2) + 1e-6;
        const f = (BMAX * s2) / (s2 + S0 * S0) / s;
        const tx = w0 * f;
        const tz = w1 * f;
        // semi-implicit damped spring toward the target bend
        sx[k] += (OMEGA * OMEGA * (tx - bx[k]) - 2 * ZETA * OMEGA * sx[k]) * dt;
        sz[k] += (OMEGA * OMEGA * (tz - bz[k]) - 2 * ZETA * OMEGA * sz[k]) * dt;
        bx[k] += sx[k] * dt;
        bz[k] += sz[k] * dt;
      }
    }
    mean = cnt ? mean / cnt : 0;
    gustMean += (mean - gustMean) * (1 - Math.exp(-dt / 3));
    const ml = Math.hypot(mx, mz);
    if (ml > 1e-6) {
      const a = 1 - Math.exp(-dt / 1.5);
      dir[0] += (mx / ml - dir[0]) * a;
      dir[1] += (mz / ml - dir[1]) * a;
      const dl = Math.hypot(dir[0], dir[1]) || 1;
      dir[0] /= dl;
      dir[1] /= dl;
    }
  };

  // What the stalks show: a stalk bends about its root below the frame and
  // carries its whole length over together, so the bend seen at a point is
  // the cells' bend gathered along the stalk (tall, mostly vertical on
  // screen) and a little across its neighbours. Without it the hard edge of
  // a strong gust shears the stalks crossing it into horizontal ribbons.
  const KX = [1, 2, 3, 2, 1];
  const KY = [1, 2, 3, 4, 5, 6, 7, 6, 5, 4, 3, 2, 1];
  const tx_ = new Float32Array(N);
  const tz_ = new Float32Array(N);
  const blur = (src, tmp, dst, K, di, dj) => {
    const r = (K.length - 1) / 2;
    for (let j = 0; j < GY; j++) {
      for (let i = 0; i < GX; i++) {
        let s = 0;
        let wsum = 0;
        for (let n = -r; n <= r; n++) {
          const ii = i + n * di;
          const jj = j + n * dj;
          if (ii < 0 || ii >= GX || jj < 0 || jj >= GY) continue;
          s += src[idx(ii, jj)] * K[n + r];
          wsum += K[n + r];
        }
        (dst || tmp)[idx(i, j)] = s / wsum;
      }
    }
  };
  const gx_ = new Float32Array(N);
  const gz_ = new Float32Array(N);
  const pack = () => {
    blur(bx, tx_, null, KX, 1, 0);
    blur(tx_, null, gx_, KY, 0, 1);
    blur(bz, tz_, null, KX, 1, 0);
    blur(tz_, null, gz_, KY, 0, 1);
    for (let k = 0; k < N; k++) {
      out[k * 4] = gx_[k];
      out[k * 4 + 1] = gz_[k];
      out[k * 4 + 2] = wx[k];
      out[k * 4 + 3] = wz[k];
    }
    return out;
  };

  // Energy left in the gusts (0 when only the breeze moves the grass).
  const activity = () => {
    let e = 0;
    for (let k = 0; k < N; k += 7) e += Math.abs(U[k]) + Math.abs(V[k]);
    return e / (N / 7);
  };

  return {
    step,
    stroke,
    pack,
    activity,
    get gustMean() {
      return gustMean;
    },
    get dir() {
      return dir;
    },
    get time() {
      return time;
    },
    setBreeze(b) {
      breeze = b;
    },
  };
}
