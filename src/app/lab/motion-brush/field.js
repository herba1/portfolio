// The motion field: what a brush stroke means to the sky.
//
// A stroke is a list of samples (plate px, image velocity in plate px/s, the
// clock time it was painted). Its influence spreads from the samples through
// a coarse grid by geodesic distance (Dijkstra), where stepping costs more
// across a change of colour (cloud into blue) and buildings are walls, so a
// stroke on one cloud bank fills that bank before it leaks into the next and
// never reaches the roofs. The spread is cut off with a Gaussian of that
// distance, then a guided filter (guide: the plate's luma) smooths the
// piecewise-constant velocities of the nearest-sample regions while keeping
// the cloud's edges.
//
// Strokes combine as a normalised weighted mean, so two strokes in the same
// direction do not double the speed, and crossing strokes turn the flow.
// The result is a static (Eulerian) velocity field plus, per cell, the time
// it was painted, which starts that region's loop from the photograph.

export const GW = 96;
export const GH = 128;

const R_SKY = 10; // cells: where the influence has fallen to 1/e
const COLOUR_COST = 9;

// Binary heap of [key, index] on two typed arrays.
function heap(n) {
  const key = new Float32Array(n);
  const idx = new Int32Array(n);
  let size = 0;
  return {
    get size() {
      return size;
    },
    clear() {
      size = 0;
    },
    push(k, i) {
      let c = size++;
      while (c > 0) {
        const p = (c - 1) >> 1;
        if (key[p] <= k) break;
        key[c] = key[p];
        idx[c] = idx[p];
        c = p;
      }
      key[c] = k;
      idx[c] = i;
    },
    pop() {
      const top = idx[0];
      const k = key[--size];
      const i = idx[size];
      let c = 0;
      for (;;) {
        let m = 2 * c + 1;
        if (m >= size) break;
        if (m + 1 < size && key[m + 1] < key[m]) m++;
        if (key[m] >= k) break;
        key[c] = key[m];
        idx[c] = idx[m];
        c = m;
      }
      key[c] = k;
      idx[c] = i;
      return top;
    },
    topKey() {
      return key[0];
    },
  };
}

// Box filter (radius r) on a W x H float array, via a summed-area table.
function boxFilter(src, r, out, sat, W, H) {
  for (let y = 0; y <= H; y++) sat[y * (W + 1)] = 0;
  for (let x = 0; x <= W; x++) sat[x] = 0;
  for (let y = 1; y <= H; y++) {
    let row = 0;
    for (let x = 1; x <= W; x++) {
      row += src[(y - 1) * W + (x - 1)];
      sat[y * (W + 1) + x] = sat[(y - 1) * (W + 1) + x] + row;
    }
  }
  for (let y = 0; y < H; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(H, y + r + 1);
    for (let x = 0; x < W; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(W, x + r + 1);
      const s = sat[y1 * (W + 1) + x1] - sat[y0 * (W + 1) + x1] - sat[y1 * (W + 1) + x0] + sat[y0 * (W + 1) + x0];
      out[y * W + x] = s / ((y1 - y0) * (x1 - x0));
    }
  }
}

export function createField(guide, plateW, plateH, loop) {
  const N = GW * GH;
  const cw = plateW / GW;
  const ch = plateH / GH;
  // guide: RGBA bytes, GW x GH: r luma, g blueness, b building
  const lum = new Float32Array(N);
  const blu = new Float32Array(N);
  const wall = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    lum[i] = guide[i * 4] / 255;
    blu[i] = guide[i * 4 + 1] / 255;
    wall[i] = guide[i * 4 + 2] > 110 ? 1 : 0;
  }
  // Fade near buildings and the plate border (cells), so nothing is pulled
  // out from behind a roof or in from beyond the frame.
  const fade = new Float32Array(N);
  {
    const d = new Float32Array(N).fill(1e9);
    const h = heap(N * 4);
    for (let i = 0; i < N; i++) {
      const x = i % GW;
      const y = (i / GW) | 0;
      const border = Math.min(x + 0.5, y + 0.5, GW - x - 0.5, GH - y - 0.5);
      if (wall[i]) {
        d[i] = 0;
        h.push(0, i);
      } else d[i] = Math.min(d[i], border * 1.6);
    }
    while (h.size) {
      const k = h.topKey();
      const i = h.pop();
      if (k > d[i]) continue;
      const x = i % GW;
      const y = (i / GW) | 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
          const j = ny * GW + nx;
          const nd = k + (dx && dy ? Math.SQRT2 : 1);
          if (nd < d[j]) {
            d[j] = nd;
            h.push(nd, j);
          }
        }
    }
    for (let i = 0; i < N; i++) {
      const t = Math.min(1, Math.max(0, (d[i] - 0.6) / 3.2));
      fade[i] = t * t * (3 - 2 * t);
    }
  }

  // Precomputed step costs to the 8 neighbours.
  const DX = [1, -1, 0, 0, 1, 1, -1, -1];
  const DY = [0, 0, 1, -1, 1, -1, 1, -1];
  const cost = new Float32Array(N * 8);
  for (let i = 0; i < N; i++) {
    const x = i % GW;
    const y = (i / GW) | 0;
    for (let k = 0; k < 8; k++) {
      const nx = x + DX[k];
      const ny = y + DY[k];
      if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) {
        cost[i * 8 + k] = -1;
        continue;
      }
      const j = ny * GW + nx;
      if (wall[j]) {
        cost[i * 8 + k] = -1;
        continue;
      }
      const dl = lum[j] - lum[i];
      const db = blu[j] - blu[i];
      const dc = Math.sqrt(dl * dl + 0.6 * db * db);
      cost[i * 8 + k] = (k < 4 ? 1 : Math.SQRT2) * (1 + COLOUR_COST * dc);
    }
  }

  const dist = new Float32Array(N);
  const src = new Int32Array(N);
  const hp = heap(N * 8);
  const sat = new Float64Array((GW + 1) * (GH + 1));
  const tmp = Array.from({ length: 11 }, () => new Float32Array(N));

  // One stroke -> per-cell weight, velocity, paint time.
  function solveStroke(samples) {
    const w = new Float32Array(N);
    const vx = new Float32Array(N);
    const vy = new Float32Array(N);
    const tp = new Float32Array(N);
    if (!samples.length) return { w, vx, vy, tp, pc: w, ps: w, box: null };
    dist.fill(1e9);
    src.fill(-1);
    hp.clear();
    samples.forEach((s, si) => {
      const gx = Math.floor(s.x / cw);
      const gy = Math.floor(s.y / ch);
      if (gx < 0 || gy < 0 || gx >= GW || gy >= GH) return;
      const i = gy * GW + gx;
      if (wall[i]) return;
      if (dist[i] > 0) {
        dist[i] = 0;
        src[i] = si;
        hp.push(0, i);
      } else src[i] = si; // later sample over the same cell wins
    });
    const lim = R_SKY * 2.6;
    while (hp.size) {
      const k = hp.topKey();
      const i = hp.pop();
      if (k > dist[i]) continue;
      if (k > lim) break;
      for (let e = 0; e < 8; e++) {
        const c = cost[i * 8 + e];
        if (c < 0) continue;
        const j = i + DY[e] * GW + DX[e];
        const nd = k + c;
        if (nd < dist[j]) {
          dist[j] = nd;
          src[j] = src[i];
          hp.push(nd, j);
        }
      }
    }
    // Only the cells the spread reached (plus the filter's reach) matter.
    let x0 = GW;
    let y0 = GH;
    let x1 = -1;
    let y1 = -1;
    for (let i = 0; i < N; i++) {
      if (src[i] < 0 || dist[i] > lim) continue;
      const x = i % GW;
      const y = (i / GW) | 0;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    const pc = new Float32Array(N);
    const ps = new Float32Array(N);
    if (x1 < 0) return { w, vx, vy, tp, pc, ps, box: null };
    const r = 3;
    x0 = Math.max(0, x0 - 2 * r);
    y0 = Math.max(0, y0 - 2 * r);
    x1 = Math.min(GW - 1, x1 + 2 * r);
    y1 = Math.min(GH - 1, y1 + 2 * r);
    const bw = x1 - x0 + 1;
    const bh = y1 - y0 + 1;
    const [aW, aX, aY, aT, mI, mP, oA, oB, mean, mean2, gl] = tmp;
    for (let y = 0; y < bh; y++)
      for (let x = 0; x < bw; x++) {
        const i = (y + y0) * GW + (x + x0);
        const j = y * bw + x;
        const s = src[i] >= 0 && dist[i] <= lim ? samples[src[i]] : null;
        const g = dist[i] / R_SKY;
        const wi = s ? Math.exp(-g * g) * fade[i] : 0;
        gl[j] = lum[i];
        aW[j] = wi;
        aX[j] = s ? s.vx * wi : 0;
        aY[j] = s ? s.vy * wi : 0;
        aT[j] = s ? s.t * wi : 0;
      }
    // Guided filter (He et al.), guide = luma: q = mean(a) * I + mean(b).
    const n = bw * bh;
    const eps = 0.004;
    boxFilter(gl, r, mI, sat, bw, bh);
    for (let j = 0; j < n; j++) mP[j] = gl[j] * gl[j];
    boxFilter(mP, r, mean2, sat, bw, bh);
    const chans = [aW, aX, aY, aT];
    const res = [new Float32Array(n), new Float32Array(n), new Float32Array(n), new Float32Array(n)];
    for (let c = 0; c < 4; c++) {
      const p = chans[c];
      boxFilter(p, r, mean, sat, bw, bh);
      for (let j = 0; j < n; j++) mP[j] = gl[j] * p[j];
      boxFilter(mP, r, oA, sat, bw, bh);
      for (let j = 0; j < n; j++) {
        const varI = mean2[j] - mI[j] * mI[j];
        const cov = oA[j] - mI[j] * mean[j];
        const a = cov / (varI + eps);
        oA[j] = a;
        oB[j] = mean[j] - a * mI[j];
      }
      boxFilter(oA, r, mP, sat, bw, bh);
      boxFilter(oB, r, mean, sat, bw, bh);
      const o = res[c];
      for (let j = 0; j < n; j++) o[j] = mP[j] * gl[j] + mean[j];
    }
    // back to velocity and time per unit weight
    const k = (2 * Math.PI) / loop;
    for (let y = 0; y < bh; y++)
      for (let x = 0; x < bw; x++) {
        const i = (y + y0) * GW + (x + x0);
        const j = y * bw + x;
        const wf = res[0][j];
        const wi = Math.max(0, wf) * fade[i] * (wall[i] ? 0 : 1);
        if (wi < 0.004) continue;
        const d = Math.max(wf, 1e-4);
        w[i] = wi;
        vx[i] = res[1][j] / d;
        vy[i] = res[2][j] / d;
        tp[i] = res[3][j] / d;
        pc[i] = Math.cos(tp[i] * k);
        ps[i] = Math.sin(tp[i] * k);
      }
    return { w, vx, vy, tp, pc, ps, box: [x0, y0, x1, y1] };
  }

  // Combine strokes (each with an envelope 0..1) into RGBA float data:
  // velocity x, y (plate px/s) and the paint phase.
  const data = new Float32Array(N * 4);
  // The paint time is carried as a phase on the loop's circle (cos, sin), so
  // it interpolates and blends without wrapping and keeps its precision in a
  // half-float texture however long the page has been open.
  function compose(strokes) {
    data.fill(0);
    let x0 = GW;
    let y0 = GH;
    let x1 = -1;
    let y1 = -1;
    const live = strokes.filter((s) => s.field && s.field.box && s.env > 0);
    for (const s of live) {
      const b = s.field.box;
      x0 = Math.min(x0, b[0]);
      y0 = Math.min(y0, b[1]);
      x1 = Math.max(x1, b[2]);
      y1 = Math.max(y1, b[3]);
    }
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const i = y * GW + x;
        let sw = 0;
        let sx = 0;
        let sy = 0;
        let sc = 0;
        let ss = 0;
        for (const s of live) {
          const f = s.field;
          const wi = f.w[i] * s.env;
          if (wi <= 0) continue;
          sw += wi;
          sx += f.vx[i] * wi;
          sy += f.vy[i] * wi;
          sc += f.pc[i] * wi;
          ss += f.ps[i] * wi;
        }
        if (sw <= 0) continue;
        const norm = 1 / Math.max(1, sw);
        data[i * 4] = sx * norm;
        data[i * 4 + 1] = sy * norm;
        data[i * 4 + 2] = sc / sw;
        data[i * 4 + 3] = ss / sw;
      }
    return data;
  }

  const isWall = (px, py) => {
    const gx = Math.floor(px / cw);
    const gy = Math.floor(py / ch);
    if (gx < 0 || gy < 0 || gx >= GW || gy >= GH) return true;
    return wall[gy * GW + gx] === 1;
  };

  return { solveStroke, compose, isWall };
}
