// The CPU half of Sort, shared by the engine and offline checks: the sort
// grid, the curl map, the resting wave's mask, and the bake (domain field and
// starting permutation). Plain arrays in, plain arrays out; no DOM.

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// The sort grid is the print's own resolution (the photo is shown at
// 2400x1600), so every sorted run is one device pixel tall: a hard strip,
// never a block comb.
export const GW = 2400;
export const GH = 1600;
const S = GW / 1200; // grid px per layout unit (the shapes below are drawn on a 1200x800 sheet)
export const CX = 520 * S; // curl centre, grid px
export const CY = 470 * S;
export const CELL = 24; // mask cell, grid px; sampled bilinearly, so the region has soft edges
export const MW = Math.ceil(GW / CELL);
export const MH = Math.ceil(GH / CELL);
// Span interval on luminance: lo = mix(LO0, LO1, m).
export const LO0 = 0.5;
export const LO1 = 0.0;
export const HI = 1.0;
export const JUMP = 16; // a depth step this large between neighbours breaks a span
export const EDGE = 18; // depth step (0..255 over 4 layout px) that marks a silhouette
export const REACH = 760 * S; // a sort line's reach at m = 1, before the clamp below
// Span exit clamp: a span ends once it has run this fraction of its line's
// reach through pixels that are not vegetation since the last one that was.
// So the wave carries its own green out of the verge and over a gap (the
// road, a wall, a strip of sky) but never drags a long tail of sky behind it.
export const EXIT = 0.15;
// Sort key: luminance pulled down by greenness, so within a span the greens
// sort first (they stay rooted where the span starts and fill the line up the
// curl) and the sky and wall highlights are pushed out to the crest.
export const GREEN_W = 0.5;
export const VEG_RUN = 4; // green texels in a row that count as grass
export const GREEN_FULL = 32; // g over max(r, b), in 8-bit steps, that counts as fully green
export function sortKey(r, g, b) {
  const l = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  const green = clamp((g - Math.max(r, b)) / GREEN_FULL, 0, 1);
  // Offset so the key stays in 0..1 for 16-bit storage.
  return clamp((l - GREEN_W * green + GREEN_W) / (1 + GREEN_W), 0, 1);
}

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

// The mask at grid point (x, y), bilinear between cell centres: the GPU reads
// the same R8 texture with LINEAR filtering.
export function maskAt(mask8, x, y) {
  const fx = clamp(x / CELL - 0.5, 0, MW - 1);
  const fy = clamp(y / CELL - 0.5, 0, MH - 1);
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(MW - 1, x0 + 1);
  const y1 = Math.min(MH - 1, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const a = mask8[y0 * MW + x0] + (mask8[y0 * MW + x1] - mask8[y0 * MW + x0]) * tx;
  const b = mask8[y1 * MW + x0] + (mask8[y1 * MW + x1] - mask8[y1 * MW + x0]) * tx;
  return (a + (b - a) * ty) / 255;
}

// The resting wave: a broad band of sort lines that enters low along the
// verge, rides up round the curl and breaks over the sky, thinning into
// fragments at its crest. Drawn on the 1200x800 layout sheet.
export function demoMask(amount) {
  const m = new Float32Array(MW * MH);
  const R0 = 40;
  const R1 = 520;
  const cx0 = CX / S;
  for (let cy = 0; cy < MH; cy++) {
    for (let cx = 0; cx < MW; cx++) {
      const x = ((cx + 0.5) * CELL) / S;
      const y = ((cy + 0.5) * CELL) / S;
      const [u0, r0] = fwd(x * S, y * S);
      const u = u0 / S;
      const r = r0 / S;
      const t = (r - R0) / (R1 - R0);
      const n = vnoise(x / 90, y / 90) - 0.5;
      // Start at the left edge of the verge; finish over the crest, inner lines curling furthest.
      const start = -cx0 - 40 + n * 120;
      const thEnd = Math.PI * (1.08 - 0.5 * t) + n * 0.4;
      const end = r * thEnd + (1 - t) * 260;
      if (t < -0.1 || t > 1.1 || u < start - 30 || u > end + 60) continue;
      const across = Math.min(smooth(-0.1, 0.08, t + n * 0.1), smooth(1.1, 0.9, t + n * 0.14));
      const fromStart = smooth(start - 30, start + 40, u);
      const toEnd = smooth(end + 60, end - r * 0.5, u);
      const v = across * fromStart * (0.6 + 0.4 * toEnd);
      m[cy * MW + cx] = clamp(v * amount, 0, 1);
    }
  }
  return m;
}

// Green: the vegetation that a span may start from.
const isVeg = (r, g, b) => g > r + 6 && g > b + 12;

// Everything the CPU prepares once: the domain field and the starting
// permutation.
//
// Field, per sort-line texel: R,G luminance (16 bit), B depth (255 on a
// silhouette, never in a span), A reach: 0 off the photo, else 1 + 253 x how
// many non-vegetation pixels lie between this texel and the last vegetation on
// its line, as a fraction of EXIT x that line's reach (255 = out of reach).
// key: the sort key (sortKey above, 16 bit) of the pixel at each texel. A span
// may only enter at grass and run on, through sky and whatever else, as far as
// the mask allows (m >= reach) and until a silhouette or a depth jump. So grass is carried out of the verge
// and over the sky, and a pole or a sign, with no grass of its own, is never
// entered.
export function bake(photoPx, depthPx, mask8, sorted) {
  // Depth, opened (min then max over a few px): the overhead wires, a pixel
  // or two wide, drop out of it, so they neither break a span nor stop the
  // wave; anything thicker (a pole, a sign) keeps its outline.
  const dep = new Uint8Array(GW * GH);
  {
    const R = 3;
    const a = new Uint8Array(GW * GH);
    for (let i = 0; i < GW * GH; i++) a[i] = depthPx[i * 4];
    const b = new Uint8Array(GW * GH);
    const pass = (src, dst, horiz, lo) => {
      for (let y = 0; y < GH; y++) {
        for (let x = 0; x < GW; x++) {
          let v = lo ? 255 : 0;
          for (let k = -R; k <= R; k++) {
            const w = horiz ? src[y * GW + clamp(x + k, 0, GW - 1)] : src[clamp(y + k, 0, GH - 1) * GW + x];
            v = lo ? (w < v ? w : v) : w > v ? w : v;
          }
          dst[y * GW + x] = v;
        }
      }
    };
    pass(a, b, true, true);
    pass(b, a, false, true);
    pass(a, b, true, false);
    pass(b, dep, false, false);
  }
  const D = (x, y) => dep[clamp(y, 0, GH - 1) * GW + clamp(x, 0, GW - 1)];
  const greenAt = (x, y) => {
    const s = (clamp(y, 0, GH - 1) * GW + clamp(x, 0, GW - 1)) * 4;
    return isVeg(photoPx[s], photoPx[s + 1], photoPx[s + 2]);
  };
  // Silhouettes: a step in depth whose near side is not grass (a pole, a
  // sign, a cabinet against what lies behind it). Foliage against the sky is
  // no silhouette, so the wave runs off the treetops into the sky.
  const edge = new Uint8Array(GW * GH);
  {
    const o = 2 * S;
    const g = new Uint8Array(GW * GH);
    for (let y = 0; y < GH; y++) {
      for (let x = 0; x < GW; x++) {
        const l = D(x - o, y);
        const r = D(x + o, y);
        const t = D(x, y - o);
        const b = D(x, y + o);
        const gx = Math.abs(r - l);
        const gy = Math.abs(b - t);
        if (Math.max(gx, gy) <= EDGE) continue;
        // Near side n, far side f, and n2 a step further into the near object.
        const [dx, dy] = gx >= gy ? [r > l ? 1 : -1, 0] : [0, b > t ? 1 : -1];
        const far = D(x - dx * o, y - dy * o);
        if (greenAt(x + dx * o, y + dy * o)) continue;
        // A wire (an object thinner than a few px) is no silhouette: the wave
        // sweeps over the overhead lines rather than stopping at each one.
        if (D(x + dx * 2 * o, y + dy * 2 * o) - far <= EDGE * 0.6) continue;
        g[y * GW + x] = 1;
      }
    }
    const k0 = 2 * S;
    for (let y = 0; y < GH; y++) {
      for (let x = 0; x < GW; x++) {
        let e = 0;
        for (let k = -k0; k <= k0 && !e; k++) e = g[clamp(y + k, 0, GH - 1) * GW + x] | g[y * GW + clamp(x + k, 0, GW - 1)];
        edge[y * GW + x] = e;
      }
    }
  }

  // Each sort line's reach, in grid px: rows differ, so the strips that run
  // out into the sky end at different lengths, each with a hard end.
  const reach = new Float32Array(DH);
  for (let j = 0; j < DH; j++) reach[j] = REACH * (0.3 + 0.45 * vnoise(j / (26 * S), 3.7) + 0.25 * hash(j, 11));

  // ---- the domain: every sort line is one row
  const N = DW * DH;
  const field = new Uint8Array(N * 4);
  const lum16 = new Uint16Array(N);
  const key16 = new Uint16Array(N);
  const depth = new Uint8Array(N);
  const reachQ = new Uint8Array(N);
  const mval = new Uint8Array(N);
  for (let j = 0; j < DH; j++) {
    const r = j + 0.5;
    const arc = Math.PI * r;
    let last = -1e9; // u of the last grass on this line
    let prevD = -1;
    let vegRun = 0; // consecutive vegetation texels up to here
    for (let i = 0; i < DW; i++) {
      // inv(), inlined: this loop runs ~10M times at load.
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
      if (x < 0 || y < 0 || x >= GW || y >= GH) {
        prevD = -1;
        vegRun = 0;
        continue;
      }
      const k = j * DW + i;
      const px = Math.floor(x);
      const py = Math.floor(y);
      const p = py * GW + px;
      const s = p * 4;
      const l = (0.2126 * photoPx[s] + 0.7152 * photoPx[s + 1] + 0.0722 * photoPx[s + 2]) / 255;
      const l16 = Math.round(l * 65535);
      const d = edge[p] ? 255 : Math.min(254, dep[p]);
      // A silhouette or a depth jump ends whatever run of grass came before.
      if (d === 255 || (prevD >= 0 && Math.abs(d - prevD) >= JUMP)) last = -1e9;
      // Grass, as a span root, is a few green texels in a row: a lone green
      // speck in the asphalt roots nothing, so the road grows no strips.
      vegRun = d < 255 && isVeg(photoPx[s], photoPx[s + 1], photoPx[s + 2]) ? vegRun + 1 : 0;
      if (vegRun >= VEG_RUN) last = u;
      prevD = d;
      const rq = 1 + Math.round((253 * (u - last)) / (EXIT * reach[j]));
      lum16[k] = l16;
      key16[k] = Math.round(sortKey(photoPx[s], photoPx[s + 1], photoPx[s + 2]) * 65535);
      depth[k] = d;
      reachQ[k] = rq > 254 ? 255 : rq;
      if (sorted) mval[k] = Math.round(maskAt(mask8, x, y) * 255);
      field[k * 4] = l16 >> 8;
      field[k * 4 + 1] = l16 & 255;
      field[k * 4 + 2] = d;
      field[k * 4 + 3] = reachQ[k];
    }
  }

  // ---- the resting sort, on the CPU: same spans, keys and tie-break as PASS_FS
  const state = new Uint16Array(N);
  for (let k = 0; k < N; k++) state[k] = k % DW;
  if (!sorted) return { field, key: key16, state };
  const inSpan = (k) => {
    const rq = reachQ[k];
    if (rq === 0 || depth[k] === 255 || mval[k] < 1) return false;
    const m = mval[k] / 255;
    if ((rq - 1) / 253 > m) return false;
    const l = lum16[k] / 65535;
    return l >= LO0 + (LO1 - LO0) * m && l <= HI;
  };
  const span = new Uint8Array(DW);
  const run = [];
  for (let j = 0; j < DH; j++) {
    const row = j * DW;
    for (let i = 0; i < DW; i++) span[i] = inSpan(row + i) ? 1 : 0;
    let i = 0;
    while (i < DW) {
      if (!span[i]) {
        i++;
        continue;
      }
      run.length = 0;
      run.push(i);
      while (i + 1 < DW && span[i + 1] && Math.abs(depth[row + i] - depth[row + i + 1]) < JUMP) {
        i++;
        run.push(i);
      }
      i++;
      if (run.length < 2) continue;
      // Greenest and darkest first, ties by home index.
      const order = run.slice().sort((a, b) => key16[row + a] - key16[row + b] || a - b);
      for (let n = 0; n < run.length; n++) state[row + run[n]] = order[n];
    }
  }
  return { field, key: key16, state };
}
