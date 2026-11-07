// Cloth for Sentaku: every garment cut out of the photograph is a sheet of
// position-based cloth (XPBD, "small steps": many substeps, one projection
// each, Macklin et al. 2019), hanging from the clothesline by its pegs.
//
// One world, metres: X along the line, Y up, Z level and away from the camera
// (the camera is below the line, looking up past it). A vertex's rest place
// is its pixel in the photograph read as X = u / PX, Y = -v / PX, Z = 0: the
// garments hang in the line's vertical plane. Drawing maps a vertex's
// displacement from that rest back onto the photograph (project()), so with
// no wind the frame is the photograph to the pixel.
//
// The photograph is the equilibrium: there weight and tension balance, and
// away from it weight pulls each vertex back as it would a pendulum the
// length of the cloth's hang below its pegs (g / hang per metre). Without
// that, a drape read off a flat photograph is in compression and buckles.
//
// Forces: that restoring weight, and the wind as a pressure on each triangle, the
// normal component of the relative air speed squared (0.5 rho Cd A (v.n)|v.n|),
// plus a little skin friction along it. That alone makes cloth billow,
// flutter and lift toward the angle where the push and its weight balance.
//
// The line is not rigid. Its sag plane swings about the chord like a
// pendulum, toward atan(lateral load / weight), and sags a little deeper
// under the wind's downward share; a second, antisymmetric mode lets the
// two halves disagree. The pegged vertices ride on it.

export const PX = 700; // image px per metre, across and down the hanging plane
const SZ = 300; // image px per metre of Z: level motion away from the camera reads as down
const CZ = 0.8; // depth change per metre of Z ...
const CY = 0.45; // ... and of Y (the camera looks up, so up is further)
const DIST = 3.0; // metres from the lens to the line
const G = 9.81;
const RHO = 1.2;
const CD = 1.15;
const CT = 0.04;
const SUB = 10; // substeps per 1/60 s
const PHANTOM = 4; // cells simulated past the frame edge
const BEND = 4e-5; // compliance across two cells
const BEND4 = 4e-4; // and across four

export const ROPE = { left: -320, right: 1760, sag: 0.11 };

export function project(u0, v0, dx, dy, dz, cu, cv, out, o) {
  const u1 = u0 + PX * dx;
  const v1 = v0 - PX * dy + SZ * dz;
  const depth = Math.max(-0.3 * DIST, CZ * dz + CY * dy);
  const k = DIST / (DIST + depth);
  out[o] = cu + (u1 - cu) * k;
  out[o + 1] = cv + (v1 - cv) * k;
}

export function createCloth(meta, { density = 0.32 } = {}) {
  const { cell: CELL, rope } = meta;
  const ropeY = (u) => rope.poly[0] * u * u + rope.poly[1] * u + rope.poly[2];
  const garments = [];
  let nv = 0;
  // count first so all garments share flat arrays
  const plans = meta.garments.map((g) => {
    // A garment the frame cuts off goes on past it: its unseen part is
    // simulated too (and never drawn), or the visible strip would flap like
    // a ribbon. The phantom cells copy the last full column at that edge.
    const IW = meta.size[0];
    const [bx0, gy0, nx0, ny] = g.grid;
    const padL = bx0 <= 0 ? PHANTOM : 0;
    const padR = bx0 + nx0 * CELL >= IW - 1 ? PHANTOM : 0;
    const nx = nx0 + padL + padR;
    const gx0 = bx0 - padL * CELL;
    const cov = new Float32Array(nx * ny);
    const act = new Uint8Array(nx * ny);
    const read = (i, j) => {
      const ch = g.cov[j][i];
      return ch === "." ? 0 : Math.max(0.02, (ch.charCodeAt(0) - 48) / 74);
    };
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const i0 = i - padL;
        let c;
        if (i0 < 0) c = read(0, j) > 0 ? read(Math.min(1, nx0 - 1), j) : 0;
        else if (i0 >= nx0) c = read(nx0 - 1, j) > 0 ? read(Math.max(0, nx0 - 2), j) : 0;
        else c = read(i0, j);
        if (c <= 0) continue;
        act[j * nx + i] = 1;
        cov[j * nx + i] = c;
      }
    }
    const vid = new Int32Array((nx + 1) * (ny + 1)).fill(-1);
    for (let j = 0; j <= ny; j++)
      for (let i = 0; i <= nx; i++) {
        const c = (a, b) => a >= 0 && b >= 0 && a < nx && b < ny && act[b * nx + a];
        if (c(i - 1, j - 1) || c(i, j - 1) || c(i - 1, j) || c(i, j)) vid[j * (nx + 1) + i] = nv++;
      }
    return { g, gx0, gy0, nx, ny, cov, act, vid };
  });

  const N = nv;
  const rest = new Float32Array(N * 2); // image px
  const x = new Float32Array(N * 3);
  const p = new Float32Array(N * 3);
  const v = new Float32Array(N * 3);
  const x0 = new Float32Array(N * 3); // settled reference
  const w = new Float32Array(N); // inverse mass
  const mass = new Float32Array(N);
  const pinS = new Float32Array(N).fill(-1); // rope parameter of a pegged vertex
  const nrm = new Float32Array(N * 3);
  const nrm0 = new Float32Array(N * 3);
  const gid = new Uint8Array(N);
  const cons = []; // [a, b, rest, compliance]
  const tris = []; // [a, b, c, area * coverage]

  for (const pl of plans) {
    const { g, gx0, gy0, nx, ny, cov, act, vid } = pl;
    // pom-poms are wool balls, not sheets: heavy, and a sphere's drag is a
    // fraction of a flat panel's, so they swing on their cords and do not tilt
    const pom = g.name === "pom";
    const dens = density * (pom ? 7 : 1);
    const sail = pom ? 0.2 : 1;
    const at = (i, j) => (i < 0 || j < 0 || i > nx || j > ny ? -1 : vid[j * (nx + 1) + i]);
    for (let j = 0; j <= ny; j++)
      for (let i = 0; i <= nx; i++) {
        const k = at(i, j);
        if (k < 0) continue;
        const u = gx0 + i * CELL;
        const vv = gy0 + j * CELL;
        rest[k * 2] = u;
        rest[k * 2 + 1] = vv;
        x[k * 3] = u / PX;
        x[k * 3 + 1] = -vv / PX;
        x[k * 3 + 2] = 0;
        gid[k] = g.id;
      }
    const cellArea = (CELL / PX) ** 2;
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        if (!act[j * nx + i]) continue;
        const c = Math.max(0.02, cov[j * nx + i]);
        const a = at(i, j), b = at(i + 1, j), cc = at(i, j + 1), d = at(i + 1, j + 1);
        const m4 = (dens * cellArea * Math.max(0.3, c)) / 4;
        mass[a] += m4; mass[b] += m4; mass[cc] += m4; mass[d] += m4;
        // alternate the diagonal so the sheet has no grain
        if ((i + j) & 1) {
          tris.push([a, b, d, (cellArea / 2) * c * sail], [a, d, cc, (cellArea / 2) * c * sail]);
        } else {
          tris.push([a, b, cc, (cellArea / 2) * c * sail], [b, d, cc, (cellArea / 2) * c * sail]);
        }
      }
    const len = (a, b) => Math.hypot(x[a * 3] - x[b * 3], x[a * 3 + 1] - x[b * 3 + 1]);
    const add = (a, b, comp) => {
      if (a >= 0 && b >= 0) cons.push([a, b, len(a, b), comp]);
    };
    const cellOn = (i, j) => i >= 0 && j >= 0 && i < nx && j < ny && act[j * nx + i];
    for (let j = 0; j <= ny; j++)
      for (let i = 0; i <= nx; i++) {
        // stretch: the edges of active cells, nearly inextensible
        if (cellOn(i, j) || cellOn(i, j - 1)) add(at(i, j), at(i + 1, j), 2e-7);
        if (cellOn(i, j) || cellOn(i - 1, j)) add(at(i, j), at(i, j + 1), 2e-7);
        // shear: both diagonals
        if (cellOn(i, j)) {
          add(at(i, j), at(i + 1, j + 1), 4e-6);
          add(at(i + 1, j), at(i, j + 1), 4e-6);
        }
        // bending: across two cells, soft, so it folds rather than creases
        if (cellOn(i, j) && cellOn(i + 1, j)) add(at(i, j), at(i + 2, j), BEND);
        if (cellOn(i, j) && cellOn(i, j + 1)) add(at(i, j), at(i, j + 2), BEND);
        // and across four, so folds come at the scale of fabric, not of the grid
        if (cellOn(i, j) && cellOn(i + 1, j) && cellOn(i + 2, j) && cellOn(i + 3, j)) add(at(i, j), at(i + 4, j), BEND4);
        if (cellOn(i, j) && cellOn(i, j + 1) && cellOn(i, j + 2) && cellOn(i, j + 3)) add(at(i, j), at(i, j + 4), BEND4);
      }
    // pegs: the vertices of the cloth's top band that touch the line
    let pinned = 0;
    for (let j = 0; j <= ny; j++)
      for (let i = 0; i <= nx; i++) {
        const k = at(i, j);
        if (k < 0) continue;
        const u = rest[k * 2];
        const dv = rest[k * 2 + 1] - ropeY(u);
        if (dv > -CELL * 0.9 && dv < CELL * 0.75 && u > -40 - PHANTOM * CELL && u < meta.size[0] + 40 + PHANTOM * CELL) {
          // only where the cut-out itself reaches the line (a filled cell either side)
          const ci = Math.min(nx - 1, i), cj = Math.min(ny - 1, j);
          const near = [cellOn(ci, cj), cellOn(ci - 1, cj), cellOn(ci, cj - 1), cellOn(ci - 1, cj - 1)];
          const ok = near.some(Boolean) && Math.max(...[[ci, cj], [ci - 1, cj], [ci, cj - 1], [ci - 1, cj - 1]].map(([a, b]) => (cellOn(a, b) ? cov[b * nx + a] : 0))) > 0.25;
          if (ok) {
            pinS[k] = (u - ROPE.left) / (ROPE.right - ROPE.left);
            pinned++;
          }
        }
      }
    // a garment cut by the frame edge keeps hanging: if nothing reached the
    // line, peg its top row
    if (!pinned) {
      let top = Infinity;
      for (let k = 0; k < N; k++) if (gid[k] === g.id) top = Math.min(top, rest[k * 2 + 1]);
      for (let k = 0; k < N; k++)
        if (gid[k] === g.id && rest[k * 2 + 1] <= top + 0.1) pinS[k] = (rest[k * 2] - ROPE.left) / (ROPE.right - ROPE.left);
    }
    garments.push({ ...g, plan: pl });
  }
  for (let k = 0; k < N; k++) {
    mass[k] = Math.max(mass[k], density * (CELL / PX) ** 2 * 0.05);
    w[k] = pinS[k] >= 0 ? 0 : 1 / mass[k];
  }
  const C = new Float32Array(cons.length * 4);
  cons.forEach((c, i) => C.set(c, i * 4));
  const T = new Float32Array(tris.length * 4);
  tris.forEach((t, i) => T.set(t, i * 4));
  const nT = tris.length;
  const triWind = new Float32Array(nT * 3);

  // ---- the line
  const line = { th: 0, om: 0, m2: 0, o2: 0, sag: 1, fz: 0, fz2: 0, fy: 0 };
  let weight = 0;
  for (let k = 0; k < N; k++) weight += mass[k] * G;
  weight += 0.35 * G; // the rope and pegs
  const W0 = 2 * Math.PI * 1.15; // the line's swing, ~1.15 Hz
  const ropeDisp = (s, out) => {
    const shape = 4 * s * (1 - s);
    const S = ROPE.sag * line.sag * shape;
    const s2 = Math.sin(2 * Math.PI * s) * 0.045 * line.m2;
    out[0] = 0;
    out[1] = S * (1 - Math.cos(line.th));
    out[2] = S * Math.sin(line.th) + s2;
    return out;
  };
  const tmp = [0, 0, 0];
  const placePins = (arr) => {
    for (let k = 0; k < N; k++) {
      if (pinS[k] < 0) continue;
      ropeDisp(pinS[k], tmp);
      arr[k * 3] = x0[k * 3] + tmp[0];
      arr[k * 3 + 1] = x0[k * 3 + 1] + tmp[1];
      arr[k * 3 + 2] = x0[k * 3 + 2] + tmp[2];
    }
  };
  x0.set(x);
  // where each vertex hangs in the photograph, and how far below its pegs
  const xr = Float32Array.from(x);
  const K = new Float32Array(N);
  const nearS = new Float32Array(N).fill(0.5);
  {
    const pins = [];
    for (let k = 0; k < N; k++) if (pinS[k] >= 0) pins.push(k);
    for (let k = 0; k < N; k++) {
      let hang = Infinity;
      for (const q of pins) {
        if (gid[q] !== gid[k]) continue;
        const d = Math.hypot(x[k * 3] - x[q * 3], x[k * 3 + 1] - x[q * 3 + 1]);
        if (d < hang) {
          hang = d;
          nearS[k] = pinS[q];
        }
      }
      K[k] = G / Math.max(0.12, Number.isFinite(hang) ? hang : 0.5);
    }
  }
  // ... and that place rides with the line as it swings
  const xt = Float32Array.from(xr);
  const followLine = () => {
    for (let k = 0; k < N; k++) {
      ropeDisp(nearS[k], tmp);
      xt[k * 3] = xr[k * 3] + tmp[0];
      xt[k * 3 + 1] = xr[k * 3 + 1] + tmp[1];
      xt[k * 3 + 2] = xr[k * 3 + 2] + tmp[2];
    }
  };

  // ---- one substep
  const lambdaFree = true;
  const substep = (dt, windAt) => {
    // forces: gravity + wind pressure on triangles
    const fx = p; // reuse p as force accumulator before prediction
    fx.fill(0);
    let FZ = 0, FZ2 = 0, FY = 0;
    for (let t = 0; t < nT; t++) {
      const a = T[t * 4] | 0, b = T[t * 4 + 1] | 0, c = T[t * 4 + 2] | 0, area = T[t * 4 + 3];
      const ax = x[a * 3], ay = x[a * 3 + 1], az = x[a * 3 + 2];
      const e1x = x[b * 3] - ax, e1y = x[b * 3 + 1] - ay, e1z = x[b * 3 + 2] - az;
      const e2x = x[c * 3] - ax, e2y = x[c * 3 + 1] - ay, e2z = x[c * 3 + 2] - az;
      let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
      const nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl; ny /= nl; nz /= nl;
      const rx = triWind[t * 3] - (v[a * 3] + v[b * 3] + v[c * 3]) / 3;
      const ry = triWind[t * 3 + 1] - (v[a * 3 + 1] + v[b * 3 + 1] + v[c * 3 + 1]) / 3;
      const rz = triWind[t * 3 + 2] - (v[a * 3 + 2] + v[b * 3 + 2] + v[c * 3 + 2]) / 3;
      const vn = rx * nx + ry * ny + rz * nz;
      const q = 0.5 * RHO * area;
      const fn = q * CD * vn * Math.abs(vn);
      const tx = rx - vn * nx, ty = ry - vn * ny, tz = rz - vn * nz;
      const tl = Math.hypot(tx, ty, tz);
      const ft = q * CT * tl;
      const Fx = (fn * nx + ft * tx) / 3, Fy = (fn * ny + ft * ty) / 3, Fz = (fn * nz + ft * tz) / 3;
      fx[a * 3] += Fx; fx[a * 3 + 1] += Fy; fx[a * 3 + 2] += Fz;
      fx[b * 3] += Fx; fx[b * 3 + 1] += Fy; fx[b * 3 + 2] += Fz;
      fx[c * 3] += Fx; fx[c * 3 + 1] += Fy; fx[c * 3 + 2] += Fz;
      FZ += 3 * Fz;
      FY += 3 * Fy;
      const s = ((ax * PX - ROPE.left) / (ROPE.right - ROPE.left));
      FZ2 += 3 * Fz * Math.sin(2 * Math.PI * s);
    }
    line.fz = FZ; line.fz2 = FZ2; line.fy = FY;
    // the line: a damped pendulum about its chord, toward atan(load)
    const thEq = Math.atan2(FZ, weight);
    line.om += (W0 * W0 * (thEq - line.th) - 2 * 0.16 * W0 * line.om) * dt;
    line.th += line.om * dt;
    const m2Eq = Math.max(-1, Math.min(1, FZ2 / weight));
    line.o2 += (4 * W0 * W0 * (m2Eq - line.m2) - 2 * 0.2 * 2 * W0 * line.o2) * dt;
    line.m2 += line.o2 * dt;
    const sagEq = 1 + 0.35 * Math.max(-0.5, Math.min(0.6, -FY / weight));
    line.sag += (sagEq - line.sag) * Math.min(1, dt * 6);

    // predict
    const damp = Math.exp(-0.35 * dt);
    for (let k = 0; k < N; k++) {
      const i = k * 3;
      if (w[k] === 0) continue;
      // the photographed drape is where weight and tension balance; away
      // from it, weight pulls back as it does on a pendulum of the cloth's
      // hang below its pegs (K = g / hang)
      const kk = K[k];
      v[i] = (v[i] + (fx[i] * w[k] + kk * (xt[i] - x[i])) * dt) * damp;
      v[i + 1] = (v[i + 1] + (fx[i + 1] * w[k] + kk * (xt[i + 1] - x[i + 1])) * dt) * damp;
      v[i + 2] = (v[i + 2] + (fx[i + 2] * w[k] + kk * (xt[i + 2] - x[i + 2])) * dt) * damp;
    }
    for (let k = 0; k < N * 3; k++) p[k] = x[k] + v[k] * dt;
    placePins(p);
    // project: one Gauss-Seidel sweep of the distance constraints
    const idt2 = 1 / (dt * dt);
    const nc = C.length / 4;
    for (let c = 0; c < nc; c++) {
      const a = C[c * 4] | 0, b = C[c * 4 + 1] | 0;
      const wa = w[a], wb = w[b];
      const ws = wa + wb;
      if (ws === 0) continue;
      const ia = a * 3, ib = b * 3;
      const dx = p[ia] - p[ib], dy = p[ia + 1] - p[ib + 1], dz = p[ia + 2] - p[ib + 2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-9;
      const Cn = d - C[c * 4 + 2];
      const dl = -Cn / (ws + C[c * 4 + 3] * idt2);
      const gx = (dx / d) * dl, gy = (dy / d) * dl, gz = (dz / d) * dl;
      p[ia] += gx * wa; p[ia + 1] += gy * wa; p[ia + 2] += gz * wa;
      p[ib] -= gx * wb; p[ib + 1] -= gy * wb; p[ib + 2] -= gz * wb;
    }
    const idt = 1 / dt;
    for (let k = 0; k < N * 3; k++) {
      v[k] = (p[k] - x[k]) * idt;
      x[k] = p[k];
    }
  };
  void lambdaFree;

  // per-triangle wind, set once a frame by the caller
  const setWind = (fn) => {
    for (let t = 0; t < nT; t++) {
      const a = T[t * 4] | 0, b = T[t * 4 + 1] | 0, c = T[t * 4 + 2] | 0;
      const cx = (x[a * 3] + x[b * 3] + x[c * 3]) / 3;
      const cy = (x[a * 3 + 1] + x[b * 3 + 1] + x[c * 3 + 1]) / 3;
      fn(cx, cy, t, triWind, t * 3);
    }
  };

  const step = (frameDt, windFn) => {
    setWind(windFn);
    followLine();
    const h = frameDt / Math.max(1, Math.round((SUB * frameDt) / (1 / 60)));
    const n = Math.max(1, Math.round(frameDt / h));
    for (let i = 0; i < n; i++) substep(h, windFn);
  };

  // settle with no wind, then call that the photograph
  const settle = (seconds) => {
    const still = (cx, cy, t, out, o) => {
      out[o] = 0; out[o + 1] = 0; out[o + 2] = 0;
    };
    for (let i = 0; i < Math.round(seconds * 60); i++) step(1 / 60, still);
    x0.set(x);
    v.fill(0);
    line.th = line.om = line.m2 = line.o2 = 0;
    line.sag = 1;
    computeNormals(nrm0);
  };

  // vertex normals from the grid neighbours, facing the camera
  const CAM = [0, -0.64, -0.77]; // from the cloth toward the lens
  const computeNormals = (out) => {
    for (const gm of garments) {
      const { nx, ny, vid } = gm.plan;
      const at = (i, j) => (i < 0 || j < 0 || i > nx || j > ny ? -1 : vid[j * (nx + 1) + i]);
      for (let j = 0; j <= ny; j++)
        for (let i = 0; i <= nx; i++) {
          const k = at(i, j);
          if (k < 0) continue;
          let l = at(i - 1, j), r = at(i + 1, j), u = at(i, j - 1), d = at(i, j + 1);
          if (l < 0) l = k;
          if (r < 0) r = k;
          if (u < 0) u = k;
          if (d < 0) d = k;
          const tx = x[r * 3] - x[l * 3], ty = x[r * 3 + 1] - x[l * 3 + 1], tz = x[r * 3 + 2] - x[l * 3 + 2];
          const bx = x[d * 3] - x[u * 3], by = x[d * 3 + 1] - x[u * 3 + 1], bz = x[d * 3 + 2] - x[u * 3 + 2];
          let nx_ = ty * bz - tz * by, ny_ = tz * bx - tx * bz, nz_ = tx * by - ty * bx;
          const nl = Math.hypot(nx_, ny_, nz_);
          if (nl < 1e-9) {
            nx_ = 0; ny_ = 0; nz_ = -1;
          } else {
            nx_ /= nl; ny_ /= nl; nz_ /= nl;
          }
          if (nx_ * CAM[0] + ny_ * CAM[1] + nz_ * CAM[2] < 0) {
            nx_ = -nx_; ny_ = -ny_; nz_ = -nz_;
          }
          out[k * 3] = nx_; out[k * 3 + 1] = ny_; out[k * 3 + 2] = nz_;
        }
    }
  };

  return {
    N,
    rest,
    x,
    x0,
    nrm,
    nrm0,
    gid,
    pinS,
    garments,
    tris: T,
    nT,
    line,
    CAM,
    step,
    settle,
    ropeDisp,
    computeNormals: () => computeNormals(nrm),
  };
}
