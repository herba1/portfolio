export const N = 24;
export const K = 48;
export const PRINT_W = 1.5;
export const PRINT_H = 1;
export const INNER = 0.16;
export const EXIT_Y = -0.16;
export const FLOOR_Y = -1.1;
export const SEG = PRINT_H / (K - 1);
export const PITCH = PRINT_W / N;
export const L_MAX = PRINT_H + INNER;
export const L_REST = 0.7;
export const L_BITE = 0.035;
export const V_FEED = 0.2;

const SPLAY = 0.035;
const GRAVITY = 5.2;
const ITER = 6;
const DAMP = 0.986;
const BEND = 0.75;
const FUSE_RATE = 7;
const THICK = 0.0035;
const TAU = Math.PI * 2;

const tOf = (k) => k / (K - 1);
const len3 = (x, y, z) => Math.sqrt(x * x + y * y + z * z);
const smooth = (x) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function stripX(i, comb) {
  return ((i + 0.5) / N - 0.5) * PRINT_W * (1 + SPLAY * (1 - comb));
}

export function createSim(seed) {
  const pos = new Float32Array(N * K * 3);
  const prev = new Float32Array(N * K * 3);
  const nrm = new Float32Array(N * K * 3);
  const tan = new Float32Array(N * K * 3);
  const tw = new Float32Array(N * K);
  const twv = new Float32Array(N * K);
  const fuse = new Float32Array(N * K);
  const comb = new Float32Array(N);
  const err = new Float32Array(N);
  const pins = new Float32Array(N * 3);
  const strips = [];
  const state = { L: L_REST, tExit: 0, E: 0, air: 0, time: 0, motorV: 0, shake: [0, 0, 0], calm: 0, fusing: false, fusedCount: 0, allFused: false, reduced: false };

  function reseed(s) {
    const rnd = mulberry(s);
    strips.length = 0;
    for (let i = 0; i < N; i += 1) {
      const sign = rnd() < 0.62 ? 1 : -1;
      strips.push({
        curl: sign * (5 + rnd() * rnd() * 20),
        twist: (rnd() < 0.5 ? -1 : 1) * (rnd() < 0.62 ? 0.15 + rnd() * 0.8 : 1.4 + rnd() * 2),
        leanX: (rnd() - 0.5) * 0.12,
        leanZ: (rnd() - 0.3) * 0.5,
        ph: rnd() * TAU,
        ph2: rnd() * TAU,
        gain: 0.6 + rnd() * 0.8,
        grip: 0.7 + rnd() * 0.6,
      });
    }
  }

  function reset(L) {
    pos.fill(0);
    prev.fill(0);
    tw.fill(0);
    twv.fill(0);
    fuse.fill(0);
    comb.fill(0);
    err.fill(0);
    state.L = L;
    state.E = 0;
    state.air = 0;
    state.motorV = 0;
    state.fusedCount = 0;
    state.allFused = false;
    updateExit(0);
  }

  function pinOf(i) {
    const o = i * 3;
    pins[o] = stripX(i, comb[i]) + state.shake[0];
    pins[o + 1] = EXIT_Y + state.shake[1];
    pins[o + 2] = state.shake[2];
  }

  function updateExit(dt) {
    state.tExit = (state.L - INNER) / PRINT_H;
    let E = 0;
    while (E < K && tOf(E) < state.tExit - 1e-5) E += 1;
    for (let i = 0; i < N; i += 1) pinOf(i);
    if (E > state.E) {
      for (let k = state.E; k < E; k += 1) {
        for (let i = 0; i < N; i += 1) {
          const o = (i * K + k) * 3;
          const s = (state.tExit - tOf(k)) * PRINT_H;
          pos[o] = pins[i * 3];
          pos[o + 1] = pins[i * 3 + 1] - s;
          pos[o + 2] = pins[i * 3 + 2];
          prev[o] = pos[o];
          prev[o + 1] = pos[o + 1] + Math.max(0, state.motorV) * dt;
          prev[o + 2] = pos[o + 2];
          tw[i * K + k] = 0;
          twv[i * K + k] = 0;
          nrm[o] = 0;
          nrm[o + 1] = 0;
          nrm[o + 2] = 1;
        }
      }
    }
    state.E = E;
  }

  const target = (i, k, out) => {
    const s = (state.tExit - tOf(k)) * PRINT_H;
    const x = stripX(i, Math.max(comb[i], fuse[i * K + k]));
    let y = pins[i * 3 + 1] - s;
    let z = pins[i * 3 + 2];
    const floor = FLOOR_Y + THICK;
    if (y < floor) {
      z += floor - y;
      y = floor;
    }
    out[0] = x;
    out[1] = y;
    out[2] = z;
    return out;
  };

  function frames() {
    const E = state.E;
    for (let i = 0; i < N; i += 1) {
      let rx = 0;
      let ry = 0;
      let rz = 1;
      let ux = pins[i * 3];
      let uy = pins[i * 3 + 1];
      let uz = pins[i * 3 + 2];
      for (let k = E - 1; k >= 0; k -= 1) {
        const o = (i * K + k) * 3;
        const lo = k > 0 ? o - 3 : o;
        let tx = pos[lo] - ux;
        let ty = pos[lo + 1] - uy;
        let tz = pos[lo + 2] - uz;
        const len = len3(tx, ty, tz) || 1;
        tx /= len;
        ty /= len;
        tz /= len;
        const d = rx * tx + ry * ty + rz * tz;
        rx -= tx * d;
        ry -= ty * d;
        rz -= tz * d;
        const rl = len3(rx, ry, rz) || 1;
        rx /= rl;
        ry /= rl;
        rz /= rl;
        const phi = tw[i * K + k];
        const c = Math.cos(phi);
        const s = Math.sin(phi);
        const bx = ty * rz - tz * ry;
        const by = tz * rx - tx * rz;
        const bz = tx * ry - ty * rx;
        nrm[o] = rx * c + bx * s;
        nrm[o + 1] = ry * c + by * s;
        nrm[o + 2] = rz * c + bz * s;
        tan[o] = tx;
        tan[o + 1] = ty;
        tan[o + 2] = tz;
        ux = pos[o];
        uy = pos[o + 1];
        uz = pos[o + 2];
      }
    }
  }

  const lock = new Float32Array(N * K);
  const lockOf = (i, k) => lock[i * K + k];
  const refreshLock = () => {
    for (let j = 0; j < N * K; j += 1) lock[j] = fuse[j] > 0 ? smooth(fuse[j]) : 0;
  };

  const tmp = [0, 0, 0];

  function distance(i, k, ax, ay, az, aw, rest) {
    const o = (i * K + k) * 3;
    const bw = 1 - lockOf(i, k);
    const wsum = aw + bw;
    if (wsum < 1e-4) return false;
    const dx = pos[o] - ax;
    const dy = pos[o + 1] - ay;
    const dz = pos[o + 2] - az;
    const len = len3(dx, dy, dz);
    if (len < 1e-7) return false;
    const diff = (len - rest) / len / wsum;
    pos[o] -= dx * diff * bw;
    pos[o + 1] -= dy * diff * bw;
    pos[o + 2] -= dz * diff * bw;
    tmp[0] = dx * diff * aw;
    tmp[1] = dy * diff * aw;
    tmp[2] = dz * diff * aw;
    return true;
  }

  function constrain() {
    const E = state.E;
    if (!E) return;
    for (let it = 0; it < ITER; it += 1) {
      for (let i = 0; i < N; i += 1) {
        const st = strips[i];
        const px = pins[i * 3];
        const py = pins[i * 3 + 1];
        const pz = pins[i * 3 + 2];
        const top = (state.tExit - tOf(E - 1)) * PRINT_H;
        distance(i, E - 1, px, py, pz, 0, top);
        for (let k = E - 2; k >= 0; k -= 1) {
          const a = (i * K + k + 1) * 3;
          const aw = 1 - lockOf(i, k + 1);
          if (distance(i, k, pos[a], pos[a + 1], pos[a + 2], aw, SEG)) {
            pos[a] += tmp[0];
            pos[a + 1] += tmp[1];
            pos[a + 2] += tmp[2];
          }
        }
        const c = comb[i];
        const relax = 1 - c;
        const sag = SEG * Math.sin((st.curl * relax * SEG) / 2);
        {
          const o = (i * K + E - 1) * 3;
          const w = 1 - lockOf(i, E - 1);
          if (w > 0) {
            const dx = st.leanX * relax;
            const dz = st.leanZ * relax;
            const l = len3(dx, 1, dz);
            const want = top;
            const kx = px + (dx / l) * want;
            const ky = py - (1 / l) * want;
            const kz = pz + (dz / l) * want;
            pos[o] += (kx - pos[o]) * BEND * 0.6 * w;
            pos[o + 1] += (ky - pos[o + 1]) * BEND * 0.6 * w;
            pos[o + 2] += (kz - pos[o + 2]) * BEND * 0.6 * w;
          }
        }
        for (let k = E - 1; k >= 1; k -= 1) {
          const m = (i * K + k) * 3;
          const l = (i * K + k - 1) * 3;
          let ux;
          let uy;
          let uz;
          let wu;
          if (k === E - 1) {
            ux = px;
            uy = py;
            uz = pz;
            wu = 0;
          } else {
            const u = (i * K + k + 1) * 3;
            ux = pos[u];
            uy = pos[u + 1];
            uz = pos[u + 2];
            wu = 1 - lockOf(i, k + 1);
          }
          const wl = 1 - lockOf(i, k - 1);
          if (wl + wu < 1e-4) continue;
          let ex = pos[l] - ux;
          let ey = pos[l + 1] - uy;
          let ez = pos[l + 2] - uz;
          const el = len3(ex, ey, ez);
          if (el < 1e-6) continue;
          ex /= el;
          ey /= el;
          ez /= el;
          const nx = nrm[m];
          const ny = nrm[m + 1];
          const nz = nrm[m + 2];
          const dn = nx * ex + ny * ey + nz * ez;
          let qx = nx - ex * dn;
          let qy = ny - ey * dn;
          let qz = nz - ez * dn;
          const ql = len3(qx, qy, qz);
          if (ql < 1e-4) continue;
          qx /= ql;
          qy /= ql;
          qz /= ql;
          const cx = pos[m] - (ux + pos[l]) * 0.5 + qx * sag;
          const cy = pos[m + 1] - (uy + pos[l + 1]) * 0.5 + qy * sag;
          const cz = pos[m + 2] - (uz + pos[l + 2]) * 0.5 + qz * sag;
          const wm = 1 - lockOf(i, k);
          const W = wm + (wu + wl) * 0.25;
          if (W < 1e-4) continue;
          const lam = BEND / W;
          pos[m] -= cx * lam * wm;
          pos[m + 1] -= cy * lam * wm;
          pos[m + 2] -= cz * lam * wm;
          pos[l] += cx * lam * wl * 0.5;
          pos[l + 1] += cy * lam * wl * 0.5;
          pos[l + 2] += cz * lam * wl * 0.5;
          if (wu > 0) {
            const u = (i * K + k + 1) * 3;
            pos[u] += cx * lam * wu * 0.5;
            pos[u + 1] += cy * lam * wu * 0.5;
            pos[u + 2] += cz * lam * wu * 0.5;
          }
        }
      }
      collide();
    }
  }

  function collide() {
    const E = state.E;
    const floor = FLOOR_Y + THICK;
    const roof = EXIT_Y - 0.006;
    for (let i = 0; i < N; i += 1) {
      for (let k = 0; k < E; k += 1) {
        const o = (i * K + k) * 3;
        if (pos[o + 1] < floor) {
          pos[o + 1] = floor;
          prev[o] += (pos[o] - prev[o]) * 0.35;
          prev[o + 2] += (pos[o + 2] - prev[o + 2]) * 0.35;
        }
        if (pos[o + 1] > roof && Math.abs(pos[o + 2]) < 0.2 && Math.abs(pos[o]) < 0.98) pos[o + 1] = roof;
      }
    }
  }

  function step(dt, motorV) {
    state.time += dt;
    state.motorV = motorV;
    state.L = Math.min(L_MAX, Math.max(0, state.L + motorV * dt));
    updateExit(dt);
    const wantAir = state.reduced ? 0 : Math.min(1, Math.abs(motorV) / V_FEED);
    state.air += (wantAir - state.air) * (1 - Math.exp(-dt / (wantAir > state.air ? 0.25 : 0.9)));
    const E = state.E;
    if (!E) return 0;
    frames();
    refreshLock();
    const g = GRAVITY * dt * dt;
    const time = state.time;
    const air = state.air;
    let motion = 0;
    for (let i = 0; i < N; i += 1) {
      const st = strips[i];
      for (let k = 0; k < E; k += 1) {
        const o = (i * K + k) * 3;
        const lock = lockOf(i, k);
        if (lock >= 0.999) continue;
        let vx = pos[o] - prev[o];
        let vy = pos[o + 1] - prev[o + 1];
        let vz = pos[o + 2] - prev[o + 2];
        const nx = nrm[o];
        const ny = nrm[o + 1];
        const nz = nrm[o + 2];
        const vn = vx * nx + vy * ny + vz * nz;
        vx -= nx * vn * 0.14;
        vy -= ny * vn * 0.14;
        vz -= nz * vn * 0.14;
        vx *= DAMP;
        vy *= DAMP;
        vz *= DAMP;
        prev[o] = pos[o];
        prev[o + 1] = pos[o + 1];
        prev[o + 2] = pos[o + 2];
        const reach = (state.tExit - tOf(k)) / Math.max(0.05, state.tExit);
        let fz = 0;
        let fx = 0;
        if (air > 0.001) {
          const tip = reach * reach * st.gain;
          fz = air * tip * 1.6 * (Math.sin(time * 1.9 + st.ph + k * 0.23) * 0.6 + Math.sin(time * 3.1 + st.ph2 + k * 0.11) * 0.4);
          fx = air * tip * 0.35 * Math.sin(time * 1.3 + st.ph2 + k * 0.17);
        }
        pos[o] += vx + fx * dt * dt;
        pos[o + 1] += vy - g;
        pos[o + 2] += vz + fz * dt * dt;
        motion = Math.max(motion, Math.abs(vx) + Math.abs(vy) + Math.abs(vz));
      }
    }
    constrain();
    const t3 = [0, 0, 0];
    for (let i = 0; i < N; i += 1) {
      const st = strips[i];
      const c = comb[i];
      const pull = 1 - Math.exp(-16 * c * c * c * dt);
      let e = 0;
      for (let k = 0; k < E; k += 1) {
        const o = (i * K + k) * 3;
        target(i, k, t3);
        e += len3(pos[o] - t3[0], pos[o + 1] - t3[1], pos[o + 2] - t3[2]);
        if (c > 0.001) {
          pos[o] += (t3[0] - pos[o]) * pull;
          pos[o + 1] += (t3[1] - pos[o + 1]) * pull;
          pos[o + 2] += (t3[2] - pos[o + 2]) * pull;
        }
        const lock = lockOf(i, k);
        if (lock > 0) {
          pos[o] += (t3[0] - pos[o]) * lock;
          pos[o + 1] += (t3[1] - pos[o + 1]) * lock;
          pos[o + 2] += (t3[2] - pos[o + 2]) * lock;
          prev[o] += (pos[o] - prev[o]) * lock;
          prev[o + 1] += (pos[o + 1] + motorV * dt - prev[o + 1]) * lock;
          prev[o + 2] += (pos[o + 2] - prev[o + 2]) * lock;
        }
        const ti = i * K + k;
        const s = (state.tExit - tOf(k)) * PRINT_H;
        const reach = (state.tExit - tOf(k)) / Math.max(0.05, state.tExit);
        const flutter = air * 0.5 * reach * Math.sin(time * 1.4 + st.ph + k * 0.19);
        const rest = (st.twist * s * (1 - c) + flutter) * (1 - lock);
        const up = k < E - 1 ? tw[ti + 1] : 0;
        const down = k > 0 ? tw[ti - 1] : tw[ti];
        const acc = 34 * (rest - tw[ti]) + 120 * (up + down - 2 * tw[ti]) - 7 * twv[ti];
        twv[ti] += acc * dt;
        tw[ti] += twv[ti] * dt;
        motion = Math.max(motion, Math.abs(twv[ti]) * dt * 0.02);
      }
      err[i] = E ? e / E : 0;
    }
    fuseStep(dt);
    return motion;
  }

  function fuseStep(dt) {
    const E = state.E;
    let fusing = false;
    let fused = 0;
    let all = E > 0;
    const aligned = (i) => i >= 0 && i < N && comb[i] > 0.84 && err[i] < 0.03;
    for (let i = 0; i < N; i += 1) {
      const ok = aligned(i) && (aligned(i - 1) || aligned(i + 1));
      let whole = E > 0;
      for (let k = E - 1; k >= 0; k -= 1) {
        const ti = i * K + k;
        if (ok && fuse[ti] < 1 && (k === E - 1 || fuse[ti + 1] > 0.3)) {
          fuse[ti] = Math.min(1, fuse[ti] + dt * FUSE_RATE);
          fusing = true;
        }
        if (fuse[ti] < 0.999) whole = false;
      }
      if (ok) comb[i] = Math.min(1, comb[i] + dt * 0.5);
      if (whole) fused += 1;
      else all = false;
    }
    state.fusing = fusing;
    state.fusedCount = fused;
    state.allFused = all;
  }

  function addComb(i, amount) {
    comb[i] = Math.min(1, comb[i] + amount * strips[i].grip);
  }

  function nudge(i, k, dx, dy, dz) {
    const o = (i * K + k) * 3;
    const w = 1 - lockOf(i, k);
    pos[o] += dx * w;
    pos[o + 1] += dy * w;
    pos[o + 2] += dz * w;
    prev[o] += dx * w * 0.65;
    prev[o + 1] += dy * w * 0.65;
    prev[o + 2] += dz * w * 0.65;
  }

  reseed(seed);
  reset(L_REST);

  return { pos, nrm, tan, tw, fuse, comb, err, pins, state, strips, step, reset, reseed, frames, addComb, nudge, updateExit, tOf };
}
