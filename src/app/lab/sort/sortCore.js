// The CPU half of Sort, shared by the engine and offline checks: the sort
// grid, the curl map, the resting wave's mask, and the bake (domain field and
// starting permutation). Plain arrays in, plain arrays out; no DOM.

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export const GW = 1200; // sort grid (photo px)
export const GH = 800;
export const CX = 520; // curl centre, grid px
export const CY = 470;
export const CELL = 12; // mask cell, grid px: the sorted region has stepped edges
export const MW = Math.ceil(GW / CELL);
export const MH = Math.ceil(GH / CELL);
// Span interval on luminance: lo = mix(LO0, LO1, m).
export const LO0 = 0.9;
export const LO1 = 0.03;
export const HI = 1.0;
export const BAND = 40; // depth band width, 0..255
export const JUMP = 16; // a depth step this large between neighbours breaks a span
export const EDGE = 18; // depth step (0..255 over 4 px) that marks an edge

export const U0 = -CX; // u of domain texel 0's left edge
export const RMAX = Math.ceil(Math.max(Math.hypot(GW - CX, CY), Math.hypot(GW - CX, GH - CY), GH - CY, CY)) + 1;
export const UMAX = Math.ceil(Math.max(Math.PI * Math.hypot(GW - CX, CY), Math.PI * CY + CX));
export const DW = UMAX - U0;
export const DH = RMAX;

// Curl map, grid px <-> (arc length u, radius r).
export function fwd(x, y) {
  const dx = x - CX;
  const dy = y - CY;
  if (dx < 0) return dy >= 0 ? [dx, dy] : [Math.PI * -dy - dx, -dy];
  const r = Math.hypot(dx, dy);
  return [r * Math.atan2(dx, dy), r];
}
export function inv(u, r) {
  if (u < 0) return [CX + u, CY + r];
  const arc = Math.PI * r;
  if (u <= arc) {
    const th = u / Math.max(r, 1e-6);
    return [CX + r * Math.sin(th), CY + r * Math.cos(th)];
  }
  return [CX - (u - arc), CY - r];
}

// Small deterministic hash noise for the resting wave's ragged edge.
export function hash(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function vnoise(x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
export const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// The resting wave: a band of sort lines that enters low on the left, rides
// up round the curl and breaks over the top, thinning into fragments.
export function demoMask(amount) {
  const m = new Float32Array(MW * MH);
  const R0 = 60;
  const R1 = 320;
  for (let cy = 0; cy < MH; cy++) {
    for (let cx = 0; cx < MW; cx++) {
      const x = (cx + 0.5) * CELL;
      const y = (cy + 0.5) * CELL;
      const [u, r] = fwd(x, y);
      const t = (r - R0) / (R1 - R0);
      const n = vnoise(x / 70, y / 70) - 0.5;
      const n2 = hash(cx, cy);
      // Start low on the left; finish over the crest, inner lines curling furthest.
      const start = -CX + 110 + n * 160 + (1 - t) * 60;
      const thEnd = Math.PI * (1.0 - 0.62 * t) + n * 0.35;
      const end = r * thEnd + (1 - t) * 160;
      if (t < -0.12 || t > 1.12 || u < start - 40 || u > end + 40) continue;
      const across = Math.min(smooth(-0.12, 0.14, t + n * 0.12), smooth(1.12, 0.86, t + n * 0.12));
      const fromStart = smooth(start - 40, start + 90, u);
      const toEnd = smooth(end + 40, end - r * 0.55, u);
      let v = across * fromStart * (0.55 + 0.45 * toEnd);
      if (n2 < 0.12 && v < 0.85) v *= 0.4; // a few cells drop out at the fringe
      const road = Math.max(smooth(700, 740, y) * smooth(470, 540, x), smooth(790, 840, x) * smooth(600, 650, y));
      v *= 1 - 0.9 * road; // leave the road be
      m[cy * MW + cx] = clamp(v * amount, 0, 1);
    }
  }
  return m;
}

// Everything the CPU prepares once: the domain field (luminance, depth or
// edge, validity per sort-line texel) and the starting permutation.
export function bake(photoPx, depthPx, mask8, sorted) {
  // Depth edges: any pixel within two of a step in depth (a pole's silhouette,
  // a sign against the trees) is never in a span, so no span crosses it.
  const edge = new Uint8Array(GW * GH);
  {
    const D = (x, y) => depthPx[(clamp(y, 0, GH - 1) * GW + clamp(x, 0, GW - 1)) * 4];
    const g = new Uint8Array(GW * GH);
    for (let y = 0; y < GH; y++) {
      for (let x = 0; x < GW; x++) {
        const gx = Math.abs(D(x + 2, y) - D(x - 2, y));
        const gy = Math.abs(D(x, y + 2) - D(x, y - 2));
        g[y * GW + x] = Math.max(gx, gy) > EDGE ? 1 : 0;
      }
    }
    for (let y = 0; y < GH; y++) {
      for (let x = 0; x < GW; x++) {
        let e = 0;
        for (let k = -2; k <= 2 && !e; k++) e = g[clamp(y + k, 0, GH - 1) * GW + x] | g[y * GW + clamp(x + k, 0, GW - 1)];
        edge[y * GW + x] = e;
      }
    }
  }

  // ---- the domain: every sort line is one row
  const N = DW * DH;
  const field = new Uint8Array(N * 4);
  const lum16 = new Uint16Array(N);
  const depth = new Uint8Array(N);
  const cellOf = new Int32Array(N).fill(-1);
  for (let j = 0; j < DH; j++) {
    const r = j + 0.5;
    const arc = Math.PI * r;
    for (let i = 0; i < DW; i++) {
      // inv(), inlined: this loop runs ~2.6M times at load.
      const u = U0 + i + 0.5;
      let x;
      let y;
      if (u < 0) {
        x = CX + u;
        y = CY + r;
      } else if (u <= arc) {
        const th = u / r;
        x = CX + r * Math.sin(th);
        y = CY + r * Math.cos(th);
      } else {
        x = CX - (u - arc);
        y = CY - r;
      }
      if (x < 0 || y < 0 || x >= GW || y >= GH) continue;
      const k = j * DW + i;
      const px = Math.floor(x);
      const py = Math.floor(y);
      const s = (py * GW + px) * 4;
      const l = (0.2126 * photoPx[s] + 0.7152 * photoPx[s + 1] + 0.0722 * photoPx[s + 2]) / 255;
      const l16 = Math.round(l * 65535);
      const d = edge[py * GW + px] ? 255 : Math.min(254, depthPx[s]);
      lum16[k] = l16;
      depth[k] = d;
      cellOf[k] = Math.min(MH - 1, Math.floor(y / CELL)) * MW + Math.min(MW - 1, Math.floor(x / CELL));
      field[k * 4] = l16 >> 8;
      field[k * 4 + 1] = l16 & 255;
      field[k * 4 + 2] = d;
      field[k * 4 + 3] = 255;
    }
  }

  // ---- the resting sort, on the CPU: same spans, keys and tie-break as PASS_FS
  const state = new Uint16Array(N);
  const presort = () => {
    for (let k = 0; k < N; k++) state[k] = k % DW;
    const span = new Uint8Array(DW);
    const run = [];
    for (let j = 0; j < DH; j++) {
      const row = j * DW;
      for (let i = 0; i < DW; i++) {
        const k = row + i;
        const c = cellOf[k];
        if (c < 0) {
          span[i] = 0;
          continue;
        }
        const m = mask8[c] / 255;
        const l = lum16[k] / 65535;
        span[i] = depth[k] < 255 && m >= 0.002 && l >= LO0 + (LO1 - LO0) * m && l <= HI ? 1 : 0;
      }
      let i = 0;
      while (i < DW) {
        if (!span[i]) {
          i++;
          continue;
        }
        run.length = 0;
        run.push(i);
        while (i + 1 < DW && span[i + 1]) {
          const a = depth[row + i];
          const b = depth[row + i + 1];
          if (Math.floor(a / BAND) !== Math.floor(b / BAND) || Math.abs(a - b) >= JUMP) break;
          i++;
          run.push(i);
        }
        i++;
        if (run.length < 2) continue;
        const sorted = run.slice().sort((a, b) => lum16[row + b] - lum16[row + a] || a - b);
        for (let n = 0; n < run.length; n++) state[row + run[n]] = sorted[n];
      }
    }
  };
  if (sorted) presort();
  else for (let k = 0; k < N; k++) state[k] = k % DW;
  return { field, state };

}

