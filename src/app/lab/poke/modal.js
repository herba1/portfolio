// The tree's measured modes as a dynamical system.
//
// Each mode i has a complex shape phi_i(x) (a 2D displacement field over the
// photograph, plate px per unit coordinate), a frequency f_i and a damping
// ratio zeta_i, all measured from the clip (tools/depth/bakes/poke). Its
// coordinate q_i is complex: the real and imaginary parts are two unit-mass
// oscillators, so the displacement of the picture is
//
//   D(x) = sum_i Re(phi_i(x) q_i)
//
// and a real force F at a material point m drives mode i with the projection
// f_i = phi_i(m)^H F (Davis, Chen and Durand 2015, section 5).
//
// The hand is a stiff spring with a dashpot from the grabbed material point to
// the pointer. It is closed-loop, so the point under the finger follows it
// almost 1:1 while every other part of the tree responds through the modes
// with its own lag; the spring is stiff only along the directions the point
// can actually move in (it is scaled by the point's compliance). On release
// the spring is gone and each mode rings down at its own measured frequency
// and damping.

const TAU = Math.PI * 2;

export function createModal(meta, layers) {
  const K = meta.modes.length;
  const [gw, gh] = meta.grid;
  const [PW, PH] = meta.plate;
  const cell = PW / gw;
  const omega = meta.modes.map((m) => TAU * m.f);
  const zeta = meta.modes.map((m) => m.zeta);
  const scale = meta.modes.map((m) => m.scale);
  // decoded shapes: K x (gw*gh*4), plate px per unit coordinate
  const shapes = layers.map((bytes, i) => {
    const out = new Float32Array(gw * gh * 4);
    const s = scale[i] / 127.5;
    for (let j = 0; j < out.length; j++) out[j] = (bytes[j] - 127.5) * s;
    return out;
  });

  // bilinear sample of every mode at plate (x, y) -> Float64Array(K*4)
  const at = (x, y, out = new Float64Array(K * 4)) => {
    const gx = Math.min(gw - 1.001, Math.max(0, x / cell - 0.5));
    const gy = Math.min(gh - 1.001, Math.max(0, y / cell - 0.5));
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const fx = gx - x0;
    const fy = gy - y0;
    const w00 = (1 - fx) * (1 - fy);
    const w10 = fx * (1 - fy);
    const w01 = (1 - fx) * fy;
    const w11 = fx * fy;
    const i00 = (y0 * gw + x0) * 4;
    const i10 = i00 + 4;
    const i01 = i00 + gw * 4;
    const i11 = i01 + 4;
    for (let i = 0; i < K; i++) {
      const s = shapes[i];
      for (let c = 0; c < 4; c++) out[i * 4 + c] = s[i00 + c] * w00 + s[i10 + c] * w10 + s[i01 + c] * w01 + s[i11 + c] * w11;
    }
    return out;
  };

  // state: q (re, im) and its velocity, per mode
  const q = new Float64Array(K * 2);
  const v = new Float64Array(K * 2);
  const breeze = new Float64Array(K * 2);

  // displacement of a point with sampled shapes a, for coordinates c (q or v)
  const disp = (a, c) => {
    let dx = 0;
    let dy = 0;
    for (let i = 0; i < K; i++) {
      const qr = c[i * 2];
      const qi = c[i * 2 + 1];
      dx += a[i * 4] * qr - a[i * 4 + 2] * qi;
      dy += a[i * 4 + 1] * qr - a[i * 4 + 3] * qi;
    }
    return [dx, dy];
  };
  const tmpA = new Float64Array(K * 4);
  const displacementAt = (x, y) => disp(at(x, y, tmpA), q);
  // where the material now drawn at plate p came from (two fixed-point steps,
  // the same inverse the shader takes)
  const sourceOf = (x, y) => {
    let [dx, dy] = displacementAt(x, y);
    [dx, dy] = displacementAt(x - dx, y - dy);
    return [x - dx, y - dy];
  };

  // 2x2 compliance (static displacement per unit force) and inverse mass at a point
  const pointMatrices = (a) => {
    let g00 = 0, g01 = 0, g11 = 0, m00 = 0, m01 = 0, m11 = 0;
    for (let i = 0; i < K; i++) {
      const rx = a[i * 4], ry = a[i * 4 + 1], ix = a[i * 4 + 2], iy = a[i * 4 + 3];
      const s00 = rx * rx + ix * ix;
      const s01 = rx * ry + ix * iy;
      const s11 = ry * ry + iy * iy;
      const w2 = omega[i] * omega[i];
      g00 += s00 / w2; g01 += s01 / w2; g11 += s11 / w2;
      m00 += s00; m01 += s01; m11 += s11;
    }
    const lmax = (a00, a01, a11) => 0.5 * (a00 + a11) + Math.sqrt(0.25 * (a00 - a11) ** 2 + a01 * a01);
    return { g: [g00, g01, g11], gmax: lmax(g00, g01, g11), mmax: lmax(m00, m01, m11) };
  };

  // compliance over the whole picture, for the cursor and the grab threshold
  const compliance = new Float32Array(gw * gh);
  {
    const a = new Float64Array(K * 4);
    for (let y = 0; y < gh; y++)
      for (let x = 0; x < gw; x++) {
        const o = (y * gw + x) * 4;
        for (let i = 0; i < K; i++) for (let c = 0; c < 4; c++) a[i * 4 + c] = shapes[i][o + c];
        compliance[y * gw + x] = pointMatrices(a).gmax;
      }
  }
  const sorted = Float32Array.from(compliance).sort();
  const cRef = sorted[Math.floor(sorted.length * 0.995)];
  const complianceAt = (x, y) => {
    const gx = Math.round(Math.min(gw - 1, Math.max(0, x / cell - 0.5)));
    const gy = Math.round(Math.min(gh - 1, Math.max(0, y / cell - 0.5)));
    return compliance[gy * gw + gx] / cRef;
  };

  // --- the hand ---
  let hand = null; // { a, k, c, tx, ty }
  // The hand: a spring of KH times the spot's own stiffness (so the grabbed
  // point travels about KH / (1 + KH) of the way), and a dashpot that damps
  // the hand mode at 0.85. Also returns how far the hand may pull before the
  // most-moved part of the picture would pass dmax: the static response of
  // every cell to the hand, D(x) = G(x, m) S d with S = k (I + k G(m, m))^-1.
  const grab = (x, y, { kh = 3, dmax = 70 } = {}) => {
    const [mx, my] = sourceOf(x, y);
    const a = at(mx, my);
    const { g, gmax, mmax } = pointMatrices(a);
    const k = kh / Math.max(gmax, 1e-9);
    const wh = Math.sqrt(k * mmax);
    const c = (2 * 0.85 * wh) / Math.max(mmax, 1e-9);
    // S = k (I + k G)^-1
    const a00 = 1 + k * g[0], a01 = k * g[1], a11 = 1 + k * g[2];
    const det = a00 * a11 - a01 * a01;
    const S = [(k * a11) / det, (-k * a01) / det, (k * a00) / det];
    // complex shapes at m, divided by omega^2 (the static response per force)
    let amp = 0;
    for (let yy = 0; yy < gh; yy += 2)
      for (let xx = 0; xx < gw; xx += 2) {
        const o = (yy * gw + xx) * 4;
        // G(x, m) = sum Re(phi(x) phi(m)^H) / w^2
        let g00 = 0, g01 = 0, g10 = 0, g11 = 0;
        for (let i = 0; i < K; i++) {
          const sh = shapes[i];
          const w2 = omega[i] * omega[i];
          const xr = sh[o], yr = sh[o + 1], xi = sh[o + 2], yi = sh[o + 3];
          const mr = a[i * 4], nr = a[i * 4 + 1], mi = a[i * 4 + 2], ni = a[i * 4 + 3];
          g00 += (xr * mr + xi * mi) / w2;
          g01 += (xr * nr + xi * ni) / w2;
          g10 += (yr * mr + yi * mi) / w2;
          g11 += (yr * nr + yi * ni) / w2;
        }
        // R = G(x, m) S; its largest singular value
        const r00 = g00 * S[0] + g01 * S[1], r01 = g00 * S[1] + g01 * S[2];
        const r10 = g10 * S[0] + g11 * S[1], r11 = g10 * S[1] + g11 * S[2];
        const fro = r00 * r00 + r01 * r01 + r10 * r10 + r11 * r11;
        const dt = r00 * r11 - r01 * r10;
        const sv = Math.sqrt(0.5 * (fro + Math.sqrt(Math.max(0, fro * fro - 4 * dt * dt))));
        if (sv > amp) amp = sv;
      }
    const [dx, dy] = disp(a, q);
    hand = { a, k, c, wh, tx: dx, ty: dy, mx, my, rel: Math.sqrt(gmax / cRef), reach: dmax / Math.max(amp, 1e-6), amp };
    return hand;
  };
  const setTarget = (tx, ty) => {
    if (!hand) return;
    hand.tx = tx;
    hand.ty = ty;
  };
  const release = () => {
    hand = null;
  };

  // --- dynamics ---
  const f = new Float64Array(K * 2);
  const step = (dt, { breezeAmp = 0, breezeTau = 1.6, rand = Math.random } = {}) => {
    // the breeze: per-mode Ornstein-Uhlenbeck forcing, stepped once per frame
    if (breezeAmp > 0) {
      const a = Math.exp(-dt / breezeTau);
      const b = Math.sqrt(1 - a * a);
      for (let j = 0; j < K * 2; j++) {
        const g = Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(TAU * rand());
        breeze[j] = breeze[j] * a + g * b;
      }
    }
    const wmax = Math.max(omega[omega.length - 1], hand ? hand.wh : 0);
    const n = Math.min(96, Math.max(2, Math.ceil((dt * wmax) / 0.25)));
    const h = dt / n;
    for (let s = 0; s < n; s++) {
      f.fill(0);
      if (hand) {
        const [dx, dy] = disp(hand.a, q);
        const [vx, vy] = disp(hand.a, v);
        const Fx = hand.k * (hand.tx - dx) - hand.c * vx;
        const Fy = hand.k * (hand.ty - dy) - hand.c * vy;
        const a = hand.a;
        for (let i = 0; i < K; i++) {
          f[i * 2] = a[i * 4] * Fx + a[i * 4 + 1] * Fy;
          f[i * 2 + 1] = -(a[i * 4 + 2] * Fx + a[i * 4 + 3] * Fy);
        }
      }
      for (let i = 0; i < K; i++) {
        const w = omega[i];
        const z = zeta[i];
        for (let r = 0; r < 2; r++) {
          const j = i * 2 + r;
          const fb = breezeAmp * w * w * breeze[j];
          v[j] += h * (f[j] + fb - w * w * q[j] - 2 * z * w * v[j]);
          q[j] += h * v[j];
        }
      }
    }
  };

  const energy = () => {
    let e = 0;
    for (let i = 0; i < K; i++) {
      const w2 = omega[i] * omega[i];
      for (let r = 0; r < 2; r++) e += v[i * 2 + r] ** 2 + w2 * q[i * 2 + r] ** 2;
    }
    return e;
  };

  // largest displacement any mode could still make, in plate px (position
  // and the amplitude its velocity carries); below a hair it is at rest
  const restless = () => {
    let e = 0;
    for (let i = 0; i < K; i++) {
      const w = omega[i];
      for (let r = 0; r < 2; r++) e += (scale[i] * q[i * 2 + r]) ** 2 + ((scale[i] * v[i * 2 + r]) / w) ** 2;
    }
    return Math.sqrt(e);
  };

  const reset = () => {
    q.fill(0);
    v.fill(0);
    breeze.fill(0);
    hand = null;
  };

  return {
    K,
    gw,
    gh,
    plate: [PW, PH],
    omega,
    zeta,
    scale,
    q,
    v,
    at,
    disp,
    displacementAt,
    sourceOf,
    complianceAt,
    grab,
    setTarget,
    release,
    step,
    energy,
    restless,
    reset,
    get hand() {
      return hand;
    },
  };
}
