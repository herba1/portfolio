import { SHEET_H, SHEET_W, rng } from "./crumpleCreases";

export const BALL_R = 0.16;
const A_REST = 0.004;
const MOUNTAIN = BALL_R * 0.52;
const VALLEY = BALL_R * 0.62;
const PINCH = 1.1;
const LUMP = BALL_R * 0.07;
const FINE = BALL_R * 0.34;
const WRAP = Math.PI * 0.995;

function ease(t) {
  return t * t * (3 - 2 * t);
}

function falloff(u, L) {
  const a = Math.abs(u);
  const lo = L * 0.3;
  if (a <= lo) return 1;
  if (a >= L) return 0;
  const x = (a - lo) / (L - lo);
  return 1 - x * x * (3 - 2 * x);
}

export function buildSheet(THREE, creases, seed, segments) {
  const [nx, ny] = segments;
  const geometry = new THREE.PlaneGeometry(SHEET_W, SHEET_H, nx, ny);
  const pos = geometry.attributes.position;
  const count = pos.count;
  geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(count * 3).fill(1), 3));
  const ell = new Float32Array(count);
  const phi = new Float32Array(count);
  const target = new Float32Array(count);
  const tuck = new Float32Array(count);
  const mount = new Float32Array(count);
  const valley = new Float32Array(count);
  const relief = new Float32Array(count);
  const pull = new Float32Array(count * 2);
  const twist = new Float32Array(count);
  const fine = new Float32Array(count);
  const rand = rng(seed * 7 + 3);
  const folds = [];
  for (let k = 0; k < 140; k += 1) {
    const a = rand() * Math.PI;
    folds.push({
      qx: (rand() - 0.5) * SHEET_W * 1.1,
      qy: (rand() - 0.5) * SHEET_H * 1.1,
      dx: Math.cos(a),
      dy: Math.sin(a),
      L: 0.1 + rand() * 0.32,
      w: 0.035 + rand() * 0.06,
      amp: (rand() < 0.5 ? -1 : 1) * (0.5 + rand() * 0.5),
    });
  }
  let fMax = 1e-6;
  const all = creases.concat(folds.filter((c) => c.amp < 0).map((c) => ({ ...c, amp: c.amp * 0.8, w: c.w * 1.4 })));
  const s1 = rand() * 6.28;
  const s2 = rand() * 6.28;
  const s3 = rand() * 6.28;
  let mMax = 1e-6;
  let vMax = 1e-6;
  let rMax = 1e-6;
  for (let i = 0; i < count; i += 1) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const l = Math.hypot(x, y);
    ell[i] = l;
    phi[i] = Math.atan2(y, x);
    const dx = l > 1e-6 ? Math.abs(x / l) : 0;
    const dy = l > 1e-6 ? Math.abs(y / l) : 1;
    const edge = Math.min(dx > 1e-6 ? SHEET_W / 2 / dx : 1e6, dy > 1e-6 ? SHEET_H / 2 / dy : 1e6);
    const rho = Math.min(1, l / edge);
    target[i] = WRAP * BALL_R * rho;
    const e = Math.max(0, Math.min(1, (rho - 0.9) / 0.1));
    tuck[i] = e * e * (3 - 2 * e) * (0.3 + 0.7 * Math.abs(Math.sin(phi[i] * 2 + s2) * Math.cos(phi[i] * 5 + s3)));
    let m = 0;
    let v = 0;
    let r = 0;
    let px = 0;
    let py = 0;
    for (const c of all) {
      const rx = x - c.qx;
      const ry = y - c.qy;
      const u = rx * c.dx + ry * c.dy;
      const F = falloff(u, c.L);
      if (F <= 0) continue;
      const d = -rx * c.dy + ry * c.dx;
      const ad = Math.abs(d);
      if (ad < c.w) {
        const k = (c.w - ad) / c.w;
        r += c.amp * k * k * F;
      }
      if (c.amp > 0) {
        if (ad < c.w) m += c.amp * ((c.w - ad) / c.w) * F;
      } else {
        const wv = c.w * 0.55;
        if (ad < wv) v += -c.amp * ((wv - ad) / wv) * F;
      }
      const strength = c.amp > 0 ? 0.3 : 1;
      const p = Math.min(ad, c.w * 1.4) * Math.sign(d) * F * Math.abs(c.amp) * strength;
      px += c.dy * p;
      py -= c.dx * p;
    }
    let f = 0;
    for (const c of folds) {
      const rx = x - c.qx;
      const ry = y - c.qy;
      const u = Math.abs(rx * c.dx + ry * c.dy);
      if (u >= c.L) continue;
      const d = Math.abs(-rx * c.dy + ry * c.dx);
      if (d >= c.w) continue;
      const end = u < c.L * 0.6 ? 1 : (c.L - u) / (c.L * 0.4);
      f += c.amp * (c.w - d) * end;
    }
    fine[i] = f;
    fMax = Math.max(fMax, Math.abs(f));
    mount[i] = m;
    valley[i] = v;
    relief[i] = r;
    mMax = Math.max(mMax, Math.abs(m));
    vMax = Math.max(vMax, v);
    rMax = Math.max(rMax, Math.abs(r));
    const pm = Math.hypot(px, py);
    const k = pm > 0.14 ? 0.14 / pm : 1;
    pull[i * 2] = px * k;
    pull[i * 2 + 1] = py * k;
    twist[i] = 0.7 * Math.sin(x * 5.1 + y * 2.9 + s3) * Math.cos(y * 4.4 - x * 2.3 + s1) + 0.35 * Math.sin(x * 1.7 - y * 2.1 + s2);
  }
  for (let i = 0; i < count; i += 1) {
    mount[i] /= mMax;
    valley[i] /= vMax;
    relief[i] /= rMax;
    fine[i] /= fMax;
  }
  const waves = [];
  for (let k = 0; k < 6; k += 1) {
    const a = rand() * Math.PI * 2;
    const b = Math.acos(rand() * 2 - 1);
    const f = 2.6 + rand() * 3.4;
    waves.push([Math.sin(b) * Math.cos(a) * f, Math.sin(b) * Math.sin(a) * f, Math.cos(b) * f, rand() * 6.28, 0.6 + rand() * 0.6]);
  }
  const planes = [];
  const faces = 96;
  for (let k = 0; k < faces; k += 1) {
    const yk = 1 - ((k + 0.5) / faces) * 2;
    const rk = Math.sqrt(1 - yk * yk);
    const a = k * 2.39996 + (rand() - 0.5) * 0.5;
    const jx = rk * Math.cos(a) + (rand() - 0.5) * 0.25;
    const jy = rk * Math.sin(a) + (rand() - 0.5) * 0.25;
    const jz = yk + (rand() - 0.5) * 0.25;
    const m2 = Math.hypot(jx, jy, jz);
    planes.push([jx / m2, jy / m2, jz / m2, BALL_R * (0.78 + rand() * 0.26)]);
  }
  return { geometry, count, ell, phi, target, tuck, planes, mount, valley, relief, pull, twist, fine, waves, center: new THREE.Vector3() };
}

export function deformSheet(sheet, t) {
  const { geometry, count, ell, phi, target, tuck, planes, mount, valley, relief, pull, twist, fine, waves, center } = sheet;
  const arr = geometry.attributes.position.array;
  const col = geometry.attributes.color.array;
  const e1 = ease(Math.min(1, t * 1.05));
  const kappa = Math.pow(t, 1.2) / BALL_R;
  const fold = Math.pow(t, 0.7);
  const pinch = PINCH * Math.pow(t, 0.6);
  const rest = A_REST * (1 - t);
  const poly = t > 0.5 ? Math.pow((t - 0.5) / 0.5, 2) * 0.97 : 0;
  const lumpAmt = LUMP * Math.pow(t, 1.6);
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (let i = 0; i < count; i += 1) {
    const l = ell[i] + (target[i] - ell[i]) * e1;
    const theta = kappa * l;
    const p0 = phi[i];
    const p = p0 + twist[i] * e1 * 0.5;
    const cp = Math.cos(p);
    const sp = Math.sin(p);
    let rxy;
    let z;
    let st;
    let ct;
    if (theta < 1e-3) {
      rxy = l;
      z = -l * theta * 0.5;
      st = theta;
      ct = 1;
    } else {
      st = Math.sin(theta);
      ct = Math.cos(theta);
      rxy = st / kappa;
      z = (ct - 1) / kappa;
    }
    const gx = pull[i * 2];
    const gy = pull[i * 2 + 1];
    const c0 = Math.cos(p0);
    const s0 = Math.sin(p0);
    const pole = Math.min(1, Math.max(0, (Math.PI - theta) / 0.9));
    const pp = pinch * pole * pole;
    const dl = (gx * c0 + gy * s0) * pp;
    const dp = (-gx * s0 + gy * c0) * pp;
    const sink = Math.min(1, valley[i] + tuck[i] * 0.4) * VALLEY * fold;
    let lump = 0;
    if (lumpAmt > 1e-5) {
      const nx = cp * st;
      const ny = sp * st;
      for (let k = 0; k < waves.length; k += 1) {
        const wv = waves[k];
        lump += wv[4] * (Math.abs(Math.sin(nx * wv[0] + ny * wv[1] + ct * wv[2] + wv[3])) - 0.62);
      }
    }
    const d = Math.max(-BALL_R * 0.82, mount[i] * MOUNTAIN * fold - sink + lump * lumpAmt + fine[i] * FINE * fold * fold) + relief[i] * rest;
    let x = cp * rxy + cp * st * d + cp * ct * dl - sp * dp;
    let y = sp * rxy + sp * st * d + sp * ct * dl + cp * dp;
    let zz = z + ct * d - st * dl;
    if (poly > 1e-4) {
      const pc = -1 / kappa;
      const bx = cp * rxy + cp * ct * dl - sp * dp;
      const by = sp * rxy + sp * ct * dl + cp * dp;
      const bz = z - st * dl - pc;
      const bl = Math.hypot(bx, by, bz) || 1;
      const ux = bx / bl;
      const uy = by / bl;
      const uz = bz / bl;
      let r = Infinity;
      for (let k = 0; k < planes.length; k += 1) {
        const pl = planes[k];
        const dot = ux * pl[0] + uy * pl[1] + uz * pl[2];
        if (dot > 0.05) r = Math.min(r, pl[3] / dot);
      }
      r = Math.max(BALL_R * 0.2, Math.min(r, BALL_R * 1.4) + d * 0.6);
      x += (ux * r - x) * poly;
      y += (uy * r - y) * poly;
      zz += (pc + uz * r - zz) * poly;
    }
    arr[i * 3] = x;
    arr[i * 3 + 1] = y;
    arr[i * 3 + 2] = zz;
    const ao = 1 - 0.62 * Math.min(1, (sink / (BALL_R * 0.4)) * 1.1) - 0.1 * fold * (1 - mount[i]) * 0.5;
    col[i * 3] = ao;
    col[i * 3 + 1] = ao;
    col[i * 3 + 2] = ao * 0.98 + 0.02;
    cx += x;
    cy += y;
    cz += zz;
  }
  cx /= count;
  cy /= count;
  cz /= count;
  for (let i = 0; i < count; i += 1) {
    arr[i * 3] -= cx;
    arr[i * 3 + 1] -= cy;
    arr[i * 3 + 2] -= cz;
  }
  center.set(cx, cy, cz);
  geometry.attributes.position.needsUpdate = true;
  geometry.attributes.color.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
}
