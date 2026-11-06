// Soft-body rubber letters lying on a table, seen from above. Each letter is a
// lattice of point masses over its padded ink box, held by edge, shear and
// bend springs and, per cell, an area spring. Volume is area x thickness, so
// a finger pressing the rubber thinner asks the cells under it for more
// area: they spread out sideways, shoulder the neighbours away, and ring back
// with a damped wobble when let go. Pull and the rubber stretches, and the
// renderer thins it by the same rule. All lengths are CSS px; `em` is the
// font size.

const K_EDGE = 30000;
const K_SHEAR = 18000;
const K_BEND = 7000;
const K_AREA = 60000;
const C_SPRING = 45;
const K_ANCHOR = 700;
const C_ANCHOR = 4;
const DRAG = 2.5;
const GRAB_PULL = 0.35;
const K_GRIP = 4200; // the table's grip on the far side of a pulled letter
const SUBSTEPS = 24;

export function createSim({ em }) {
  const letters = [];
  let n = 0;
  let px, py, vx, vy, rx, ry, owner;
  let press = 0;
  const springs = [];
  const cells = [];
  let grab = null;

  function addLetter({ nx, ny, x0, y0, cx, cy, inkL, inkR }) {
    letters.push({ nx, ny, x0, y0, cx, cy, inkL, inkR, start: n, count: nx * ny });
    n += nx * ny;
  }

  function build() {
    px = new Float32Array(n); py = new Float32Array(n);
    vx = new Float32Array(n); vy = new Float32Array(n);
    rx = new Float32Array(n); ry = new Float32Array(n);
    owner = new Uint16Array(n);
    letters.forEach((L, li) => {
      const id = (c, r) => L.start + r * L.nx + c;
      for (let r = 0; r < L.ny; r++)
        for (let c = 0; c < L.nx; c++) {
          const i = id(c, r);
          rx[i] = px[i] = L.x0 + c * L.cx;
          ry[i] = py[i] = L.y0 + r * L.cy;
          owner[i] = li;
        }
      const spring = (a, b, k) => springs.push([a, b, Math.hypot(rx[a] - rx[b], ry[a] - ry[b]), k, 0]);
      for (let r = 0; r < L.ny; r++)
        for (let c = 0; c < L.nx; c++) {
          if (c + 1 < L.nx) spring(id(c, r), id(c + 1, r), K_EDGE);
          if (r + 1 < L.ny) spring(id(c, r), id(c, r + 1), K_EDGE);
          if (c + 1 < L.nx && r + 1 < L.ny) {
            spring(id(c, r), id(c + 1, r + 1), K_SHEAR);
            spring(id(c + 1, r), id(c, r + 1), K_SHEAR);
            const q = [id(c, r), id(c + 1, r), id(c + 1, r + 1), id(c, r + 1)];
            cells.push([...q, area(q), 0]);
          }
          if (c + 2 < L.nx) spring(id(c, r), id(c + 2, r), K_BEND);
          if (r + 2 < L.ny) spring(id(c, r), id(c, r + 2), K_BEND);
        }
    });
  }

  function area(q) {
    let a = 0;
    for (let k = 0; k < 4; k++) {
      const i = q[k], j = q[(k + 1) & 3];
      a += px[i] * py[j] - px[j] * py[i];
    }
    return a * 0.5;
  }

  const fx = () => new Float32Array(n);
  let nS = 0, nC = 0, SA, SB, SK, SC, SL, CQ, CA;
  function pack() {
    nS = springs.length; nC = cells.length;
    SA = new Int32Array(nS); SB = new Int32Array(nS); SK = new Float32Array(nS); SC = new Float32Array(nS); SL = new Float32Array(nS);
    springs.forEach((sp, s) => { SA[s] = sp[0]; SB[s] = sp[1]; SK[s] = sp[3]; SC[s] = C_SPRING * (sp[3] / K_EDGE); SL[s] = sp[2]; });
    CQ = new Int32Array(nC * 4); CA = new Float32Array(nC);
    cells.forEach((q, c) => { for (let k = 0; k < 4; k++) CQ[c * 4 + k] = q[k]; CA[c] = q[4]; });
  }
  // Pressed rubber grows its rest metric: thinner, so wider every way.
  function restFor(p) {
    for (let s = 0; s < nS; s++) SL[s] = springs[s][2] * Math.sqrt(1 + p * springs[s][4]);
    for (let c = 0; c < nC; c++) CA[c] = cells[c][4] * (1 + p * cells[c][5]);
  }
  let Fx, Fy;

  // Where row r's ink edge sits now, interpolated along the row.
  function edgeAt(L, r, side) {
    const u = side ? L.inkR[r] : L.inkL[r];
    if (u < 0) return null;
    const c0 = Math.min(L.nx - 2, Math.floor(u));
    const t = u - c0;
    const a = L.start + r * L.nx + c0;
    return { x: px[a] + (px[a + 1] - px[a]) * t, y: py[a] + (py[a + 1] - py[a]) * t, a, t };
  }

  function collide(A, B, gap) {
    for (let r = 0; r < A.ny; r++) {
      const e = edgeAt(A, r, 1);
      if (!e) continue;
      // B's left edge at the same height.
      let prev = null;
      for (let s = 0; s < B.ny; s++) {
        const f = edgeAt(B, s, 0);
        if (!f) continue;
        if (prev && prev.y <= e.y && f.y >= e.y) {
          const k = (e.y - prev.y) / Math.max(1e-6, f.y - prev.y);
          const xb = prev.x + (f.x - prev.x) * k;
          const o = e.x + gap - xb;
          if (o > 0) {
            const h = o * 0.5;
            push(e.a, e.t, -h);
            push(prev.a, prev.t, h * (1 - k));
            push(f.a, f.t, h * k);
          }
          break;
        }
        prev = f;
      }
    }
  }
  function push(a, t, d) {
    const w0 = 1 - t, w1 = t;
    px[a] += d * w0; px[a + 1] += d * w1;
    // Inelastic contact: kill the approaching part of the velocity.
    if (Math.sign(vx[a]) !== Math.sign(d)) vx[a] *= 1 - w0 * 0.5;
    if (Math.sign(vx[a + 1]) !== Math.sign(d)) vx[a + 1] *= 1 - w1 * 0.5;
  }

  function substep(dt) {
    Fx.fill(0); Fy.fill(0);
    for (let s = 0; s < nS; s++) {
      const a = SA[s], b = SB[s], k = SK[s];
      const dx = px[b] - px[a], dy = py[b] - py[a];
      const L = Math.sqrt(dx * dx + dy * dy) || 1e-6;
      const ux = dx / L, uy = dy / L;
      const rv = (vx[b] - vx[a]) * ux + (vy[b] - vy[a]) * uy;
      const f = k * (L - SL[s]) + SC[s] * rv;
      Fx[a] += f * ux; Fy[a] += f * uy;
      Fx[b] -= f * ux; Fy[b] -= f * uy;
    }
    for (let c = 0; c < nC; c++) {
      const o = c * 4;
      const i0 = CQ[o], i1 = CQ[o + 1], i2 = CQ[o + 2], i3 = CQ[o + 3];
      const A = 0.5 * ((px[i2] - px[i0]) * (py[i3] - py[i1]) - (px[i3] - px[i1]) * (py[i2] - py[i0]));
      const A0 = CA[c];
      const h = (0.5 * K_AREA * (A0 - A)) / Math.abs(A0);
      Fx[i0] += h * (py[i1] - py[i3]); Fy[i0] += h * (px[i3] - px[i1]);
      Fx[i1] += h * (py[i2] - py[i0]); Fy[i1] += h * (px[i0] - px[i2]);
      Fx[i2] += h * (py[i3] - py[i1]); Fy[i2] += h * (px[i1] - px[i3]);
      Fx[i3] += h * (py[i0] - py[i2]); Fy[i3] += h * (px[i2] - px[i0]);
    }
    // Pulling: the part of the letter away from the finger grips the table,
    // so the rubber between them stretches instead of the letter sliding.
    if (grab && grab.pull > 0) {
      const { gi, gw } = grab;
      const k = K_GRIP * grab.pull;
      for (let q = 0; q < gi.length; q++) {
        const i = gi[q];
        Fx[i] += k * gw[q] * (rx[i] - px[i]);
        Fy[i] += k * gw[q] * (ry[i] - py[i]);
      }
    }
    for (let i = 0; i < n; i++) {
      Fx[i] += K_ANCHOR * (rx[i] - px[i]) - C_ANCHOR * vx[i] - DRAG * vx[i];
      Fy[i] += K_ANCHOR * (ry[i] - py[i]) - C_ANCHOR * vy[i] - DRAG * vy[i];
    }
    if (grab) {
      const { idx, bx, by } = grab;
      for (let k = 0; k < idx.length; k++) { bx[k] = px[idx[k]]; by[k] = py[idx[k]]; }
    }
    for (let i = 0; i < n; i++) {
      vx[i] += Fx[i] * dt; vy[i] += Fy[i] * dt;
      px[i] += vx[i] * dt; py[i] += vy[i] * dt;
    }
    // The finger: grabbed points are led to their targets position-based, so
    // the press reaches its depth however stiff the rubber is, and their
    // velocity is whatever that motion actually was.
    if (grab) {
      const { idx, w, ox, oy, bx, by } = grab;
      for (let k = 0; k < idx.length; k++) {
        const i = idx[k];
        const a = w[k] * GRAB_PULL;
        px[i] += (ox[k] + grab.dx - px[i]) * a;
        py[i] += (oy[k] + grab.dy - py[i]) * a;
        vx[i] = (px[i] - bx[k]) / dt;
        vy[i] = (py[i] - by[k]) / dt;
      }
    }
    const gap = 0.022 * em;
    for (let l = 0; l + 1 < letters.length; l++) collide(letters[l], letters[l + 1], gap);
  }

  return {
    letters,
    addLetter,
    build() {
      build();
      pack();
      Fx = fx(); Fy = fx();
      // Let gravity settle the lattice, then call that the rest pose.
      for (let k = 0; k < 120; k++) this.step(1 / 60);
      rx.set(px); ry.set(py);
      vx.fill(0); vy.fill(0);
    },
    get px() { return px; },
    get py() { return py; },
    get rx() { return rx; },
    get ry() { return ry; },
    step(dt) {
      // A fixed substep keeps the stiff springs stable at any frame rate; a
      // slow frame runs slower rather than blowing up.
      restFor(press);
      const steps = Math.min(SUBSTEPS * 2, Math.max(1, Math.round(dt * 60 * SUBSTEPS)));
      for (let s = 0; s < steps; s++) substep(1 / (60 * SUBSTEPS));
    },
    // Grab the lattice of letter `li` around rest point (gx, gy).
    grab(li, gx, gy, radius, spread) {
      const L = letters[li];
      const idx = [], w = [], ox = [], oy = [];
      for (let i = L.start; i < L.start + L.count; i++) {
        const d2 = (rx[i] - gx) ** 2 + (ry[i] - gy) ** 2;
        const wi = Math.exp(-d2 / (radius * radius));
        if (wi < 0.02) continue;
        idx.push(i); w.push(wi); ox.push(px[i]); oy.push(py[i]);
      }
      for (const q of cells) {
        let cx = 0, cy = 0;
        for (let k = 0; k < 4; k++) { cx += rx[q[k]] * 0.25; cy += ry[q[k]] * 0.25; }
        q[5] = owner[q[0]] === li ? Math.exp(-((cx - gx) ** 2 + (cy - gy) ** 2) / (spread * spread)) : 0;
      }
      for (const sp of springs) {
        const cx = (rx[sp[0]] + rx[sp[1]]) * 0.5, cy = (ry[sp[0]] + ry[sp[1]]) * 0.5;
        sp[4] = owner[sp[0]] === li ? Math.exp(-((cx - gx) ** 2 + (cy - gy) ** 2) / (spread * spread)) : 0;
      }
      const gi = [], gw = [];
      for (let i = L.start; i < L.start + L.count; i++) {
        const d2 = (rx[i] - gx) ** 2 + (ry[i] - gy) ** 2;
        gi.push(i);
        gw.push(1 - Math.exp(-d2 / (0.42 * em) ** 2));
      }
      grab = { li, gi, gw, pull: 0, idx, w, ox, oy, bx: new Float32Array(idx.length), by: new Float32Array(idx.length), dx: 0, dy: 0 };
      return grab;
    },
    setGrab(dx, dy, p) {
      if (grab) {
        grab.dx = dx; grab.dy = dy;
        grab.pull = Math.min(1, Math.hypot(dx, dy) / (0.2 * em));
      }
      press = p;
    },
    release() { grab = null; press = 0; },
    // Thickness at each point, as rest area over current area of its cells.
    thickness(out) {
      out.fill(0);
      const cnt = this._cnt || (this._cnt = new Float32Array(n));
      cnt.fill(0);
      for (const q of cells) {
        const r = Math.abs(q[4] / area(q));
        for (let k = 0; k < 4; k++) { out[q[k]] += r; cnt[q[k]] += 1; }
      }
      for (let i = 0; i < n; i++) out[i] /= cnt[i] || 1;
      return out;
    },
    get count() { return n; },
    get grabbing() { return grab; },
    get pressAmount() { return press; },
    energy() {
      let e = 0;
      for (let i = 0; i < n; i++) e += vx[i] * vx[i] + vy[i] * vy[i];
      return e / n;
    },
  };
}
